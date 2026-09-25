function findNode(nodeId) {
  return window.appState.graph?.nodes.find((node) => node.nodeId === nodeId) || null;
}

function computeEdgeWeight(edge) {
  return Number(edge.distance) * Number(edge.accessibilityCost || 1);
}

function computeDistance(nodeA, nodeB) {
  const a = getFloorPixel(nodeA);
  const b = getFloorPixel(nodeB);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) * (window.appState.floor?.metresPerPixel || 1);
}

function heuristicDistance(nodeA, nodeB) {
  const a = getFloorPixel(nodeA);
  const b = getFloorPixel(nodeB);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function getFloorPixel(node) {
  const floor = window.appState.floor;
  if (!floor || !node) {
    return { x: 0, y: 0 };
  }

  return {
    x: Number(node.x) / floor.metresPerPixel,
    y: Number(node.y) / floor.metresPerPixel
  };
}

function toFloorPixels(node) {
  const position = getFloorPixel(node);
  return {
    x: position.x,
    y: position.y
  };
}

function solveRoute(fromNode, toNode, requireAccessible) {
  const graphNodes = new Map(window.appState.graph.nodes.map((node) => [node.nodeId, node]));
  const adjacency = new Map();

  window.appState.graph.nodes.forEach((node) => adjacency.set(node.nodeId, []));

  window.appState.graph.edges.forEach((edge) => {
    const from = graphNodes.get(edge.fromNodeId);
    const to = graphNodes.get(edge.toNodeId);

    if (!from || !to) {
      return;
    }

    const cost = Number(edge.accessibilityCost || 1);
    const blocked = edge.status === 'blocked' || cost >= 999;
    const isStairsOnly = Boolean(edge.stairs) && !edge.ramp && !edge.elevator;

    if (blocked || (requireAccessible && isStairsOnly)) {
      return;
    }

    const fromEntry = {
      node: to,
      edge,
      weight: computeEdgeWeight(edge)
    };
    const toEntry = {
      node: from,
      edge,
      weight: computeEdgeWeight(edge)
    };

    adjacency.get(from.nodeId).push(fromEntry);
    adjacency.get(to.nodeId).push(toEntry);
  });

  const openSet = [{ nodeId: fromNode.nodeId, f: 0, g: 0 }];
  const cameFrom = new Map();
  const gScore = new Map([[fromNode.nodeId, 0]]);

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();

    if (current.nodeId === toNode.nodeId) {
      return reconstructPath(cameFrom, fromNode.nodeId, toNode.nodeId);
    }

    for (const neighbor of adjacency.get(current.nodeId) || []) {
      const tentative = (gScore.get(current.nodeId) || Infinity) + neighbor.weight;
      if (tentative < (gScore.get(neighbor.node.nodeId) || Infinity)) {
        cameFrom.set(neighbor.node.nodeId, current.nodeId);
        gScore.set(neighbor.node.nodeId, tentative);
        const heuristic = heuristicDistance(neighbor.node, toNode);
        openSet.push({
          nodeId: neighbor.node.nodeId,
          f: tentative + heuristic,
          g: tentative
        });
      }
    }
  }

  return null;
}

function reconstructPath(cameFrom, sourceId, targetId) {
  const path = [findNode(targetId)];
  let current = targetId;

  while (current !== sourceId) {
    const previous = cameFrom.get(current);
    if (!previous) {
      return null;
    }
    current = previous;
    path.unshift(findNode(current));
  }

  return path;
}
