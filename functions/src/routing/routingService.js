'use strict';

const { indexGraph, isEdgeStepFree, isEdgeBlocked } = require('./graphIndex');

// ---------------------------------------------------------------------------
// Routing source of truth - constraint #4.
//
// This module contains NO pathfinding. Routes come from the shared WitsPath
// routing engine (routing/ in this repo): the Android app's A* extracted into
// a Java module, served over HTTP. The Android app is meant to use the same
// module (routing/README.md), so the two can never drift.
//
//   HttpRoutingService        - calls the routing engine. Target state.
//   UnavailableRoutingService - fails closed when no engine is configured.
//
// Every service returns either
//   { path: [{node_id, name, type, x, y}], segments: [{from, to, edge_id, distance_m}],
//     distance_m, accessible, estimated_seconds, blocked_segments: [], source }
// or an explicit error object { error, message }.
// ---------------------------------------------------------------------------

class UnavailableRoutingService {
  constructor(reason) {
    this.source = 'unavailable';
    this.reason = reason || 'No routing engine is configured.';
  }

  async getRoute() {
    return { error: 'routing_unavailable', message: this.reason };
  }
}

/**
 * Client for the routing engine's POST /v1/route. The graph (with live edge
 * statuses) is sent with every request, so the engine needs no database
 * access. The response is checked against the graph before anyone sees it.
 */
class HttpRoutingService {
  constructor({ url, timeoutMs, fetchImpl, auth }) {
    this.source = 'shared-routing-engine';
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || fetch;
    this.auth = auth || 'none';
  }

  async getRoute({ fromNodeId, toNodeId, accessible, graph, speedMultiplier }) {
    let response;
    let body;
    try {
      const headers = { 'content-type': 'application/json' };
      if (this.auth === 'id-token') headers.authorization = `Bearer ${await fetchIdToken(this.url, this.fetch)}`;
      response = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          graph: { floors: graph.floors, nodes: graph.nodes, edges: graph.edges },
          from_node_id: fromNodeId,
          to_node_id: toNodeId,
          accessible,
          speed_multiplier: speedMultiplier || 1
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      body = await response.json();
    } catch (error) {
      return { error: 'routing_service_unreachable', message: 'The routing engine could not be reached.' };
    }

    if (body?.error) {
      return { error: String(body.error), message: String(body.message || 'No route found.') };
    }
    if (!response.ok) {
      return { error: 'routing_service_error', message: `Routing engine returned HTTP ${response.status}.` };
    }
    if (
      !Array.isArray(body?.path) ||
      typeof body.accessible !== 'boolean' ||
      !Number.isFinite(body.distance_m) ||
      !Number.isFinite(body.estimated_seconds)
    ) {
      return { error: 'routing_service_bad_response', message: 'The routing engine returned an unexpected response.' };
    }

    const route = describePath(body.path, graph, this.source, body.edge_ids);
    if (route.error) return route;
    if (route.path[0].node_id !== fromNodeId || route.path[route.path.length - 1].node_id !== toNodeId) {
      return { error: 'routing_service_bad_response', message: 'The route does not connect the requested places.' };
    }
    // The engine's figures are authoritative; describePath only verified that
    // every hop is a real edge in the same graph.
    route.distance_m = round1(body.distance_m);
    route.estimated_seconds = body.estimated_seconds;
    route.accessible = body.accessible && route.accessible;
    // Keep anything describePath found (e.g. a flagged edge) as well.
    route.blocked_segments = [...route.blocked_segments, ...(Array.isArray(body.blocked_segments) ? body.blocked_segments : [])];
    return route;
  }
}

/**
 * Google-signed ID token for a private Cloud Run service, from the metadata
 * server available inside Cloud Functions / Cloud Run.
 */
async function fetchIdToken(url, fetchImpl) {
  const audience = new URL(url).origin;
  const response = await fetchImpl(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!response.ok) throw new Error('Could not get an ID token for the routing engine');
  return (await response.text()).trim();
}

/**
 * Turn a node-id sequence into the route shape, using only facts from the
 * graph (edge ids, distances, statuses, accessibility). Fails if any hop is
 * not a real edge. This validates a route; it never searches for one.
 * edgeIds (from the engine) pin the exact edge when two places are joined by
 * more than one.
 */
function describePath(nodeIds, graph, source, edgeIds) {
  const index = indexGraph(graph);
  if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
    return { error: 'invalid_route', message: 'The route has fewer than two points.' };
  }

  const path = [];
  for (const id of nodeIds) {
    const node = index.node(id);
    if (!node) {
      return { error: 'invalid_route', message: 'The route references an unknown place.' };
    }
    path.push({
      node_id: node.nodeId,
      name: (node.label || node.nodeId).replace(/\s+/g, ' ').trim(),
      type: node.type,
      x: Number(node.x),
      y: Number(node.y)
    });
  }

  const segments = [];
  const blocked = [];
  let accessible = true;
  for (let i = 1; i < nodeIds.length; i += 1) {
    const pinned = Array.isArray(edgeIds) ? index.edgeById(edgeIds[i - 1]) : null;
    const edge = pinned || index.edgeBetween(nodeIds[i - 1], nodeIds[i]);
    const joins = edge && [edge.fromNodeId, edge.toNodeId].sort().join('|') === [nodeIds[i - 1], nodeIds[i]].sort().join('|');
    if (!edge || !joins || !Number.isFinite(Number(edge.distance))) {
      return { error: 'invalid_route', message: 'The route uses a connection that is not in the campus map.' };
    }
    if (isEdgeBlocked(edge)) blocked.push({ edge_id: edge.edgeId, reason: `edge status ${edge.status}` });
    if (!isEdgeStepFree(edge)) accessible = false;
    segments.push({
      from: nodeIds[i - 1],
      to: nodeIds[i],
      edge_id: edge.edgeId,
      distance_m: round1(Number(edge.distance))
    });
  }

  return {
    path,
    segments,
    distance_m: round1(segments.reduce((sum, segment) => sum + segment.distance_m, 0)),
    accessible,
    blocked_segments: blocked,
    source
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function createRoutingService({ mode, url, timeoutMs, auth, fetchImpl }) {
  if (mode === 'http') {
    if (!url) return new UnavailableRoutingService('ROUTING_MODE=http but ROUTING_SERVICE_URL is not set.');
    return new HttpRoutingService({ url, timeoutMs, fetchImpl, auth });
  }
  return new UnavailableRoutingService();
}

module.exports = { createRoutingService, HttpRoutingService, UnavailableRoutingService, describePath };
