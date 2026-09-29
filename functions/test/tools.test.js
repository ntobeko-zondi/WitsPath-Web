'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runTool } = require('../src/tools/handlers');
const { HttpRoutingService } = require('../src/routing/routingService');
const { NODES, makeStore, makeRouting, fakeEngine } = require('./helpers');

function ctxFor(store, routingMode = 'http', engine = fakeEngine()) {
  return {
    store,
    routing: makeRouting(routingMode, engine),
    groundedRoutes: [],
    speedMultiplier: 1
  };
}

test('find_place: out-of-map place returns no matches (never a guess)', async () => {
  const ctx = ctxFor(makeStore());
  for (const query of ['nearest ATM', 'ATM', 'food court', 'library in Braamfontein East Campus gym']) {
    const result = await runTool('find_place', { query, accessible_only: true }, ctx);
    assert.deepEqual(result.matches, [], `expected no match for "${query}"`);
  }
});

test('find_place: names, aliases and typos resolve with confidence', async () => {
  const ctx = ctxFor(makeStore());
  const cases = [
    ['maths building', NODES.msb],
    ['MSB', NODES.msb],
    ['Genmin Laboratories', NODES.genmin],
    ['school of accountancy', 'nd_mu83zadw5'],
    ['law clinic', NODES.lawClinic]
  ];
  for (const [query, expected] of cases) {
    const result = await runTool('find_place', { query, accessible_only: false }, ctx);
    assert.equal(result.matches[0]?.id, expected, `query "${query}"`);
    assert.ok(result.matches[0].confidence >= 0.6);
    assert.deepEqual(Object.keys(result.matches[0]).sort(), ['building', 'confidence', 'floor', 'id', 'name', 'type']);
  }
});

test('find_place: a ramp is not offered when the user means the building, and vice versa', async () => {
  const ctx = ctxFor(makeStore());
  const find = async (query) => (await runTool('find_place', { query, accessible_only: true }, ctx)).matches;

  // "MSB" also matches the MSB ramps through the acronym; the building must lead and no ramp may appear.
  const msb = await find('MSB');
  assert.equal(msb[0].id, NODES.msb);
  assert.equal(msb[0].type, 'entrance');
  assert.ok(msb.every((match) => match.type !== 'ramp'), 'no ramps expected');

  const library = await find('Commerce Library');
  assert.deepEqual(library.map((match) => match.id), [NODES.commerceLibrary]);

  // Asking about a ramp (e.g. to report it) returns ramps, not the building.
  const ramps = await find('ramp at MSB');
  assert.ok(ramps.length >= 2);
  assert.ok(ramps.every((match) => match.type === 'ramp'), 'only ramps expected');
  assert.ok(!ramps.some((match) => match.id === NODES.msb));
});

test('find_place: accessible_only flags that entrance accessibility is unverified', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('find_place', { query: 'Flower Hall', accessible_only: true }, ctx);
  assert.equal(result.matches[0].id, NODES.flowerHall);
  assert.deepEqual(result.entrance_accessibility_unverified, [NODES.flowerHall]);
});

test('get_route: when the engine finds no route, the error reaches the model (no guess)', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: NODES.flowerHall, to_node_id: NODES.lawClinic, accessible: true }, ctx);
  assert.equal(result.error, 'no_route');
  assert.match(result.instruction, /can't confirm a route/);
  assert.equal(result.distance_m, undefined);
  assert.equal(result.path, undefined);
  assert.equal(ctx.route, undefined);
});

test('get_route: unavailable routing mode fails closed', async () => {
  const ctx = ctxFor(makeStore(), 'unavailable');
  const result = await runTool('get_route', { from_node_id: NODES.msb, to_node_id: NODES.msbLabs, accessible: true }, ctx);
  assert.equal(result.error, 'routing_unavailable');
});

test('get_route: sends the live graph + walking speed to the engine and returns its route', async () => {
  const engine = fakeEngine();
  const store = makeStore();
  const ctx = {
    ...ctxFor(store, 'http', engine),
    speedMultiplier: 0.7,
    routeOptions: { mobilityProfile: 'walking_aid', preferLifts: true, avoidSteepRamps: false }
  };
  const result = await runTool('get_route', { from_node_id: NODES.commerceLibrary, to_node_id: NODES.towerOfLight, accessible: true }, ctx);
  assert.equal(result.distance_m, 37.1);
  assert.equal(result.accessible, true);
  assert.deepEqual(result.blocked_segments, []);
  assert.equal(result.path.length, 3);
  assert.equal(result.data_source, undefined);

  const [request] = engine.requests;
  assert.equal(request.graph.nodes.length, (await store.getGraph()).nodes.length);
  assert.equal(request.speed_multiplier, 0.7);
  assert.equal(request.accessible, true);
  assert.equal(request.mobility_profile, 'walking_aid');
  assert.equal(request.prefer_lifts, true);
  assert.equal(request.avoid_steep_ramps, false);
});

test('get_route: works in both directions', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: NODES.towerOfLight, to_node_id: NODES.commerceLibrary, accessible: true }, ctx);
  assert.equal(result.path[0].node_id, NODES.towerOfLight);
  assert.equal(result.path[2].node_id, NODES.commerceLibrary);
});

test('get_route: an edge flagged by reports blocks a route the engine returned', async () => {
  const store = makeStore();
  store.graph.edges.find((edge) => edge.edgeId === 'eg_mu84r22d19').status = 'flagged';
  const result = await runTool(
    'get_route',
    { from_node_id: NODES.commerceLibrary, to_node_id: NODES.towerOfLight, accessible: true },
    ctxFor(store)
  );
  assert.equal(result.error, 'route_blocked');
});

test('get_route: live blocked-path report turns the route into an error', async () => {
  const store = makeStore();
  store.setPathStatus({ nodeId: 'nd_mu84lizxy', blocked: true, reason: 'ramp under repair', reportedAt: new Date() });
  const ctx = ctxFor(store);
  const result = await runTool('get_route', { from_node_id: NODES.commerceLibrary, to_node_id: NODES.towerOfLight, accessible: true }, ctx);
  assert.equal(result.error, 'route_blocked');
  assert.equal(result.blocked_segments[0].reason, 'ramp under repair');
});

test('get_route: unknown node ids are rejected', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: 'nd_fake', to_node_id: NODES.msb, accessible: true }, ctx);
  assert.equal(result.error, 'unknown_place');
});

test('get_travel_time: rejects distances that did not come from get_route', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_travel_time', { distance_m: 250, mobility_profile: 'wheelchair' }, ctx);
  assert.equal(result.error, 'ungrounded_distance');
});

test('get_travel_time: uses the engine estimate for that exact route', async () => {
  const ctx = ctxFor(makeStore());
  await runTool('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true }, ctx);
  const estimate = await runTool('get_travel_time', { distance_m: 82, mobility_profile: 'wheelchair' }, ctx);
  assert.equal(estimate.basis, 'estimate');
  assert.equal(estimate.minutes, 2); // engine: 89 s -> rounded up to whole minutes
  assert.equal(estimate.speed_multiplier, 1);
});

test('get_travel_time: says which mobility profile the estimate used', async () => {
  const route = { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true };
  const time = { distance_m: 82, mobility_profile: 'wheelchair' }; // what the model asks for is not what is used

  const general = ctxFor(makeStore());
  await runTool('get_route', route, general);
  assert.equal((await runTool('get_travel_time', time, general)).profile_used, 'general');

  const wheelchair = { ...ctxFor(makeStore()), routeOptions: { mobilityProfile: 'wheelchair' } };
  await runTool('get_route', route, wheelchair);
  const estimate = await runTool('get_travel_time', time, wheelchair);
  assert.equal(estimate.profile_used, 'wheelchair');
  assert.match(estimate.note, /Do not say it is for a wheelchair/);
});

test('check_path_status: reports issues, and refuses unknown ids instead of saying "clear"', async () => {
  const store = makeStore();
  store.setPathStatus({ nodeId: NODES.msb, blocked: true, reason: 'lift out of order', reportedAt: new Date('2026-09-27T08:00:00Z') });
  const ctx = ctxFor(store);
  const status = await runTool('check_path_status', { node_ids: [NODES.msb, NODES.genmin] }, ctx);
  assert.equal(status.clear, false);
  assert.equal(status.issues[0].reason, 'lift out of order');
  const unknown = await runTool('check_path_status', { node_ids: ['nd_nope'] }, ctx);
  assert.equal(unknown.error, 'unknown_place');
});

test('report_issue: stores a report for a real node and rejects unknown ones', async () => {
  const store = makeStore();
  const ctx = ctxFor(store);
  const ok = await runTool('report_issue', { node_or_edge_id: NODES.msb, description: 'Ramp blocked by a delivery van' }, ctx);
  assert.ok(ok.report_id);
  assert.equal(store.reports.get(ok.report_id).source, 'web-companion');
  const edge = await runTool('report_issue', { node_or_edge_id: 'eg_mu84rpty1i', description: 'Path flooded' }, ctx);
  assert.ok(edge.report_id);
  const bad = await runTool('report_issue', { node_or_edge_id: 'somewhere', description: 'Broken' }, ctx);
  assert.equal(bad.error, 'unknown_place');
});

test('HttpRoutingService: validates the engine response against the graph', async () => {
  const store = makeStore();
  const graph = await store.getGraph();
  const respond = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

  const good = new HttpRoutingService({
    url: 'https://routing.example/route',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.msbLabs], distance_m: 43.1, accessible: true, estimated_seconds: 61, blocked_segments: [] })
  });
  const route = await good.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, accessible: true, graph });
  assert.equal(route.distance_m, 43.1);
  assert.equal(route.estimated_seconds, 61);
  assert.equal(route.source, 'shared-routing-engine');

  const malformed = new HttpRoutingService({ url: 'x', timeoutMs: 1000, fetchImpl: respond({ route: 'somewhere' }) });
  assert.equal((await malformed.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, graph })).error, 'routing_service_bad_response');

  const wrongEnds = new HttpRoutingService({
    url: 'x',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.msbLabs], distance_m: 43, accessible: true, estimated_seconds: 61, blocked_segments: [] })
  });
  assert.equal((await wrongEnds.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.genmin, graph })).error, 'routing_service_bad_response');

  const phantomEdge = new HttpRoutingService({
    url: 'x',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.genmin], distance_m: 10, accessible: true, estimated_seconds: 40, blocked_segments: [] })
  });
  assert.equal((await phantomEdge.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.genmin, graph })).error, 'invalid_route');

  const down = new HttpRoutingService({ url: 'x', timeoutMs: 1000, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await down.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, graph })).error, 'routing_service_unreachable');
});

test('HttpRoutingService: engine errors pass through; id-token auth asks the metadata server', async () => {
  const graph = await makeStore().getGraph();
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers || {} });
    if (String(url).startsWith('http://metadata.google.internal')) return { ok: true, text: async () => 'id-token-123\n' };
    return { ok: false, status: 422, json: async () => ({ error: 'no_route', message: 'Failed to find the destination node.' }) };
  };
  const service = new HttpRoutingService({ url: 'https://routing-abc.a.run.app/v1/route', timeoutMs: 1000, fetchImpl, auth: 'id-token' });
  const result = await service.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.genmin, accessible: true, graph });
  assert.deepEqual(result, { error: 'no_route', message: 'Failed to find the destination node.' });
  assert.match(calls[0].url, /audience=https%3A%2F%2Frouting-abc\.a\.run\.app$/);
  assert.equal(calls[0].headers['Metadata-Flavor'], 'Google');
  assert.equal(calls[1].headers.authorization, 'Bearer id-token-123');
});
