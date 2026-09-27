'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/api');
const { getShare, exportTranscript } = require('../src/share/share');
const { NODES, makeDeps, toolUse, callsTools, says } = require('./helpers');

function apiFor(deps, extra = {}) {
  return createApi({
    store: deps.store,
    routing: deps.routing,
    log: deps.log,
    getAnthropic: () => deps.anthropic,
    getVulavulaKey: () => '',
    verifyUser: async () => null,
    ...extra
  });
}

async function sessionWithRoute(api) {
  const response = await api({
    method: 'POST',
    path: '/api/companion/message',
    headers: {},
    body: { text: 'I use a wheelchair. MSB labs to Genmin please' }
  });
  assert.equal(response.status, 200);
  assert.ok(response.json.route);
  return response.json.sessionId;
}

const routeScript = () => [
  callsTools(toolUse('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true })),
  says('Found a step-free route of 82 metres. Steps below.')
];

test('share targets the exact route card, not just the latest route', async () => {
  const deps = makeDeps([
    ...routeScript(),
    callsTools(toolUse('get_route', { from_node_id: NODES.msb, to_node_id: NODES.msbLabs, accessible: true })),
    says('Second route found.')
  ]);
  const api = apiFor(deps);
  const first = await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { text: 'MSB labs to Genmin' } });
  const sessionId = first.json.sessionId;
  await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { sessionId, text: 'MSB to MSB labs' } });

  const shared = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId, routeId: first.json.route.routeId } });
  const card = await api({ method: 'GET', path: `/api/share/${shared.json.shareId}`, headers: {} });
  assert.equal(card.json.to, 'Genmin Laboratories');
  assert.equal(card.json.routeId, undefined);
});

test('share and export explain a missing session (e.g. dev server restarted)', async () => {
  const api = apiFor(makeDeps([]));
  const share = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId: 'gone-after-restart', routeId: 'x' } });
  assert.deepEqual([share.status, share.json.error], [404, 'session_not_found']);
  const exported = await api({ method: 'POST', path: '/api/companion/export', headers: {}, body: { sessionId: 'gone-after-restart' } });
  assert.deepEqual([exported.status, exported.json.error], [404, 'session_not_found']);
});

test('test case 7 (share): link exposes only the route card fields', async () => {
  const deps = makeDeps(routeScript());
  const api = apiFor(deps);
  const sessionId = await sessionWithRoute(api);

  const created = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId } });
  assert.equal(created.status, 201);
  assert.match(created.json.path, /^\/share\/[A-Za-z0-9_-]+$/);

  const fetched = await api({ method: 'GET', path: `/api/share/${created.json.shareId}`, headers: {} });
  assert.equal(fetched.status, 200);
  assert.deepEqual(Object.keys(fetched.json).sort(), ['accessible', 'createdAt', 'distanceM', 'expiresAt', 'from', 'steps', 'to']);
  for (const step of fetched.json.steps) {
    assert.deepEqual(Object.keys(step).sort(), ['lang', 'params', 'phraseKey', 'text']);
  }
  const serialized = JSON.stringify(fetched.json);
  for (const secret of [sessionId, created.json.revokeToken, 'wheelchair', 'revoke', 'nd_']) {
    assert.ok(!serialized.includes(secret), `share leaked ${secret}`);
  }

  const days = (new Date(fetched.json.expiresAt) - new Date(fetched.json.createdAt)) / 86400000;
  assert.equal(Math.round(days), 30);
});

test('share: revocable only with the revoke token, then gone', async () => {
  const deps = makeDeps(routeScript());
  const api = apiFor(deps);
  const sessionId = await sessionWithRoute(api);
  const { json } = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId } });

  const wrong = await api({ method: 'DELETE', path: `/api/share/${json.shareId}`, headers: { 'x-revoke-token': 'guess' } });
  assert.equal(wrong.status, 404);
  const right = await api({ method: 'DELETE', path: `/api/share/${json.shareId}`, headers: { 'x-revoke-token': json.revokeToken } });
  assert.equal(right.status, 204);
  const after = await api({ method: 'GET', path: `/api/share/${json.shareId}`, headers: {} });
  assert.equal(after.status, 404);
});

test('share: expired links return nothing; sessions without a route cannot share', async () => {
  const deps = makeDeps([...routeScript(), says('Hello')]);
  const api = apiFor(deps);
  const sessionId = await sessionWithRoute(api);
  const { json } = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId } });
  assert.equal(await getShare(deps.store, json.shareId, new Date(Date.now() + 31 * 86400000)), null);

  const noRoute = await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { text: 'hi' } });
  const share = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId: noRoute.json.sessionId } });
  assert.equal(share.status, 404);
  const bogus = await api({ method: 'POST', path: '/api/share', headers: {}, body: { sessionId: 'not-a-session' } });
  assert.equal(bogus.status, 404);
});

test('transcript export: report content and mobility details removed unless opted in', async () => {
  const deps = makeDeps([
    says('Shall I report "ramp blocked" at MSB?'),
    callsTools(toolUse('report_issue', { node_or_edge_id: NODES.msb, description: 'ramp blocked' })),
    says('Reported.'),
    says('Hello again.')
  ]);
  const api = apiFor(deps);
  const first = await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { text: 'The MSB ramp is blocked' } });
  const sessionId = first.json.sessionId;
  await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { sessionId, text: 'yes report it' } });
  await api({ method: 'POST', path: '/api/companion/message', headers: {}, body: { sessionId, text: 'I use a wheelchair, thanks' } });

  const safe = await exportTranscript(deps.store, sessionId);
  assert.doesNotMatch(safe, /ramp is blocked/);
  assert.doesNotMatch(safe, /wheelchair/i);
  assert.match(safe, /issue-report details/);

  const full = await exportTranscript(deps.store, sessionId, { includeReports: true, includeMobility: true });
  assert.match(full, /ramp is blocked/);
  assert.match(full, /wheelchair/);
});

test('config endpoint lists all 11 languages with honest tiers and no secrets', async () => {
  const deps = makeDeps([]);
  const api = apiFor(deps, { getVulavulaKey: () => 'secret-vulavula-key' });
  const response = await api({ method: 'GET', path: '/api/companion/config', headers: {} });
  assert.equal(response.json.languages.length, 11);
  const full = response.json.languages.filter((lang) => lang.tier === 'full').map((lang) => lang.code);
  assert.deepEqual(full.sort(), ['af', 'en', 'st', 'zu']);
  const coverage = Object.fromEntries(response.json.languages.map((lang) => [lang.code, lang.directionsVerified.verified]));
  assert.ok(coverage.en > 0);
  assert.equal(coverage.zu, 0); // the seeded isiZulu draft is unverified
  assert.equal(response.json.voice.vulavulaTranscription, true);
  assert.doesNotMatch(JSON.stringify(response.json), /secret-vulavula-key/);
});

test('transcription endpoint reports 501 when Vulavula is not configured', async () => {
  const api = apiFor(makeDeps([]));
  const response = await api({ method: 'POST', path: '/api/speech/transcribe', headers: { 'content-type': 'audio/ogg' }, rawBody: Buffer.from('x') });
  assert.equal(response.status, 501);
});

test('unknown API routes 404', async () => {
  const api = apiFor(makeDeps([]));
  assert.equal((await api({ method: 'GET', path: '/api/nope', headers: {} })).status, 404);
});
