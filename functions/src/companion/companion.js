'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { TOOLS } = require('../tools/definitions');
const { runTool } = require('../tools/handlers');
const { SYSTEM_PROMPT } = require('./systemPrompt');
const { collectNumbers, findUngroundedNumbers, capGrounded } = require('./numberGuard');
const { buildRouteCard } = require('../routing/routeCard');
const { isKnownLanguage, tierFor } = require('../language/languages');
const { newId } = require('../store/memoryStore');

const SAFE_REPLY =
  "Sorry, I can't confirm that detail right now. You can still plan a route with the route planner on this page.";
// Route cards kept per session so any recent card can be shared.
const MAX_SHAREABLE_ROUTES = 10;
const INCOMPLETE_REPLY = "Sorry, I couldn't finish that. Please try again, or use the route planner on this page.";

class CompanionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Handle one user message. Runs the tool-use loop against the Anthropic
 * Messages API; every fact in the answer comes from a tool.
 *
 * @param deps   { anthropic, store, routing, log? }
 * @param request { sessionId?, text, inputLang?, inputMode?, preferredLang?, userId? }
 */
async function handleMessage(deps, request) {
  const { anthropic, store, routing } = deps;
  const log = deps.log || (() => {});

  const text = typeof request.text === 'string' ? request.text.trim() : '';
  if (!text) throw new CompanionError('empty_message', 'Message is empty.', 400);
  if (text.length > config.MAX_USER_MESSAGE_CHARS) {
    throw new CompanionError('message_too_long', `Messages are limited to ${config.MAX_USER_MESSAGE_CHARS} characters.`, 400);
  }

  const now = new Date();
  let sessionId = typeof request.sessionId === 'string' ? request.sessionId : null;
  let session = sessionId ? await store.getSession(sessionId) : null;
  // A session bound to a signed-in user can only be continued by that user.
  if (!session || (session.userId && session.userId !== request.userId)) {
    sessionId = newId();
    session = null;
  }
  session = session || {
    userId: request.userId || null,
    createdAt: now,
    messages: [],
    languageUsed: null,
    transcriptJson: '[]',
    groundedNumbers: [],
    groundedRoutes: [],
    routes: [],
    mobilityProfileUsed: false
  };

  const ctx = {
    store,
    routing,
    log,
    userId: request.userId || null,
    groundedRoutes: [...(session.groundedRoutes || [])],
    speedMultiplier: request.speedMultiplier || 1,
    routeOptions: request.routeOptions,
    declaredLang: null,
    route: null,
    travelTime: null,
    reportFiled: false,
    mobilityProfileUsed: false
  };
  const grounded = new Set(session.groundedNumbers);
  collectNumbers(text, grounded);

  const history = trimHistory(JSON.parse(session.transcriptJson || '[]'));
  const turnStart = history.length;
  const messages = [...history, { role: 'user', content: userContent(text, request) }];

  let finalMessage = null;
  for (let iteration = 0; iteration < config.MAX_TOOL_ITERATIONS; iteration += 1) {
    let response;
    try {
      response = await anthropic.messages.create({
        model: config.MODEL,
        max_tokens: config.MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages
      });
    } catch (error) {
      throw toCompanionError(error, log);
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use') {
      // A tool call cut off by max_tokens is never executed; treat the turn
      // as incomplete rather than acting on truncated input.
      if (!toolUses.length) finalMessage = response;
      break;
    }

    // Tools in one response run together and all results go back in a single
    // user message.
    const results = await Promise.all(
      toolUses.map(async (block) => {
        const result = await runTool(block.name, block.input, ctx);
        collectNumbers(result, grounded);
        log('tool_call', { name: block.name, ok: !result.error, error: result.error });
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          ...(result.error ? { is_error: true } : {})
        };
      })
    );
    messages.push({ role: 'user', content: results });
  }

  let reply;
  let guardTriggered = false;
  if (!finalMessage) {
    // Hit the iteration cap mid-tool-use. Drop this turn's partial exchange so
    // the stored history stays well-formed.
    messages.splice(turnStart + 1);
    reply = INCOMPLETE_REPLY;
    messages.push({ role: 'assistant', content: [{ type: 'text', text: reply }] });
    log('incomplete_turn', {});
  } else {
    reply = finalMessage.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!reply) reply = INCOMPLETE_REPLY;

    const ungrounded = findUngroundedNumbers(reply, grounded);
    if (ungrounded.length) {
      log('number_guard_triggered', { ungrounded });
      guardTriggered = true;
      reply = SAFE_REPLY;
      // Keep the model's history consistent with what the user actually saw.
      messages[messages.length - 1] = { role: 'assistant', content: [{ type: 'text', text: reply }] };
    }
  }

  const language = resolveLanguage(request, ctx);
  const routeCard = ctx.route ? await companionRouteCard(store, ctx, language) : null;

  // Persist.
  const userMessage = { role: 'user', text, lang: request.inputLang || null, timestamp: now };
  if (ctx.reportFiled) markRecentUserMessagesAsReport(session.messages, userMessage);
  session.messages.push(userMessage, {
    role: 'assistant',
    text: reply,
    lang: language.code,
    timestamp: new Date()
  });
  session.languageUsed = language.code || session.languageUsed;
  session.transcriptJson = JSON.stringify(messages);
  session.groundedNumbers = capGrounded(grounded);
  session.groundedRoutes = ctx.groundedRoutes.slice(-MAX_SHAREABLE_ROUTES);
  session.mobilityProfileUsed = session.mobilityProfileUsed || ctx.mobilityProfileUsed;
  if (routeCard) session.routes = [...(session.routes || []), routeCard].slice(-MAX_SHAREABLE_ROUTES);
  session.updatedAt = new Date();
  await store.saveSession(sessionId, session);

  return {
    sessionId,
    reply,
    language,
    route: routeCard,
    reportFiled: ctx.reportFiled,
    guardTriggered
  };
}

function userContent(text, request) {
  const notes = [];
  if (request.inputMode === 'voice') {
    notes.push(
      request.inputLang
        ? `input was spoken; the speech recognizer detected language "${request.inputLang}"`
        : 'input was spoken'
    );
  }
  if (request.preferredLang && isKnownLanguage(request.preferredLang)) {
    notes.push(`the user chose "${request.preferredLang}" as their reply language`);
  }
  const content = [];
  if (notes.length) {
    content.push({ type: 'text', text: `[App input notes, not written by the user: ${notes.join('; ')}.]` });
  }
  content.push({ type: 'text', text });
  return content;
}

/**
 * Keep the last N user turns. Cuts only at a user message that starts a turn
 * (text, not tool results) so tool_use/tool_result pairs are never split.
 */
function trimHistory(transcript) {
  const turnStarts = [];
  transcript.forEach((message, index) => {
    if (message.role === 'user' && message.content.some?.((block) => block.type === 'text')) {
      turnStarts.push(index);
    }
  });
  if (turnStarts.length <= config.MAX_HISTORY_TURNS) return transcript;
  return transcript.slice(turnStarts[turnStarts.length - config.MAX_HISTORY_TURNS]);
}

/**
 * Which language the reply is in, and how much to trust it:
 * explicit user choice > model declaration > speech recogniser > unconfirmed.
 */
function resolveLanguage(request, ctx) {
  let code = null;
  let source = 'unconfirmed';
  if (request.preferredLang && isKnownLanguage(request.preferredLang)) {
    code = request.preferredLang;
    source = 'user-selected';
  } else if (ctx.declaredLang) {
    code = ctx.declaredLang;
    source = 'model-declared';
  } else if (request.inputLang && isKnownLanguage(request.inputLang)) {
    code = request.inputLang;
    source = 'speech-detected';
  }
  return { code, source, tier: code ? tierFor(code) : 'unconfirmed' };
}

// Travel time goes on the card only if the model asked for it for this route.
function companionRouteCard(store, ctx, language) {
  const route = ctx.route;
  const travelTime =
    ctx.travelTime && Math.abs(ctx.travelTime.distance_m - route.distance_m) < 0.05 ? { minutes: ctx.travelTime.minutes } : null;
  return buildRouteCard(store, route, language.code, travelTime);
}

// Report text the user typed may sit in this or the previous couple of user
// messages; flag them so transcript export can leave them out by default.
function markRecentUserMessagesAsReport(previousMessages, current) {
  current.containsReport = true;
  previousMessages
    .filter((message) => message.role === 'user')
    .slice(-2)
    .forEach((message) => {
      message.containsReport = true;
    });
}

function toCompanionError(error, log) {
  if (error instanceof Anthropic.RateLimitError) {
    log('anthropic_rate_limited', {});
    return new CompanionError('busy', 'The companion is busy. Please try again shortly.', 503);
  }
  if (error instanceof Anthropic.APIError) {
    log('anthropic_api_error', { status: error.status });
    return new CompanionError('unavailable', 'The companion is unavailable right now.', 503);
  }
  log('companion_error', { error: error.message });
  return new CompanionError('unavailable', 'The companion is unavailable right now.', 503);
}

module.exports = { handleMessage, CompanionError, SAFE_REPLY };
