'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { handleMessage, SAFE_REPLY, CompanionError } = require('../src/companion/companion');
const { SYSTEM_PROMPT, BASE_PROMPT } = require('../src/companion/systemPrompt');
const config = require('../src/config');
const { NODES, makeDeps, toolUse, callsTools, says, toolResultsSentOn } = require('./helpers');

test('system prompt keeps the validated base rules verbatim', () => {
  assert.ok(SYSTEM_PROMPT.startsWith(BASE_PROMPT));
  assert.match(BASE_PROMPT, /Never invent a route, distance, or travel time/);
});

test('uses the model named in the brief and sends tools + system prompt', async () => {
  const deps = makeDeps([says('Hi! Where would you like to go?')]);
  await handleMessage(deps, { text: 'hello' });
  const call = deps.anthropic.calls[0];
  assert.equal(call.model, 'claude-haiku-4-5-20251001');
  assert.equal(call.system, SYSTEM_PROMPT);
  assert.deepEqual(
    call.tools.map((tool) => tool.name),
    ['find_place', 'get_route', 'get_travel_time', 'check_path_status', 'report_issue', 'declare_language']
  );
});

test('test case 1 (no hallucination): unseeded pair -> error reaches the model, no route card', async () => {
  const deps = makeDeps([
    callsTools(toolUse('declare_language', { lang: 'en' }), toolUse('get_route', { from_node_id: NODES.flowerHall, to_node_id: NODES.lawClinic, accessible: true })),
    says("I can't confirm a route between Flower Hall and the Law Clinic right now.")
  ]);
  const result = await handleMessage(deps, { text: 'How do I get from Flower Hall to the Law Clinic?' });

  const [, routeResult] = toolResultsSentOn(deps.anthropic.calls[1]);
  assert.equal(routeResult.error, 'no_route_data');
  assert.equal(routeResult.is_error, true);
  assert.match(routeResult.instruction, /can't confirm a route/);
  assert.equal(result.route, null);
  assert.equal(result.guardTriggered, false);
});

test('number guard: a distance the tools never produced is replaced with a safe reply', async () => {
  const deps = makeDeps([says("It's about 250 m, roughly 4 minutes.")]);
  const result = await handleMessage(deps, { text: 'How far is Flower Hall from the Law Clinic?' });
  assert.equal(result.reply, SAFE_REPLY);
  assert.equal(result.guardTriggered, true);
  assert.ok(deps.events.some((event) => event.event === 'number_guard_triggered'));

  // The stored history reflects what the user saw, not the invented figure.
  const session = await deps.store.getSession(result.sessionId);
  assert.doesNotMatch(session.transcriptJson, /250 m/);
});

test('grounded route: numbers from tools pass, and the route card is built from templates', async () => {
  const deps = makeDeps([
    callsTools(toolUse('declare_language', { lang: 'en' }), toolUse('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true })),
    callsTools(toolUse('get_travel_time', { distance_m: 82, mobility_profile: 'wheelchair' })),
    says('Step-free route found: 82 m, about 2 minutes (estimate). The steps are below.')
  ]);
  const result = await handleMessage(deps, { text: 'MSB labs to Genmin?' });

  assert.equal(result.guardTriggered, false);
  assert.equal(result.route.from, 'Mathematical Science Labs');
  assert.equal(result.route.to, 'Genmin Laboratories');
  assert.equal(result.route.distanceM, 82);
  assert.equal(result.route.routingSource, 'placeholder-fixture');
  assert.deepEqual(result.route.travelTime, { minutes: 2, basis: 'estimate' });
  assert.deepEqual(
    result.route.steps.map((step) => step.phraseKey),
    ['route_summary', 'step_free_route', 'estimated_time', 'start_at', 'head_towards', 'arrive']
  );
  assert.equal(result.route.steps[0].text, 'Route to Genmin Laboratories: 82 m.');
  assert.equal(result.language.code, 'en');
  assert.equal(result.language.tier, 'full');
});

test('tool results from a previous turn stay grounded (follow-up travel time)', async () => {
  const deps = makeDeps([
    callsTools(toolUse('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true })),
    says('Route found, 82 m.'),
    callsTools(toolUse('get_travel_time', { distance_m: 82 })),
    says('About 2 minutes, as an estimate.')
  ]);
  const first = await handleMessage(deps, { text: 'MSB labs to Genmin?' });
  const second = await handleMessage(deps, { sessionId: first.sessionId, text: 'How long will that take?' });
  const [travel] = toolResultsSentOn(deps.anthropic.calls[3]);
  assert.equal(travel.minutes, 2);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.guardTriggered, false);
  // History replayed to the model includes the first turn.
  assert.ok(deps.anthropic.calls[2].messages.length > 1);
});

test('test case 5 (isiZulu): Tier 1 reply language is zu, directions use only verified templates', async () => {
  const deps = makeDeps([
    callsTools(toolUse('declare_language', { lang: 'zu' }), toolUse('get_route', { from_node_id: NODES.commerceLibrary, to_node_id: NODES.businessSciences, accessible: true })),
    says('Ngitholile indlela engenazitebhisi. Bheka izinyathelo ezingezansi.')
  ]);
  const result = await handleMessage(deps, { text: 'Ngifuna ukuya e-School of Business Sciences ngisuka e-Commerce Library' });

  assert.equal(result.language.code, 'zu');
  assert.equal(result.language.tier, 'full');
  assert.equal(result.route.directionsLang, 'zu');
  // No isiZulu phrase is verified yet (the seeded draft "Jika ngasekhohlo" has
  // no verifiedBy), so every step falls back to verified English.
  assert.equal(result.route.fallbackToEnglish, true);
  assert.ok(result.route.steps.every((step) => step.lang === 'en'));
  assert.ok(result.route.steps.every((step) => !step.text.includes('Jika ngasekhohlo')));
});

test('verified isiZulu templates are used once a reviewer signs them off', async () => {
  const deps = makeDeps([
    callsTools(toolUse('declare_language', { lang: 'zu' }), toolUse('get_route', { from_node_id: NODES.msbLabs, to_node_id: NODES.genmin, accessible: true })),
    says('Ngiyitholile indlela.')
  ]);
  deps.store.templates.zu.arrive = { text: 'Usufikile e-{place}.', verifiedBy: 'reviewer:test', verifiedAt: new Date() };
  const result = await handleMessage(deps, { text: 'Ngicela indlela eya e-Genmin' });
  const arrive = result.route.steps.find((step) => step.phraseKey === 'arrive');
  assert.equal(arrive.text, 'Usufikile e-Genmin Laboratories.');
  assert.equal(arrive.lang, 'zu');
  assert.equal(result.route.steps.find((step) => step.phraseKey === 'start_at').lang, 'en');
});

test('test case 6 (Xitsonga): reply is flagged as limited, not presented as supported', async () => {
  const deps = makeDeps([
    callsTools(toolUse('declare_language', { lang: 'ts' })),
    says('Ndzi nga ku pfuna ku kuma ndhawu. (Support for Xitsonga is limited and may contain mistakes.)')
  ]);
  const result = await handleMessage(deps, { text: 'Ndzi lava ku ya eka Tower of Light' });
  assert.equal(result.language.code, 'ts');
  assert.equal(result.language.tier, 'limited');
  const [declared] = toolResultsSentOn(deps.anthropic.calls[1]);
  assert.match(declared.guidance, /limited/i);
});

test('language is "unconfirmed" when the model does not declare one', async () => {
  const deps = makeDeps([says('Hello!')]);
  const result = await handleMessage(deps, { text: 'hi' });
  assert.deepEqual(result.language, { code: null, source: 'unconfirmed', tier: 'unconfirmed' });
});

test('user-selected reply language and voice notes are passed to the model', async () => {
  const deps = makeDeps([says('Sawubona!')]);
  const result = await handleMessage(deps, { text: 'sawubona', inputMode: 'voice', inputLang: 'zu', preferredLang: 'zu' });
  const firstContent = deps.anthropic.calls[0].messages[0].content;
  assert.match(firstContent[0].text, /spoken/);
  assert.match(firstContent[0].text, /"zu" as their reply language/);
  assert.equal(firstContent[1].text, 'sawubona');
  assert.equal(result.language.source, 'user-selected');
});

test('iteration cap: an unfinished tool loop yields a safe reply and well-formed history', async () => {
  const loop = Array.from({ length: config.MAX_TOOL_ITERATIONS }, () =>
    callsTools(toolUse('find_place', { query: 'MSB', accessible_only: true }))
  );
  const deps = makeDeps(loop);
  const result = await handleMessage(deps, { text: 'MSB?' });
  assert.match(result.reply, /couldn't finish/);
  const transcript = JSON.parse((await deps.store.getSession(result.sessionId)).transcriptJson);
  assert.equal(transcript.length, 2);
  assert.equal(transcript[1].role, 'assistant');
});

test('max_tokens mid tool call: the truncated call is never executed', async () => {
  const deps = makeDeps([
    () => ({ stop_reason: 'max_tokens', content: [toolUse('report_issue', { node_or_edge_id: NODES.msb, description: 'Ramp bl' })] })
  ]);
  const result = await handleMessage(deps, { text: 'Report the MSB ramp' });
  assert.equal(deps.store.reports.size, 0);
  assert.match(result.reply, /couldn't finish/);
});

test('API failures surface as a 503 CompanionError', async () => {
  const deps = makeDeps([
    () => {
      throw new Anthropic.APIConnectionError({ message: 'offline' });
    }
  ]);
  await assert.rejects(handleMessage(deps, { text: 'hello' }), (error) => error instanceof CompanionError && error.status === 503);
});

test('input validation: empty and oversized messages are rejected before any model call', async () => {
  const deps = makeDeps([]);
  await assert.rejects(handleMessage(deps, { text: '   ' }), (error) => error.status === 400);
  await assert.rejects(handleMessage(deps, { text: 'x'.repeat(config.MAX_USER_MESSAGE_CHARS + 1) }), (error) => error.status === 400);
  assert.equal(deps.anthropic.calls.length, 0);
});

test('a session bound to a signed-in user is not continued by someone else', async () => {
  const deps = makeDeps([says('Hi A'), says('Hi B')]);
  const first = await handleMessage(deps, { text: 'hi', userId: 'user-a' });
  const second = await handleMessage(deps, { sessionId: first.sessionId, text: 'hi', userId: 'user-b' });
  assert.notEqual(second.sessionId, first.sessionId);
});

test('filing a report marks the related user messages for export redaction', async () => {
  const deps = makeDeps([
    says('Which entrance of MSB is it, and shall I report "ramp blocked by bins"?'),
    callsTools(toolUse('report_issue', { node_or_edge_id: NODES.msb, description: 'Ramp blocked by bins' })),
    says('Reported. Thank you.')
  ]);
  const first = await handleMessage(deps, { text: 'The MSB ramp is blocked by bins' });
  await handleMessage(deps, { sessionId: first.sessionId, text: 'Yes, main entrance, please report it' });
  const session = await deps.store.getSession(first.sessionId);
  const userMessages = session.messages.filter((message) => message.role === 'user');
  assert.ok(userMessages.every((message) => message.containsReport));
});
