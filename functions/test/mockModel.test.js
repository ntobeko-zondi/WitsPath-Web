'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMessage } = require('../src/companion/companion');
const { createMockAnthropic, parseIntent, MOCK_PREFIX } = require('../src/companion/mockModel');
const { makeDeps } = require('./helpers');

// The mock replaces the model only; store, tools, routing and the number guard are the real ones.
function mockDeps() {
  const deps = makeDeps([]);
  return { ...deps, anthropic: createMockAnthropic() };
}

const toolNames = (deps) => deps.events.filter((event) => event.event === 'tool_call').map((event) => event.name);

test('mock model: parses the fixed phrasings', () => {
  assert.deepEqual(parseIntent('How do I get from the Commerce Library to School of Business Sciences, and how far is it?'), {
    kind: 'route',
    from: 'Commerce Library',
    to: 'School of Business Sciences'
  });
  assert.deepEqual(parseIntent('Take me to Tower of Light from Commerce Library please'), {
    kind: 'route',
    from: 'Commerce Library',
    to: 'Tower of Light'
  });
  assert.deepEqual(parseIntent('Where is the Tower of Light?'), { kind: 'where', place: 'Tower of Light' });
  assert.deepEqual(parseIntent('How do I get to MSB?'), { kind: 'need_start', to: 'MSB' });
  assert.equal(parseIntent('hello').kind, 'help');
});

test('mock model: a route goes through find_place, get_route and get_travel_time and yields a route card', async () => {
  const deps = mockDeps();
  const result = await handleMessage(deps, { text: 'How do I get from Commerce Library to School of Business Sciences?' });

  assert.deepEqual(toolNames(deps), ['declare_language', 'find_place', 'find_place', 'get_route', 'get_travel_time']);
  assert.ok(result.reply.startsWith(MOCK_PREFIX));
  assert.match(result.reply, /about 68 metres/);
  assert.match(result.reply, /about 2 minutes \(an estimate, general pace\)/);
  assert.equal(result.guardTriggered, false);
  assert.equal(result.route.distanceM, 68.4);
  assert.equal(result.route.travelTime.minutes, 2);
});

test('mock model: no route from the engine -> says so, no distance, no card', async () => {
  const deps = mockDeps();
  const result = await handleMessage(deps, { text: 'from Flower Hall to the Law Clinic' });
  assert.match(result.reply, /can't confirm a step-free route/);
  assert.doesNotMatch(result.reply, /metres|minute/);
  assert.equal(result.route, null);
});

test('mock model: unknown places and unknown phrasings never guess', async () => {
  const unknown = await handleMessage(mockDeps(), { text: 'from the ATM to the Great Hall' });
  assert.match(unknown.reply, /couldn't find "ATM"/);
  assert.equal(unknown.route, null);

  const noStart = await handleMessage(mockDeps(), { text: 'How do I get to the Great Hall?' });
  assert.match(noStart.reply, /couldn't find "Great Hall"/);

  const needStart = await handleMessage(mockDeps(), { text: 'How do I get to the Tower of Light?' });
  assert.match(needStart.reply, /Where are you starting from/);

  const help = await handleMessage(mockDeps(), { text: 'hello there' });
  assert.match(help.reply, /Test mode/);
});

test('mock model: "where is" looks the place up', async () => {
  const deps = mockDeps();
  const result = await handleMessage(deps, { text: 'Where is the Tower of Light?' });
  assert.deepEqual(toolNames(deps), ['declare_language', 'find_place']);
  assert.match(result.reply, /I found .*Tower of Light/i);
});
