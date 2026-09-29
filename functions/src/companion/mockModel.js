'use strict';

// Test mode for the local dev server: a stand-in for the Anthropic client
// that needs no API key. It understands a few fixed phrasings ("from X to Y",
// "where is X") and answers them ONLY by calling the real tools, so the whole
// pipeline runs for real: find_place, the routing engine, travel times, the
// number guard, route cards, directions and sharing. It is not an AI - it
// can't hold a conversation, handle other languages or file reports.
//
// Enable with COMPANION_MOCK=1 in functions/.secret.local. Dev server only: the Cloud
// Function (index.js) never loads this file.

const MOCK_PREFIX = '[Test mode - no AI] ';

const HELP =
  'I only understand a few fixed phrasings in test mode. Try "How do I get from Commerce Library to ' +
  'School of Business Sciences?" or "Where is the Tower of Light?". Add a real ANTHROPIC_API_KEY for full answers.';

// Filler removed from place names ("the", "please", "how far is it"...).
const LEADING_FILLER = /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:tell\s+me\s+)?(?:how\s+(?:do|can)\s+i\s+(?:get|go)|directions|take\s+me|route|navigate|get\s+me)?\s*/i;
const TRAILING_FILLER = /\s*(?:[,;]|\band\b\s+how\b|\bplease\b|\bhow\s+far\b|\?|\.|!).*$/i;

function cleanPlace(text) {
  return text
    .replace(LEADING_FILLER, '')
    .replace(TRAILING_FILLER, '')
    .replace(/^(?:from|to)\s+/i, '')
    .replace(/^the\s+/i, '')
    .trim();
}

/** Works out what the user asked for from their plain text. */
function parseIntent(text) {
  const plain = text.replace(/\s+/g, ' ').trim();
  let match = /\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(plain);
  if (match) return { kind: 'route', from: cleanPlace(match[1]), to: cleanPlace(match[2]) };
  match = /\bto\s+(.+?)\s+from\s+(.+)$/i.exec(plain);
  if (match) return { kind: 'route', from: cleanPlace(match[2]), to: cleanPlace(match[1]) };
  match = /\b(?:get|go|way)\s+to\s+(.+)$/i.exec(plain);
  if (match) return { kind: 'need_start', to: cleanPlace(match[1]) };
  match = /\b(?:where\s+is|where's|find)\s+(.+)$/i.exec(plain);
  if (match) return { kind: 'where', place: cleanPlace(match[1]) };
  match = /^(.+?)\s+to\s+(.+)$/i.exec(plain);
  if (match) return { kind: 'route', from: cleanPlace(match[1]), to: cleanPlace(match[2]) };
  return { kind: 'help' };
}

/** The user's own words in the last message that isn't tool results. */
function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const texts = message.content.filter((block) => block.type === 'text');
    if (!texts.length) continue;
    // The last text block is what the user typed; earlier ones are app notes.
    return { text: texts[texts.length - 1].text, index };
  }
  return { text: '', index: -1 };
}

/** Tool calls made so far this turn, with their parsed results. */
function toolCallsThisTurn(messages, turnIndex) {
  const calls = [];
  const results = new Map();
  for (const message of messages.slice(turnIndex + 1)) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') calls.push(block);
      if (block.type === 'tool_result') results.set(block.tool_use_id, JSON.parse(block.content));
    }
  }
  return calls.map((call) => ({ name: call.name, input: call.input, result: results.get(call.id) }));
}

function createMockAnthropic() {
  let counter = 0;
  const use = (name, input) => {
    counter += 1;
    return { type: 'tool_use', id: `mock_${Date.now().toString(36)}_${counter}`, name, input };
  };
  const callTools = (...blocks) => ({ stop_reason: 'tool_use', content: blocks });
  const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: MOCK_PREFIX + text }] });
  const find = (query) => use('find_place', { query, accessible_only: false });

  /** Picks one match, or explains why it can't. */
  function pick(query, result) {
    if (!result || result.error) return { problem: `I couldn't look up "${query}" right now.` };
    const [first, second] = result.matches;
    if (!first) return { problem: `I couldn't find "${query}" on the campus map. Could you use another name for it?` };
    if (second && second.confidence >= first.confidence - 0.05) {
      return { problem: `"${query}" could be ${first.name} or ${second.name}. Which one do you mean?` };
    }
    return { place: first };
  }

  function routeStep(intent, calls) {
    const found = calls.filter((call) => call.name === 'find_place');
    const route = calls.find((call) => call.name === 'get_route');
    const time = calls.find((call) => call.name === 'get_travel_time');

    if (!found.length) return callTools(use('declare_language', { lang: 'en' }), find(intent.from), find(intent.to));

    const from = pick(intent.from, found[0].result);
    const to = pick(intent.to, found[1].result);
    if (from.problem) return say(from.problem);
    if (to.problem) return say(to.problem);
    if (from.place.id === to.place.id) return say(`${from.place.name} and ${to.place.name} are the same place.`);

    if (!route) {
      return callTools(use('get_route', { from_node_id: from.place.id, to_node_id: to.place.id, accessible: true }));
    }
    if (route.result.error) {
      return say(
        `I can't confirm a step-free route from ${from.place.name} to ${to.place.name} right now ` +
          `(the routing engine said: ${route.result.error}). Please don't rely on one for this trip.`
      );
    }
    if (!time) return callTools(use('get_travel_time', { distance_m: route.result.distance_m }));

    const distance = Math.round(route.result.distance_m);
    const minutes = time.result.error
      ? "I can't estimate the time right now."
      : `It takes about ${time.result.minutes} minute${time.result.minutes === 1 ? '' : 's'} (an estimate, ${time.result.profile_used} pace).`;
    return say(
      `Here is a step-free route from ${from.place.name} to ${to.place.name}: about ${distance} metres. ${minutes} ` +
        'Follow the steps on the route card.'
    );
  }

  function whereStep(intent, calls) {
    const found = calls.find((call) => call.name === 'find_place');
    if (!found) return callTools(use('declare_language', { lang: 'en' }), find(intent.place));
    const { place, problem } = pick(intent.place, found.result);
    if (problem) return say(problem);
    const building = place.building && place.building !== place.name ? ` It's part of ${place.building}.` : '';
    const floor = place.floor !== null && place.floor !== undefined ? ` Floor: ${place.floor}.` : '';
    return say(`I found ${place.name} on the campus map.${building}${floor} Ask me how to get there from another place.`);
  }

  function needStartStep(intent, calls) {
    const found = calls.find((call) => call.name === 'find_place');
    if (!found) return callTools(use('declare_language', { lang: 'en' }), find(intent.to));
    const { place, problem } = pick(intent.to, found.result);
    if (problem) return say(problem);
    return say(`Where are you starting from? Say it like "from Commerce Library to ${place.name}".`);
  }

  return {
    mock: true,
    messages: {
      async create({ messages }) {
        const { text, index } = lastUserText(messages);
        const intent = parseIntent(text);
        const calls = toolCallsThisTurn(messages, index);
        if (intent.kind === 'route' && intent.from && intent.to) return routeStep(intent, calls);
        if (intent.kind === 'where' && intent.place) return whereStep(intent, calls);
        if (intent.kind === 'need_start' && intent.to) return needStartStep(intent, calls);
        return say(HELP);
      }
    }
  };
}

module.exports = { createMockAnthropic, parseIntent, MOCK_PREFIX };
