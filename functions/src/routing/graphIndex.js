'use strict';

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Lookup helpers over the campus graph. This does not search the graph - it
 * only answers "does this node/edge exist and what does the data say about
 * it", so a route produced elsewhere can be checked against the same data.
 */
function indexGraph(graph) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.nodeId, node]));
  const edges = new Map();
  const edgesById = new Map();
  for (const edge of graph.edges || []) {
    edges.set(edgeKey(edge.fromNodeId, edge.toNodeId), edge);
    edgesById.set(edge.edgeId, edge);
  }

  return {
    node: (id) => nodes.get(id) || null,
    edgeBetween: (a, b) => edges.get(edgeKey(a, b)) || null,
    edgeById: (id) => edgesById.get(id) || null,
    hasNodeOrEdge: (id) => nodes.has(id) || edgesById.has(id)
  };
}

// Mirrors the accessibility rules the Android app and graph schema note use:
// cost >= 999 is impassable step-free; a stairs-only edge is not step-free.
function isEdgeStepFree(edge) {
  const cost = Number(edge.accessibilityCost || 1);
  const stairsOnly = Boolean(edge.stairs) && !edge.ramp && !edge.elevator;
  return cost < 999 && !stairsOnly;
}

// Same rule as the routing engine: only "ok" edges are usable ("flagged" by
// reports and "blocked" are not).
function isEdgeBlocked(edge) {
  return String(edge.status || 'ok').toLowerCase() !== 'ok';
}

module.exports = { indexGraph, isEdgeStepFree, isEdgeBlocked };
