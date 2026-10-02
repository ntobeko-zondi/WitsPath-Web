'use strict';

const { MemoryStore } = require('../src/store/memoryStore');
const { loadSeedData } = require('../src/store/seedData');

const WEST_CAMPUS_MAP = 'public/data/wits-west-map.json';
const { createRoutingService } = require('../src/routing/routingService');

// Node ids from public/data/wits-west-map.json.
const NODES = {
  msb: 'nd_mu842mili',
  msbLabs: 'nd_mu84hhsut',
  genmin: 'nd_mu842rrrm',
  commerceLibrary: 'nd_mu83zm0ga',
  towerOfLight: 'nd_mu842iq9f',
  businessSciences: 'nd_mu842ho1e',
  flowerHall: 'nd_mu842wbxp',
  lawClinic: 'nd_mu83zkqw9'
};

function makeStore() {
  // These tests use fixed ids from the original West Campus map, so they pin that file.
  return new MemoryStore(loadSeedData({ graphFile: WEST_CAMPUS_MAP }));
}

/**
 * Scripted stand-in for the Anthropic client. Each entry in `script` is a
 * function (params) => response, consumed one per messages.create call.
 */
function scriptedAnthropic(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(structuredClone(params));
        const next = script.shift();
        if (!next) throw new Error('Scripted model ran out of responses');
        return next(params);
      }
    }
  };
}

let toolCounter = 0;
function toolUse(name, input) {
  toolCounter += 1;
  return { type: 'tool_use', id: `toolu_${toolCounter}`, name, input };
}

function callsTools(...blocks) {
  return () => ({ stop_reason: 'tool_use', content: blocks });
}

function says(text) {
  return () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
}

/**
 * Responses recorded from the real routing engine (routing/, run on
 * public/data/wits-west-map.json). The unit tests replay them instead of
 * searching, so the website's tests never contain a second pathfinder;
 * engine.test.js checks the real engine still returns these.
 */
const ENGINE_ROUTES = [
  { path: [NODES.msbLabs, NODES.genmin], edge_ids: ['eg_mu84s1hg1n'], distance_m: 82, estimated_seconds: 89 },
  { path: [NODES.msb, NODES.msbLabs], edge_ids: ['eg_mu84rpty1i'], distance_m: 43.1, estimated_seconds: 61 },
  {
    path: [NODES.commerceLibrary, 'nd_mu84lizxy', NODES.businessSciences],
    edge_ids: ['eg_mu84qzsn18', 'eg_mu84wk6m2c'],
    distance_m: 68.4,
    estimated_seconds: 79
  },
  {
    path: [NODES.commerceLibrary, 'nd_mu84lizxy', NODES.towerOfLight],
    edge_ids: ['eg_mu84qzsn18', 'eg_mu84r22d19'],
    distance_m: 37.1,
    estimated_seconds: 56
  }
];

/**
 * Stand-in for the routing engine's HTTP API. Pairs not in ENGINE_ROUTES get
 * the engine's "no_route" error. Records every request body.
 */
function fakeEngine(routes = ENGINE_ROUTES) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const json = (status, payload) => ({ ok: status < 400, status, json: async () => payload });
    for (const route of routes) {
      const forward = route.path[0] === body.from_node_id && route.path[route.path.length - 1] === body.to_node_id;
      const backward = route.path[0] === body.to_node_id && route.path[route.path.length - 1] === body.from_node_id;
      if (forward || backward) {
        return json(200, {
          path: forward ? route.path : [...route.path].reverse(),
          edge_ids: forward ? route.edge_ids : [...route.edge_ids].reverse(),
          distance_m: route.distance_m,
          accessible: true,
          estimated_seconds: route.estimated_seconds,
          blocked_segments: [],
          engine: 'fake'
        });
      }
    }
    return json(422, { error: 'no_route', message: 'Failed to find an accessible route to the destination node.' });
  };
  return { fetchImpl, requests };
}

function makeRouting(mode = 'http', engine = fakeEngine()) {
  return createRoutingService({ mode, url: 'http://routing.test/v1/route', timeoutMs: 1000, fetchImpl: engine.fetchImpl });
}

function makeDeps(script, { routingMode = 'http', store = makeStore(), engine = fakeEngine() } = {}) {
  const anthropic = scriptedAnthropic(script);
  const routing = makeRouting(routingMode, engine);
  const events = [];
  return { anthropic, store, routing, engine, log: (event, data) => events.push({ event, ...data }), events };
}

/** The tool results the orchestrator sent back on a given model call. */
function toolResultsSentOn(call) {
  const last = call.messages[call.messages.length - 1];
  return last.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => ({ ...JSON.parse(block.content), is_error: Boolean(block.is_error) }));
}

module.exports = {
  NODES,
  ENGINE_ROUTES,
  makeStore,
  makeDeps,
  makeRouting,
  fakeEngine,
  toolUse,
  callsTools,
  says,
  toolResultsSentOn
};
