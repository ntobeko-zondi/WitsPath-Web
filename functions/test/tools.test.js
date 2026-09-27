'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runTool } = require('../src/tools/handlers');
const { createRoutingService, HttpRoutingService } = require('../src/routing/routingService');
const { NODES, makeStore } = require('./helpers');

function ctxFor(store, routingMode = 'fixture') {
  return {
    store,
    routing: createRoutingService({ mode: routingMode, store }),
    groundedDistances: new Set()
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
    assert.deepEqual(Object.keys(result.matches[0]).sort(), ['building', 'confidence', 'floor', 'id', 'name']);
  }
});

test('find_place: accessible_only flags that entrance accessibility is unverified', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('find_place', { query: 'Flower Hall', accessible_only: true }, ctx);
  assert.equal(result.matches[0].id, NODES.flowerHall);
  assert.deepEqual(result.entrance_accessibility_unverified, [NODES.flowerHall]);
});

test('get_route: pair without route data returns an explicit error', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: NODES.flowerHall, to_node_id: NODES.lawClinic, accessible: true }, ctx);
  assert.equal(result.error, 'no_route_data');
  assert.equal(result.distance_m, undefined);
  assert.equal(result.path, undefined);
  assert.equal(ctx.route, undefined);
});

test('get_route: unavailable routing mode fails closed', async () => {
  const ctx = ctxFor(makeStore(), 'unavailable');
  const result = await runTool('get_route', { from_node_id: NODES.msb, to_node_id: NODES.msbLabs, accessible: true }, ctx);
  assert.equal(result.error, 'routing_unavailable');
});

test('get_route: fixture route uses graph edge distances and is labelled placeholder', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: NODES.commerceLibrary, to_node_id: NODES.towerOfLight, accessible: true }, ctx);
  assert.equal(result.distance_m, 37.1); // 16.32 + 20.76 from the graph edges
  assert.equal(result.accessible, true);
  assert.deepEqual(result.blocked_segments, []);
  assert.match(result.data_source, /placeholder/);
  assert.equal(result.path.length, 3);
});

test('get_route: fixtures work in reverse', async () => {
  const ctx = ctxFor(makeStore());
  const result = await runTool('get_route', { from_node_id: NODES.towerOfLight, to_node_id: NODES.commerceLibrary, accessible: true }, ctx);
  assert.equal(result.path[0].node_id, NODES.towerOfLight);
  assert.equal(result.path[2].node_id, NODES.commerceLibrary);
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

test('get_travel_time: grounded distance gives a labelled estimate', async () => {
  const ctx = ctxFor(makeStore());
  await runTool('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true }, ctx);
  const wheelchair = await runTool('get_travel_time', { distance_m: 82, mobility_profile: 'wheelchair' }, ctx);
  assert.equal(wheelchair.basis, 'estimate');
  assert.equal(wheelchair.minutes, 2); // 82 m / 0.8 m/s = 102.5 s -> rounded up
  const defaulted = await runTool('get_travel_time', { distance_m: 82 }, ctx);
  assert.equal(defaulted.mobility_profile, 'wheelchair');
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

test('HttpRoutingService: validates the shared service response against the graph', async () => {
  const store = makeStore();
  const graph = await store.getGraph();
  const respond = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

  const good = new HttpRoutingService({
    url: 'https://routing.example/route',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.msbLabs], distance_m: 43.1, accessible: true, blocked_segments: [] })
  });
  const route = await good.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, accessible: true, graph });
  assert.equal(route.distance_m, 43.1);
  assert.equal(route.source, 'shared-routing-service');

  const malformed = new HttpRoutingService({ url: 'x', timeoutMs: 1000, fetchImpl: respond({ route: 'somewhere' }) });
  assert.equal((await malformed.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, graph })).error, 'routing_service_bad_response');

  const wrongEnds = new HttpRoutingService({
    url: 'x',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.msbLabs], distance_m: 43, accessible: true, blocked_segments: [] })
  });
  assert.equal((await wrongEnds.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.genmin, graph })).error, 'routing_service_bad_response');

  const phantomEdge = new HttpRoutingService({
    url: 'x',
    timeoutMs: 1000,
    fetchImpl: respond({ path: [NODES.msb, NODES.genmin], distance_m: 10, accessible: true, blocked_segments: [] })
  });
  assert.equal((await phantomEdge.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.genmin, graph })).error, 'invalid_route');

  const down = new HttpRoutingService({ url: 'x', timeoutMs: 1000, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await down.getRoute({ fromNodeId: NODES.msb, toNodeId: NODES.msbLabs, graph })).error, 'routing_service_unreachable');
});
