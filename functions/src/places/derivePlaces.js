'use strict';

// Labels read "Building - detail" (older map) or "Building — detail" (current map).
const DETAIL_SEPARATOR = /\s+[-–—]\s+/;

/**
 * What a place is, for deciding whether it can be offered as a destination.
 *   entrance  the way into a building (the normal destination)
 *   gate      a vehicle or pedestrian gate into the campus
 *   parking   a disabled-parking bay
 *   ramp, stairs  approach features
 * Anything else keeps its graph type.
 */
function placeKind(type, name) {
  if (type === 'entrance' && /\b(vehicle|pedestrian)\s+gate\b/i.test(name)) return 'gate';
  return type;
}

/**
 * Build `places` records from the campus graph shared with the Android app.
 * Used by the seed script and the in-memory dev store. Only labelled nodes
 * that are real destinations become places (generic waypoints like "Node 23"
 * are skipped).
 *
 * accessibleEntrance is left null (unknown): the graph does not record it, and
 * we must not claim an entrance is accessible without data. find_place only
 * excludes places explicitly marked false.
 */
function derivePlaces(graph, aliasMap = {}) {
  const floorsById = new Map((graph.floors || []).map((floor) => [floor.floorId, floor]));

  return (graph.nodes || [])
    .filter((node) => node.label && node.type !== 'node')
    .map((node) => {
      const name = node.label.replace(/\s+/g, ' ').trim();
      const [building, ...rest] = name.split(DETAIL_SEPARATOR);
      const acronym = /\(([A-Z]{2,})\)/.exec(name)?.[1];
      const aliases = new Set(aliasMap[node.nodeId] || []);
      if (acronym) aliases.add(acronym);

      return {
        id: node.nodeId,
        nodeId: node.nodeId,
        name,
        aliases: [...aliases],
        building: building.trim(),
        detail: rest.join(' - ').trim(),
        floor: floorsById.get(node.floorId)?.level ?? null,
        type: node.type,
        kind: placeKind(node.type, name),
        accessibleEntrance: null
      };
    });
}

module.exports = { derivePlaces, placeKind, DETAIL_SEPARATOR };
