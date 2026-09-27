'use strict';

const { MemoryStore } = require('../src/store/memoryStore');
const { loadSeedData } = require('../src/store/seedData');
const { createRoutingService } = require('../src/routing/routingService');

// Node ids from data/wits-west-map.json.
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
  return new MemoryStore(loadSeedData());
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

function makeDeps(script, { routingMode = 'fixture', store = makeStore() } = {}) {
  const anthropic = scriptedAnthropic(script);
  const routing = createRoutingService({ mode: routingMode, store });
  const events = [];
  return { anthropic, store, routing, log: (event, data) => events.push({ event, ...data }), events };
}

/** The tool results the orchestrator sent back on a given model call. */
function toolResultsSentOn(call) {
  const last = call.messages[call.messages.length - 1];
  return last.content
    .filter((block) => block.type === 'tool_result')
    .map((block) => ({ ...JSON.parse(block.content), is_error: Boolean(block.is_error) }));
}

module.exports = { NODES, makeStore, makeDeps, toolUse, callsTools, says, toolResultsSentOn };
