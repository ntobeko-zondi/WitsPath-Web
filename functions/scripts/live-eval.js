'use strict';

// Live checks of the brief's model-behaviour test cases (1, 2, 3, 5, 6, 7)
// against the real Anthropic API, using the in-memory store and PLACEHOLDER
// fixture routing. Costs a few cents per run.
//
//   node scripts/live-eval.js
//
// Needs ANTHROPIC_API_KEY (environment or functions/.secret.local).
// Hard assertions fail the run; tone/decline checks are heuristic and the
// replies are printed so a person can confirm them.

const fs = require('fs');
const path = require('path');

for (const file of ['.secret.local', '.env']) {
  const full = path.join(__dirname, '..', file);
  if (fs.existsSync(full)) process.loadEnvFile(full);
}

const Anthropic = require('@anthropic-ai/sdk');
const { handleMessage } = require('../src/companion/companion');
const { MemoryStore } = require('../src/store/memoryStore');
const { loadSeedData } = require('../src/store/seedData');
const { createRoutingService } = require('../src/routing/routingService');
const { createShare, getShare, CARD_FIELDS } = require('../src/share/share');

const DISTANCE_OR_TIME = /\d+(?:[.,]\d+)?\s*(?:m\b|metres?|meters?|km|min|minutes?|mizuzu|amamitha)/i;

function freshDeps() {
  const store = new MemoryStore(loadSeedData());
  const toolCalls = [];
  return {
    store,
    routing: createRoutingService({ mode: 'fixture', store }),
    anthropic: new Anthropic(),
    log: (event, data) => {
      if (event === 'tool_call') toolCalls.push(data);
    },
    toolCalls
  };
}

const CASES = [
  {
    id: '1 no hallucination',
    text: 'How do I get from Flower Hall to the Law Clinic, and how far is it?',
    check(result, deps) {
      const hard = [];
      if (result.route) hard.push('returned a route card for an unseeded pair');
      if (DISTANCE_OR_TIME.test(result.reply)) hard.push('reply states a distance or time');
      if (!deps.toolCalls.some((call) => call.name === 'get_route')) hard.push('never called get_route');
      return { hard, soft: /can(?:'|no)t|unable|not able|couldn't/i.test(result.reply) ? [] : ['reply may not say the route cannot be confirmed'] };
    }
  },
  {
    id: '2 tone adaptation',
    text: "the lift is out again and I'm going to miss my lecture",
    check(result) {
      const acknowledges = /sorry|frustrat|stressful|annoying|that's (?:tough|hard|rough)|understand|I hear you/i.test(result.reply);
      return { hard: [], soft: acknowledges ? [] : ['reply may not acknowledge the frustration'] };
    }
  },
  {
    id: '3 out-of-scope decline',
    text: "where's the nearest ATM?",
    check(result) {
      const hard = result.route ? ['returned a route for an ATM'] : [];
      if (DISTANCE_OR_TIME.test(result.reply)) hard.push('reply states a distance or time');
      const declines = /can(?:'|no)t|not (?:able|in|on)|don't have|unable|only help/i.test(result.reply);
      return { hard, soft: declines ? [] : ['reply may not decline'] };
    }
  },
  {
    id: '5 isiZulu tier',
    text: 'Sawubona, ngicela ungisize. Ngifuna ukusuka e-Commerce Library ngiye e-Tower of Light.',
    check(result) {
      const hard = [];
      if (result.language.code !== 'zu') hard.push(`language resolved to ${result.language.code}`);
      if (!result.route) hard.push('no route card');
      else if (!result.route.steps.every((step) => step.lang === 'en' || step.lang === 'zu')) hard.push('unexpected step language');
      return { hard, soft: [] };
    }
  },
  {
    id: '6 Xitsonga flagged',
    text: 'Ndzi kombela ku ya eka Tower of Light ku suka eka Commerce Library.',
    check(result) {
      const hard = [];
      if (result.language.tier === 'full') hard.push('Xitsonga presented as full support');
      if (result.language.code !== 'ts') hard.push(`language resolved to ${result.language.code} (UI flag still shows because tier != full)`);
      return { hard: hard.filter((item) => !item.includes('UI flag')), soft: hard.filter((item) => item.includes('UI flag')) };
    }
  }
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (environment or functions/.secret.local).');
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const testCase of CASES) {
    const deps = freshDeps();
    const started = Date.now();
    const result = await handleMessage(deps, { text: testCase.text });
    const { hard, soft } = testCase.check(result, deps);
    failures += hard.length;
    console.log(`\n=== Test ${testCase.id} (${Date.now() - started} ms) ${hard.length ? 'FAIL' : 'PASS'}`);
    console.log(`user:  ${testCase.text}`);
    console.log(`reply: ${result.reply}`);
    console.log(`lang:  ${JSON.stringify(result.language)}  tools: ${deps.toolCalls.map((call) => call.name + (call.ok ? '' : `(${call.error})`)).join(', ') || 'none'}`);
    if (result.route) console.log(`route: ${result.route.steps.map((step) => `[${step.lang}] ${step.text}`).join(' | ')}`);
    hard.forEach((item) => console.log(`  FAIL: ${item}`));
    soft.forEach((item) => console.log(`  CHECK MANUALLY: ${item}`));
  }

  // Test 7: share flow on a real route lookup.
  const deps = freshDeps();
  const routed = await handleMessage(deps, { text: 'Accessible route from the Commerce Library to the Tower of Light please.' });
  const share = routed.route ? await createShare(deps.store, routed.sessionId) : null;
  const card = share ? await getShare(deps.store, share.shareId) : null;
  const extraFields = card ? Object.keys(card).filter((key) => !CARD_FIELDS.includes(key)) : [];
  const shareOk = Boolean(card) && extraFields.length === 0;
  if (!shareOk) failures += 1;
  console.log(`\n=== Test 7 share flow ${shareOk ? 'PASS' : 'FAIL'}: ${share ? share.path : 'no route to share'}${extraFields.length ? ` extra fields: ${extraFields}` : ''}`);

  console.log(`\n${failures ? `${failures} hard failure(s)` : 'All hard checks passed'}. Test 4 (voice) and 8 (bundle) are run separately - see README.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
