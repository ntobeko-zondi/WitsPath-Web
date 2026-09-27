'use strict';

const { indexGraph, isEdgeStepFree, isEdgeBlocked } = require('./graphIndex');

// ---------------------------------------------------------------------------
// Routing source of truth - constraint #4.
//
// This module deliberately contains NO pathfinding. The website must use the
// same A* engine as the Android app, not a second implementation that can
// drift. Until that engine is extracted into a shared service, only these
// options exist:
//
//   HttpRoutingService        - target state: calls the shared service.
//   FixtureRoutingService     - PLACEHOLDER for development. Returns only
//                               hand-seeded routes; anything else is an error.
//   UnavailableRoutingService - fails closed.
//
// BLOCKING FOLLOW-UP: extract the Android app's Java A* into a service that
// implements the HTTP contract below, set ROUTING_MODE=http, and delete the
// fixture mode. Note that app/routing.js (the pre-existing web route planner)
// is already a JavaScript fork of the A* logic and should be switched to the
// same shared service at that point.
//
// Every service returns either
//   { path: [{node_id, name, type, x, y}], segments: [{from, to, edge_id, distance_m}],
//     distance_m, accessible, blocked_segments: [], source }
// or an explicit error object { error, message }.
// ---------------------------------------------------------------------------

class UnavailableRoutingService {
  constructor(reason) {
    this.source = 'unavailable';
    this.reason = reason || 'No routing service is configured.';
  }

  async getRoute() {
    return { error: 'routing_unavailable', message: this.reason };
  }
}

/**
 * Shared routing service client. Expected contract:
 *   POST {ROUTING_SERVICE_URL}
 *   body:     { from_node_id, to_node_id, accessible }
 *   200 body: { path: [node_id, ...], distance_m, accessible, blocked_segments: [...] }
 *   or        { error, message }
 * The response is validated against the graph before anyone sees it.
 */
class HttpRoutingService {
  constructor({ url, timeoutMs, fetchImpl }) {
    this.source = 'shared-routing-service';
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || fetch;
  }

  async getRoute({ fromNodeId, toNodeId, accessible, graph }) {
    let body;
    try {
      const response = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from_node_id: fromNodeId, to_node_id: toNodeId, accessible }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      body = await response.json();
      if (!response.ok && !body?.error) {
        return { error: 'routing_service_error', message: `Routing service returned HTTP ${response.status}.` };
      }
    } catch (error) {
      return { error: 'routing_service_unreachable', message: 'The routing service could not be reached.' };
    }

    if (body?.error) {
      return { error: String(body.error), message: String(body.message || 'No route found.') };
    }
    if (!Array.isArray(body?.path) || typeof body.accessible !== 'boolean' || !Number.isFinite(body.distance_m)) {
      return { error: 'routing_service_bad_response', message: 'The routing service returned an unexpected response.' };
    }

    const route = describePath(body.path, graph, this.source);
    if (route.error) return route;
    // Report the engine's own figures but refuse anything we cannot reconcile
    // with the shared graph data.
    if (route.path[0].node_id !== fromNodeId || route.path[route.path.length - 1].node_id !== toNodeId) {
      return { error: 'routing_service_bad_response', message: 'The route does not connect the requested places.' };
    }
    route.distance_m = round1(body.distance_m);
    route.accessible = body.accessible && route.accessible;
    route.blocked_segments = Array.isArray(body.blocked_segments) ? body.blocked_segments : [];
    return route;
  }
}

/**
 * PLACEHOLDER - NOT A PATHFINDER. Looks up a hand-seeded node sequence for the
 * exact (from, to) pair and checks every hop against the graph. It never
 * searches for a path, so any pair without a fixture returns an error. The
 * `source` field travels all the way to the UI so these routes are labelled.
 */
class FixtureRoutingService {
  constructor({ store }) {
    this.source = 'placeholder-fixture';
    this.store = store;
  }

  async getRoute({ fromNodeId, toNodeId, graph }) {
    const nodeIds = await this.store.getRouteFixture(fromNodeId, toNodeId);
    if (!nodeIds) {
      return {
        error: 'no_route_data',
        message: 'No route data is available for this pair of places yet.'
      };
    }
    return describePath(nodeIds, graph, this.source);
  }
}

/**
 * Turn a node-id sequence into the route shape, using only facts from the
 * graph (edge distances, statuses, accessibility). Fails if any hop is not a
 * real edge.
 */
function describePath(nodeIds, graph, source) {
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
    const edge = index.edgeBetween(nodeIds[i - 1], nodeIds[i]);
    if (!edge || !Number.isFinite(Number(edge.distance))) {
      return { error: 'invalid_route', message: 'The route uses a connection that is not in the campus map.' };
    }
    if (isEdgeBlocked(edge)) blocked.push({ edge_id: edge.edgeId, reason: 'edge marked blocked' });
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

function createRoutingService({ mode, url, timeoutMs, store, fetchImpl }) {
  if (mode === 'http') {
    if (!url) return new UnavailableRoutingService('ROUTING_MODE=http but ROUTING_SERVICE_URL is not set.');
    return new HttpRoutingService({ url, timeoutMs, fetchImpl });
  }
  if (mode === 'fixture') {
    return new FixtureRoutingService({ store });
  }
  return new UnavailableRoutingService();
}

module.exports = {
  createRoutingService,
  HttpRoutingService,
  FixtureRoutingService,
  UnavailableRoutingService,
  describePath
};
