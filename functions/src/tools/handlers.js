'use strict';

const config = require('../config');
const { matchPlaces } = require('../places/placeMatcher');
const { indexGraph } = require('../routing/graphIndex');
const { LANGUAGES, isKnownLanguage, tierFor } = require('../language/languages');

// Every handler returns either a result object or { error, message }. Errors
// are sent back to the model with is_error: true so it reports the failure
// instead of filling the gap.

const TIER_GUIDANCE = {
  full: 'Supported language. Reply normally in this language.',
  limited:
    'Limited, unverified support. Reply in this language if you can, keep it very simple, and add one short ' +
    'sentence in English saying support for this language is limited.',
  unsupported:
    'Not one of the supported languages. Reply in English, briefly acknowledging you cannot yet reply reliably ' +
    'in their language.'
};

function invalid(message) {
  return { error: 'invalid_input', message };
}

function isNonEmptyString(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

async function findPlace(input, ctx) {
  if (!isNonEmptyString(input.query) || typeof input.accessible_only !== 'boolean') {
    return invalid('find_place needs a non-empty query and a boolean accessible_only.');
  }
  const places = await ctx.store.getPlaces();
  const matches = matchPlaces(input.query, places, { accessibleOnly: input.accessible_only });
  const result = {
    matches: matches.map(({ place, confidence }) => ({
      id: place.id,
      name: place.name,
      building: place.building,
      floor: place.floor,
      confidence
    }))
  };
  if (input.accessible_only) {
    // The graph does not record entrance accessibility yet; say so rather than
    // letting the model imply these entrances were checked.
    result.entrance_accessibility_unverified = matches
      .filter(({ place }) => place.accessibleEntrance !== true)
      .map(({ place }) => place.id);
  }
  return result;
}

async function getRoute(input, ctx) {
  if (!isNonEmptyString(input.from_node_id) || !isNonEmptyString(input.to_node_id) || typeof input.accessible !== 'boolean') {
    return invalid('get_route needs from_node_id, to_node_id and a boolean accessible.');
  }
  if (input.from_node_id === input.to_node_id) {
    return invalid('Start and destination are the same place.');
  }

  const graph = await ctx.store.getGraph();
  const index = indexGraph(graph);
  if (!index.node(input.from_node_id) || !index.node(input.to_node_id)) {
    return { error: 'unknown_place', message: 'Use node ids returned by find_place.' };
  }

  const route = await ctx.routing.getRoute({
    fromNodeId: input.from_node_id,
    toNodeId: input.to_node_id,
    accessible: input.accessible,
    graph
  });
  if (route.error) {
    return { ...route, instruction: "Tell the user you can't confirm a route right now. Do not describe one." };
  }

  // Live blocked-path reports override whatever the route source said.
  const statuses = await ctx.store.getPathStatus(route.path.map((node) => node.node_id));
  const blockedNodes = statuses.filter((status) => status.blocked);
  const blockedSegments = [
    ...route.blocked_segments,
    ...blockedNodes.map((status) => ({ node_id: status.nodeId, reason: status.reason || 'reported blocked' }))
  ];
  if (blockedSegments.length) {
    return {
      error: 'route_blocked',
      message: 'Part of this route is reported blocked, and no confirmed alternative is available.',
      blocked_segments: blockedSegments,
      instruction: "Tell the user you can't confirm a clear route right now and mention the blockage."
    };
  }
  if (input.accessible && !route.accessible) {
    return {
      error: 'no_accessible_route',
      message: 'No confirmed step-free route is available between these places.',
      instruction: "Tell the user you can't confirm a step-free route. Do not suggest one."
    };
  }

  ctx.route = route;
  ctx.groundedDistances.add(route.distance_m);

  const result = {
    path: route.path.map((node) => ({ node_id: node.node_id, name: node.name })),
    distance_m: route.distance_m,
    accessible: route.accessible,
    blocked_segments: [],
    note:
      'The app shows the user turn-by-turn directions from verified phrases. Do not list or translate the ' +
      'steps yourself; summarise briefly and refer to the steps shown.'
  };
  if (route.source === 'placeholder-fixture') {
    result.data_source = 'placeholder route data, not the shared routing engine';
  }
  return result;
}

async function getTravelTime(input, ctx) {
  const distance = input.distance_m;
  if (!Number.isFinite(distance) || distance <= 0) {
    return invalid('distance_m must be a positive number from get_route.');
  }
  // Enforce "never invent a distance": only distances get_route produced in
  // this conversation are accepted.
  const grounded = [...ctx.groundedDistances].some((known) => Math.abs(known - distance) < 0.05);
  if (!grounded) {
    return {
      error: 'ungrounded_distance',
      message: 'This distance did not come from get_route. Get a route first.'
    };
  }

  const profile = input.mobility_profile === 'ambulatory' ? 'ambulatory' : 'wheelchair';
  if (input.mobility_profile) ctx.mobilityProfileUsed = true;
  const speed = config.SPEED_MPS[profile];
  const minutes = Math.max(1, Math.ceil(distance / speed / 60));

  ctx.travelTime = { minutes, basis: 'estimate', mobility_profile: profile, distance_m: distance };
  return { minutes, basis: 'estimate', assumed_speed_m_per_s: speed, mobility_profile: profile };
}

async function checkPathStatus(input, ctx) {
  const ids = input.node_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || !ids.every((id) => isNonEmptyString(id))) {
    return invalid('node_ids must be 1-30 node ids.');
  }
  const index = indexGraph(await ctx.store.getGraph());
  const unknown = ids.filter((id) => !index.node(id));
  if (unknown.length) {
    // "clear: true" for a place we don't know would be misleading.
    return { error: 'unknown_place', message: 'Some node ids are not on the campus map.', unknown_node_ids: unknown };
  }

  const statuses = await ctx.store.getPathStatus(ids);
  const issues = statuses
    .filter((status) => status.blocked)
    .map((status) => ({
      node_id: status.nodeId,
      name: index.node(status.nodeId)?.label?.trim() || status.nodeId,
      reason: status.reason || 'reported blocked',
      reported_at: status.reportedAt instanceof Date ? status.reportedAt.toISOString() : status.reportedAt || null
    }));
  return {
    clear: issues.length === 0,
    issues,
    note: 'clear means there are no active reports, not that the path was inspected.'
  };
}

async function reportIssue(input, ctx) {
  if (!isNonEmptyString(input.node_or_edge_id)) {
    return invalid('node_or_edge_id is required.');
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < 3 || description.length > config.MAX_REPORT_DESCRIPTION_CHARS) {
    return invalid(`description must be 3-${config.MAX_REPORT_DESCRIPTION_CHARS} characters.`);
  }
  const index = indexGraph(await ctx.store.getGraph());
  if (!index.hasNodeOrEdge(input.node_or_edge_id)) {
    return { error: 'unknown_place', message: 'Use find_place to identify the location first.' };
  }

  const reportId = await ctx.store.addReport({
    nodeOrEdgeId: input.node_or_edge_id,
    description,
    source: 'web-companion',
    userId: ctx.userId || null,
    createdAt: new Date()
  });
  ctx.reportFiled = true;
  return { report_id: reportId };
}

async function declareLanguage(input, ctx) {
  const lang = input.lang;
  if (lang !== 'other' && !isKnownLanguage(lang)) {
    return invalid('Unknown language code.');
  }
  ctx.declaredLang = lang;
  const tier = tierFor(lang);
  return { lang, name: LANGUAGES[lang]?.name || 'other', tier, guidance: TIER_GUIDANCE[tier] };
}

const HANDLERS = {
  find_place: findPlace,
  get_route: getRoute,
  get_travel_time: getTravelTime,
  check_path_status: checkPathStatus,
  report_issue: reportIssue,
  declare_language: declareLanguage
};

async function runTool(name, input, ctx) {
  const handler = HANDLERS[name];
  if (!handler) {
    return { error: 'unknown_tool', message: `No tool named ${name}.` };
  }
  try {
    return await handler(input || {}, ctx);
  } catch (error) {
    ctx.log?.('tool_failed', { name, error: error.message });
    return { error: 'tool_failed', message: "The tool failed. Tell the user you can't confirm this right now." };
  }
}

module.exports = { runTool };
