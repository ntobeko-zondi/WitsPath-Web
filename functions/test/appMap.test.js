'use strict';

// The companion must use the SAME map as the Android app (its route cards carry this map's place ids), and its
// place search must find real destinations on that map. The app's map is public/data/wits-braamfontein-map.json.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { MemoryStore } = require('../src/store/memoryStore');
const { loadSeedData, DEFAULT_GRAPH_FILE, resolveGraphPath } = require('../src/store/seedData');
const { matchPlaces } = require('../src/places/placeMatcher');
const { runTool } = require('../src/tools/handlers');
const { HttpRoutingService } = require('../src/routing/routingService');

// Place ids on the app's map.
const WITS_PLUS_ENTRANCE_1 = 'nd_muosnjmh6c';
const WITS_PLUS_ENTRANCE_2 = 'nd_muosnjmh6f';
const WITS_PLUS_PARKING = 'nd_muosnjmi8h';
const COMMERCE_LAW_MGMT_ENTRANCE = 'nd_muosnjmh6b';
const COMMERCE_LIBRARY_PARKING = 'nd_muosnjmi8e';
const WARTENWEILER_STAIRS = 'nd_muosnjmi87';

const store = new MemoryStore(loadSeedData());
const find = (query, accessibleOnly = true) => matchPlaces(query, store.places, { accessibleOnly });
const ids = (matches) => matches.map((match) => match.place.id);

test('the companion loads the app\'s map by default', () => {
  assert.equal(DEFAULT_GRAPH_FILE, path.join('public', 'data', 'wits-braamfontein-map.json'));
  const graph = loadSeedData().graph;
  assert.equal(graph.nodes.length, 590);
  assert.equal(graph.floors[0].name, 'Wits University Braamfontein Campus Map');
  assert.ok(graph.nodes.some((node) => node.nodeId === WITS_PLUS_ENTRANCE_1));
});

test('a different map can be chosen with graphFile or GRAPH_FILE', () => {
  assert.equal(loadSeedData({ graphFile: 'public/data/wits-west-map.json' }).graph.nodes.length, 35);
  const before = process.env.GRAPH_FILE;
  try {
    process.env.GRAPH_FILE = 'public/data/wits-west-map.json';
    assert.equal(loadSeedData().graph.nodes.length, 35);
    assert.equal(path.isAbsolute(resolveGraphPath()), true);
  } finally {
    if (before === undefined) delete process.env.GRAPH_FILE;
    else process.env.GRAPH_FILE = before;
  }
});

test('"Wits Plus" gives the entrance, never the parking bay', () => {
  const matches = find('Wits Plus');
  assert.deepEqual(ids(matches).filter((id) => id === WITS_PLUS_PARKING), []);
  assert.equal(matches.length, 1, 'two identical entrances are offered as one');
  assert.equal(matches[0].place.id, WITS_PLUS_ENTRANCE_1);
  assert.deepEqual(matches[0].alternates.map((place) => place.id), [WITS_PLUS_ENTRANCE_2]);
});

test('"Commerce building" finds the Commerce, Law & Management entrance', () => {
  for (const query of ['Commerce building', 'the commerce building', 'Commerce']) {
    const matches = find(query);
    assert.equal(matches[0]?.place.id, COMMERCE_LAW_MGMT_ENTRANCE, query);
    assert.ok(!ids(matches).includes(COMMERCE_LIBRARY_PARKING), `${query} must not offer parking`);
  }
});

test('"Commerce Library" has no entrance on the map, so its parking bay is used instead of nothing', () => {
  const matches = find('Commerce Library');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].place.id, COMMERCE_LIBRARY_PARKING);
  assert.equal(matches[0].noEntranceMapped, true, 'flagged so the companion can say it is the closest mapped point');
});

test('a parking bay is NOT used when its building has an entrance', () => {
  // Wits Plus has entrances, so its parking bay stays out of the way unless the user asks for parking.
  const matches = find('Wits Plus');
  assert.ok(!ids(matches).includes(WITS_PLUS_PARKING));
  assert.ok(matches.every((match) => !match.noEntranceMapped));
  // A loose fit is not enough: "commerce" is only part of the library's name.
  assert.ok(!ids(find('Commerce')).includes(COMMERCE_LIBRARY_PARKING));
  assert.ok(!ids(find('Commerce building')).includes(COMMERCE_LIBRARY_PARKING));
});

test('searches work in lower, upper and mixed case, with extra spaces and punctuation', () => {
  const queries = ['Wits Plus', 'Commerce building', 'Commerce Library', 'Wartenweiler Library stairs', 'Wits Plus disabled parking', 'William Cullen Library'];
  for (const query of queries) {
    const expected = JSON.stringify(find(query).map((match) => [match.place.id, match.confidence]));
    assert.notEqual(expected, '[]', `${query} should find something`);
    for (const variant of [query.toLowerCase(), query.toUpperCase(), `  ${query.toLowerCase()}  `, query.toLowerCase().replace(/ /g, '   '), `${query.toLowerCase()}?`]) {
      assert.equal(JSON.stringify(find(variant).map((match) => [match.place.id, match.confidence])), expected, JSON.stringify(variant));
    }
  }
});

test('parking, stairs and gates are found when the user asks for them', () => {
  assert.equal(find('Wits Plus disabled parking')[0]?.place.id, WITS_PLUS_PARKING);
  assert.equal(find('parking at Commerce Library')[0]?.place.id, COMMERCE_LIBRARY_PARKING);
  assert.equal(find('Wartenweiler Library stairs')[0]?.place.id, WARTENWEILER_STAIRS);
  const gates = find('vehicle gate');
  assert.equal(gates[0]?.place.kind, 'gate');
  assert.ok(gates[0].place.name.toLowerCase().includes('vehicle gate'));
});

test('ordinary names still find their building, and nonsense finds nothing', () => {
  assert.equal(find('Wartenweiler Library')[0]?.place.name.startsWith('Wartenweiler Library'), true);
  assert.equal(find('William Cullen Library')[0]?.place.name.startsWith('William Cullen Library'), true);
  assert.deepEqual(find('nearest ATM'), []);
  assert.deepEqual(find('zzzzzz qqqq'), []);
});

test('find_place flags a parking bay that stands in for a missing entrance', async () => {
  const ctx = { store, routing: null, groundedRoutes: [], speedMultiplier: 1 };
  for (const query of ['commerce library', 'Commerce Library']) {
    const result = await runTool('find_place', { query, accessible_only: true }, ctx);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, COMMERCE_LIBRARY_PARKING);
    assert.equal(result.matches[0].no_entrance_mapped, true);
  }
  const wits = await runTool('find_place', { query: 'wits plus', accessible_only: true }, ctx);
  assert.equal(wits.matches[0].no_entrance_mapped, undefined);
});

test('a stairs place is never a default destination', () => {
  for (const query of ['Wartenweiler Library', 'library']) {
    assert.ok(!ids(find(query)).includes(WARTENWEILER_STAIRS), query);
  }
});

test('find_place tells the model about identical doors instead of letting it ask which one', async () => {
  const result = await runTool('find_place', { query: 'Wits Plus', accessible_only: true }, {
    store,
    routing: null,
    groundedRoutes: [],
    speedMultiplier: 1
  });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, WITS_PLUS_ENTRANCE_1);
  assert.deepEqual(result.matches[0].other_entrance_ids, [WITS_PLUS_ENTRANCE_2]);
});

// ---- the real routing engine on the app's map ----

const JAR = path.resolve(__dirname, '..', '..', 'routing', 'build', 'witspath-routing.jar');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startEngine() {
  const port = await freePort();
  const child = spawn('java', ['-jar', JAR], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('routing engine did not start');
}

test('the real engine routes Wits Plus to Commerce, Law & Management on the app map',
  { skip: !fs.existsSync(JAR) && 'engine not built' }, async (t) => {
    let engine;
    try {
      engine = await startEngine();
    } catch (error) {
      t.skip(`could not start the engine: ${error.message}`);
      return;
    }
    try {
      const graph = await store.getGraph();
      const client = new HttpRoutingService({ url: `${engine.url}/v1/route`, timeoutMs: 15000 });
      const route = await client.getRoute({
        fromNodeId: WITS_PLUS_ENTRANCE_1,
        toNodeId: COMMERCE_LAW_MGMT_ENTRANCE,
        accessible: true,
        graph
      });
      assert.equal(route.error, undefined, JSON.stringify(route));
      assert.equal(route.path[0].node_id, WITS_PLUS_ENTRANCE_1);
      assert.equal(route.path[route.path.length - 1].node_id, COMMERCE_LAW_MGMT_ENTRANCE);
      assert.ok(route.distance_m > 0);
      // Every place id in the route is a place on the app's map, so the app can show it.
      const known = new Set(graph.nodes.map((node) => node.nodeId));
      assert.ok(route.path.every((node) => known.has(node.node_id)));
    } finally {
      engine.child.kill();
    }
  });
