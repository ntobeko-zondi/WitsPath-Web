function findNode(nodeId) {
  return window.appState.graph?.nodes.find((node) => node.nodeId === nodeId) || null;
}

function parseRouteNumber(value) {
  return Number.parseFloat(String(value).replace(',', '.'));
}

function computeEdgeWeight(edge, mobilityProfile = 'no-preference') {
  const profileKey = {
    'walking-aid': 'walkingAid',
    'low-vision': 'lowVision',
    'no-preference': 'noPreference'
  }[mobilityProfile] || mobilityProfile;
  const profileCosts = edge.accessibilityCosts || edge.accessibilityCostByProfile;
  const accessibilityCost = profileCosts?.[profileKey] ?? edge.accessibilityCost ?? 1;
  return parseRouteNumber(edge.distance) * parseRouteNumber(accessibilityCost || 1);
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
  return Math.hypot(dx, dy) * (window.appState.floor?.metresPerPixel || 1);
}

function getFloorPixel(node) {
  const floor = window.appState.floor;
  if (!floor || !node) {
    return { x: 0, y: 0 };
  }

  return {
    x: Number(node.x),
    y: Number(node.y)
  };
}

function toFloorPixels(node) {
  const position = getFloorPixel(node);
  return {
    x: position.x,
    y: position.y
  };
}

function solveRoute(fromNode, toNode, mobilityProfile = 'no-preference', requireStepFree = false) {
  if (typeof mobilityProfile === 'boolean') {
    requireStepFree = mobilityProfile;
    mobilityProfile = mobilityProfile ? 'wheelchair' : 'no-preference';
  }

  const profileKey = {
    'walking-aid': 'walkingAid',
    'low-vision': 'lowVision',
    'no-preference': 'noPreference'
  }[mobilityProfile] || mobilityProfile;
  const graphNodes = new Map(window.appState.graph.nodes.map((node) => [node.nodeId, node]));
  const adjacency = new Map();
  const preferLifts = readBooleanSetting(STORAGE_KEYS.preferLifts);
  const avoidSteepRamps = readBooleanSetting(STORAGE_KEYS.avoidSteepRamps);

  window.appState.graph.nodes.forEach((node) => adjacency.set(node.nodeId, []));

  window.appState.graph.edges.forEach((edge) => {
    const from = graphNodes.get(edge.fromNodeId);
    const to = graphNodes.get(edge.toNodeId);

    if (!from || !to) {
      return;
    }

    const cost = parseRouteNumber(edge.accessibilityCost || 1);
    const profileCosts = edge.accessibilityCosts || edge.accessibilityCostByProfile;
    const profileCost = parseRouteNumber(profileCosts?.[profileKey] ?? edge.accessibilityCost ?? 1);
    const blocked = edge.status === 'blocked' || cost >= 999 || profileCost >= 999;
    const isStairsOnly = Boolean(edge.stairs) && !edge.ramp && !edge.elevator;
    const isRamp = Boolean(edge.ramp) || edge.type === 'ramp';
    const isLift = Boolean(edge.elevator) || Boolean(edge.lift) || edge.type === 'elevator';
    const isSteepRamp = Boolean(edge.steepRamp) || Boolean(edge.steep) || edge.rampGrade === 'steep';
    const profileAccess = edge.profileAccessibility?.[profileKey] ?? edge.accessibility?.[profileKey];
    const inaccessibleForProfile = edge[`${profileKey}Accessible`] === false
      || profileAccess === false
      || profileAccess === 'inaccessible'
      || edge.inaccessibleFor?.includes(mobilityProfile);
    const excludesStairs = isStairsOnly && (requireStepFree || mobilityProfile === 'wheelchair');

    if (blocked || inaccessibleForProfile || excludesStairs || (avoidSteepRamps && isRamp && isSteepRamp)) {
      return;
    }

    const profilePenalty = mobilityProfile === 'walking-aid' && isStairsOnly ? 1.5 : 1;
    const liftPreference = preferLifts && isLift ? 0.75 : preferLifts && isRamp ? 1.35 : 1;

    const fromEntry = {
      node: to,
      edge,
      weight: computeEdgeWeight(edge, mobilityProfile) * profilePenalty * liftPreference
    };
    const toEntry = {
      node: from,
      edge,
      weight: computeEdgeWeight(edge, mobilityProfile) * profilePenalty * liftPreference
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
      const tentative = (gScore.get(current.nodeId) ?? Infinity) + neighbor.weight;
      if (tentative < (gScore.get(neighbor.node.nodeId) ?? Infinity)) {
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
