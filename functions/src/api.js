'use strict';

const config = require('./config');
const { handleMessage, CompanionError } = require('./companion/companion');
const { createShare, getShare, revokeShare, exportTranscript } = require('./share/share');
const { transcribe } = require('./speech/vulavula');
const { publicLanguageList, isKnownLanguage } = require('./language/languages');
const { PHRASE_KEYS, isVerified } = require('./directions/phrases');

// Target end-to-end latency for a voice round trip (speech in -> spoken reply
// starts). The widget measures against this; see test case 4.
const VOICE_LATENCY_BUDGET_MS = 8000;

/**
 * Framework-free API router used by both the Cloud Function and the local dev
 * server.
 *
 * deps: {
 *   store, routing, log,
 *   getAnthropic(): Anthropic client (created lazily from the server secret),
 *   getVulavulaKey(): string | '',
 *   verifyUser(headers): Promise<string | null>   // Firebase Auth uid, optional
 * }
 * request: { method, path, query, headers, body, rawBody }
 * returns: { status, json } | { status, text, contentType } | { status }
 */
function createApi(deps) {
  const log = deps.log || (() => {});

  return async function handle(request) {
    const { method, path } = request;
    try {
      if (method === 'GET' && path === '/api/companion/config') {
        const languages = publicLanguageList();
        const templates = await deps.store.getPhraseTemplates(languages.map((lang) => lang.code));
        for (const lang of languages) {
          // Lets the UI say honestly whether directions will appear in this
          // language or fall back to English.
          lang.directionsVerified = {
            verified: PHRASE_KEYS.filter((key) => isVerified(templates[lang.code]?.[key])).length,
            total: PHRASE_KEYS.length
          };
        }
        return {
          status: 200,
          json: {
            languages,
            voice: { vulavulaTranscription: Boolean(deps.getVulavulaKey()), latencyBudgetMs: VOICE_LATENCY_BUDGET_MS },
            routingSource: deps.routing.source
          }
        };
      }

      if (method === 'POST' && path === '/api/companion/message') {
        const body = request.body || {};
        const result = await handleMessage(
          { anthropic: deps.getAnthropic(), store: deps.store, routing: deps.routing, log },
          {
            sessionId: body.sessionId,
            text: body.text,
            inputMode: body.inputMode === 'voice' ? 'voice' : 'text',
            inputLang: isKnownLanguage(body.inputLang) ? body.inputLang : null,
            preferredLang: isKnownLanguage(body.preferredLang) ? body.preferredLang : null,
            userId: await deps.verifyUser(request.headers)
          }
        );
        return { status: 200, json: result };
      }

      if (method === 'POST' && path === '/api/companion/export') {
        const body = request.body || {};
        const text = await exportTranscript(deps.store, body.sessionId, {
          includeReports: body.includeReports === true,
          includeMobility: body.includeMobility === true
        });
        if (text === null) return notFound();
        return { status: 200, text, contentType: 'text/plain; charset=utf-8' };
      }

      if (method === 'POST' && path === '/api/share') {
        const share = await createShare(deps.store, request.body?.sessionId);
        if (!share) return { status: 404, json: { error: 'no_route_to_share' } };
        return { status: 201, json: share };
      }

      const shareMatch = /^\/api\/share\/([^/]+)$/.exec(path);
      if (shareMatch && method === 'GET') {
        const card = await getShare(deps.store, shareMatch[1]);
        return card ? { status: 200, json: card } : notFound();
      }
      if (shareMatch && method === 'DELETE') {
        const revoked = await revokeShare(deps.store, shareMatch[1], request.headers['x-revoke-token']);
        return revoked ? { status: 204 } : notFound();
      }

      if (method === 'POST' && path === '/api/speech/transcribe') {
        const apiKey = deps.getVulavulaKey();
        if (!apiKey) return { status: 501, json: { error: 'transcription_not_configured' } };
        const audio = request.rawBody;
        if (!audio || !audio.length) return { status: 400, json: { error: 'no_audio' } };
        if (audio.length > config.MAX_AUDIO_BYTES) return { status: 413, json: { error: 'audio_too_large' } };
        const result = await transcribe({
          apiKey,
          audio,
          contentType: request.headers['content-type'],
          langHint: isKnownLanguage(request.query?.lang) ? request.query.lang : null
        });
        if (result.error) return { status: result.status, json: { error: result.error } };
        return { status: 200, json: result };
      }

      return notFound();
    } catch (error) {
      if (error instanceof CompanionError) {
        return { status: error.status, json: { error: error.code, message: error.message } };
      }
      log('api_error', { path, error: error.message });
      return { status: 500, json: { error: 'internal_error' } };
    }
  };
}

function notFound() {
  return { status: 404, json: { error: 'not_found' } };
}

module.exports = { createApi, VOICE_LATENCY_BUDGET_MS };
