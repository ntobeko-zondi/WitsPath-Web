'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/api');
const { fileReport, applyFlagging, listMyReports, FLAG_WINDOW_DAYS } = require('../src/reports/reports');
const { runTool } = require('../src/tools/handlers');
const { NODES, makeStore, makeDeps, makeRouting } = require('./helpers');

const EDGE = 'eg_mu84r22d19'; // Commerce Library Ramp - Tower of Light

function apiWithUsers(store) {
  const deps = makeDeps([], { store });
  // Test tokens: "Bearer uid:<uid>".
  const verifyUser = async (headers) => {
    const match = /^Bearer uid:(.+)$/.exec(headers.authorization || '');
    return match ? { uid: match[1], email: `${match[1]}@students.wits.ac.za`, name: null } : null;
  };
  return createApi({ store, routing: deps.routing, getAnthropic: () => null, getVulavulaKey: () => '', verifyUser });
}

const as = (uid) => ({ authorization: `Bearer uid:${uid}` });

test('reports use the Android schema: edge reports carry edgeId, place reports nodeId', async () => {
  const store = makeStore();
  const onEdge = await fileReport(store, { userId: 'u1', target: EDGE, issueType: 'blocked_or_broken_ramp', source: 'web' });
  const onPlace = await fileReport(store, { userId: 'u1', target: NODES.msb, issueType: 'broken_lift', source: 'web' });
  const edgeDoc = store.reports.get(onEdge.reportId);
  assert.deepEqual(
    { userId: edgeDoc.userId, edgeId: edgeDoc.edgeId, nodeId: edgeDoc.nodeId, issueType: edgeDoc.issueType },
    { userId: 'u1', edgeId: EDGE, nodeId: null, issueType: 'blocked_or_broken_ramp' }
  );
  assert.ok(edgeDoc.timestamp instanceof Date);
  assert.equal(store.reports.get(onPlace.reportId).nodeId, NODES.msb);
  assert.equal(store.reports.get(onPlace.reportId).edgeId, null);

  assert.equal((await fileReport(store, { userId: 'u1', target: EDGE, issueType: 'on_fire' })).error, 'invalid_input');
  assert.equal((await fileReport(store, { userId: 'u1', target: 'nowhere' })).error, 'unknown_place');
  assert.equal(store.reports.get((await fileReport(store, { userId: 'u1', target: EDGE })).reportId).issueType, 'other');
});

test('flagging: 3 different signed-in people within 30 days flag the edge; then routes avoid it', async () => {
  const store = makeStore();
  const edgeStatus = async () => (await store.getEdge(EDGE)).status;

  // One person reporting three times is still one person.
  for (let i = 0; i < 3; i += 1) await fileReport(store, { userId: 'same', target: EDGE, source: 'web' });
  assert.equal(await edgeStatus(), 'ok');
  // Anonymous reports never count.
  await fileReport(store, { userId: null, target: EDGE, source: 'web-companion' });
  await fileReport(store, { userId: null, target: EDGE, source: 'web-companion' });
  assert.equal(await edgeStatus(), 'ok');

  await fileReport(store, { userId: 'second', target: EDGE, source: 'web' });
  const third = await fileReport(store, { userId: 'third', target: EDGE, source: 'web' });
  assert.equal(third.flagged, true);
  assert.equal(await edgeStatus(), 'flagged');

  // The route planner now refuses the route through the flagged path.
  const ctx = { store, routing: makeRouting(), groundedRoutes: [], speedMultiplier: 1 };
  const route = await runTool('get_route', { from_node_id: NODES.commerceLibrary, to_node_id: NODES.towerOfLight, accessible: true }, ctx);
  assert.equal(route.error, 'route_blocked');

  // And the companion's path check says so.
  const status = await runTool('check_path_status', { node_ids: [NODES.towerOfLight] }, ctx);
  assert.equal(status.clear, false);
  assert.match(status.issues[0].reason, /flagged by several user reports/);
});

test('flagging ignores reports older than the window and never touches unknown edges', async () => {
  const store = makeStore();
  const now = new Date('2026-09-28T12:00:00Z');
  const old = new Date(now.getTime() - (FLAG_WINDOW_DAYS + 1) * 86400000);
  for (const userId of ['a', 'b']) await store.addReport({ userId, edgeId: EDGE, issueType: 'other', timestamp: old });
  await fileReport(store, { userId: 'c', target: EDGE, source: 'web' }, now);
  assert.equal((await store.getEdge(EDGE)).status, 'ok');

  // The Android app currently files reports against "placeholder_edge_id".
  for (const userId of ['a', 'b', 'c']) await store.addReport({ userId, edgeId: 'placeholder_edge_id', timestamp: now });
  assert.equal(await applyFlagging(store, 'placeholder_edge_id', now), false);
  assert.equal(await store.getEdge('placeholder_edge_id'), null);
});

test('My reports: newest first, readable place, pending/flagged like the Android screen', async () => {
  const store = makeStore();
  await fileReport(store, { userId: 'me', target: NODES.msb, issueType: 'broken_lift', source: 'web' }, new Date('2026-09-01'));
  await fileReport(store, { userId: 'me', target: EDGE, issueType: 'path_obstructed', source: 'web' }, new Date('2026-09-20'));
  await store.setEdgeStatus(EDGE, 'flagged');
  await fileReport(store, { userId: 'someone-else', target: EDGE, source: 'web' });

  const mine = await listMyReports(store, 'me');
  assert.equal(mine.length, 2);
  assert.deepEqual(
    mine.map(({ issueType, place, status }) => ({ issueType, place, status })),
    [
      { issueType: 'path_obstructed', place: 'Commerce Library - Ramp – Tower of Light', status: 'flagged' },
      { issueType: 'broken_lift', place: 'Mathematical Science Building (MSB)', status: 'pending' }
    ]
  );
});

test('account API: sign-in required everywhere; profile and preferences match the Android users doc', async () => {
  const store = makeStore();
  const api = apiWithUsers(store);

  for (const [method, path] of [['GET', '/api/me'], ['PUT', '/api/me/preferences'], ['POST', '/api/reports'], ['GET', '/api/reports/mine']]) {
    assert.equal((await api({ method, path, headers: {}, body: {} })).status, 401, `${method} ${path}`);
  }

  const saved = await api({ method: 'PUT', path: '/api/me/profile', headers: as('lindiwe'), body: { displayName: '  Lindiwe  M ', mobilityProfile: 'wheelchair' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(await store.getUser('lindiwe'), {
    displayName: 'Lindiwe M',
    email: 'lindiwe@students.wits.ac.za',
    preferences: { pref_mobility_profile: 'wheelchair' }
  });

  const prefs = await api({
    method: 'PUT',
    path: '/api/me/preferences',
    headers: as('lindiwe'),
    body: { preferences: { pref_step_free_only: true, pref_text_size: 'large', pref_walking_speed_multiplier: '0.8', pref_ui_language: 'zu' } }
  });
  assert.equal(prefs.status, 200);
  assert.deepEqual(prefs.json.preferences, {
    pref_mobility_profile: 'wheelchair',
    pref_step_free_only: true,
    pref_text_size: 'large',
    pref_walking_speed_multiplier: '0.8',
    pref_ui_language: 'zu'
  });

  const rejected = await api({
    method: 'PUT',
    path: '/api/me/preferences',
    headers: as('lindiwe'),
    body: { preferences: { pref_text_size: 'gigantic', pref_is_admin: true, pref_walking_speed_multiplier: '9' } }
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.message, /pref_text_size.*pref_is_admin.*pref_walking_speed_multiplier/);

  const me = await api({ method: 'GET', path: '/api/me', headers: as('lindiwe') });
  assert.equal(me.json.displayName, 'Lindiwe M');
});

test('reports API: file and list my reports', async () => {
  const store = makeStore();
  const api = apiWithUsers(store);
  const filed = await api({ method: 'POST', path: '/api/reports', headers: as('u9'), body: { target: EDGE, issueType: 'blocked_or_broken_ramp' } });
  assert.equal(filed.status, 201);
  assert.equal(filed.json.countsTowardFlag, true);
  const bad = await api({ method: 'POST', path: '/api/reports', headers: as('u9'), body: { target: 'nowhere' } });
  assert.equal(bad.status, 400);
  const mine = await api({ method: 'GET', path: '/api/reports/mine', headers: as('u9') });
  assert.equal(mine.json.reports.length, 1);
  assert.equal(mine.json.reports[0].issueType, 'blocked_or_broken_ramp');
  assert.equal((await api({ method: 'GET', path: '/api/reports/mine', headers: as('other') })).json.reports.length, 0);
});
