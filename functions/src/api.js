'use strict';

const config = require('./config');
const { handleMessage, CompanionError } = require('./companion/companion');
const { createShare, getShare, revokeShare, exportTranscript } = require('./share/share');
const { transcribe } = require('./speech/vulavula');
const { publicLanguageList, isKnownLanguage } = require('./language/languages');
const { PHRASE_KEYS, isVerified } = require('./directions/phrases');
const { publicCampuses, validatePlace, isUsable, publicPlace, isAdmin } = require('./places/campusPlaces');
const { createTrip, recordLocation, endTrip, viewTrip } = require('./tracking/trips');
const { runTool } = require('./tools/handlers');
const { buildRouteCard, estimateMinutes } = require('./routing/routeCard');
const { fileReport, listMyReports } = require('./reports/reports');
const { getProfile, saveProfile, savePreferences } = require('./users/users');

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
 *   getAdminToken(): string | ''     // enables /api/admin/** when set
 *   verifyUser(headers): Promise<{uid, email, name} | null>   // Firebase Auth ID token claims
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
            speedMultiplier: clampSpeedMultiplier(body.speedMultiplier),
            userId: (await deps.verifyUser(request.headers))?.uid || null
          }
        );
        return { status: 200, json: result };
      }

      // Route planner: same engine, same checks and same verified directions
      // as the companion, without the model.
      if (method === 'POST' && path === '/api/route') {
        const body = request.body || {};
        const ctx = {
          store: deps.store,
          routing: deps.routing,
          log,
          groundedRoutes: [],
          speedMultiplier: clampSpeedMultiplier(body.speedMultiplier)
        };
        const result = await runTool(
          'get_route',
          { from_node_id: body.fromNodeId, to_node_id: body.toNodeId, accessible: body.accessible !== false },
          ctx
        );
        if (result.error) {
          const status = result.error === 'invalid_input' || result.error === 'unknown_place' ? 400 : 422;
          return { status, json: { error: result.error, message: result.message } };
        }
        const card = await buildRouteCard(deps.store, ctx.route, isKnownLanguage(body.lang) ? body.lang : null, {
          minutes: estimateMinutes(ctx.route.estimated_seconds)
        });
        return { status: 200, json: card };
      }

      // ---- accounts (same users/{uid} documents as the Android app) --------

      if (path === '/api/me' || path.startsWith('/api/me/') || path.startsWith('/api/reports')) {
        const claims = await deps.verifyUser(request.headers);
        if (!claims) return { status: 401, json: { error: 'sign_in_required' } };
        const body = request.body || {};

        if (method === 'GET' && path === '/api/me') {
          return { status: 200, json: await getProfile(deps.store, claims) };
        }
        if (method === 'PUT' && path === '/api/me/profile') {
          const result = await saveProfile(deps.store, claims, body);
          return result.error ? { status: 400, json: result } : { status: 200, json: result };
        }
        if (method === 'PUT' && path === '/api/me/preferences') {
          const result = await savePreferences(deps.store, claims, body.preferences);
          return result.error ? { status: 400, json: result } : { status: 200, json: result };
        }
        if (method === 'POST' && path === '/api/reports') {
          const result = await fileReport(deps.store, {
            userId: claims.uid,
            target: body.target,
            issueType: body.issueType,
            description: body.description,
            source: 'web'
          });
          if (result.error) return { status: 400, json: result };
          return { status: 201, json: result };
        }
        if (method === 'GET' && path === '/api/reports/mine') {
          return { status: 200, json: { reports: await listMyReports(deps.store, claims.uid) } };
        }
        return notFound();
      }

      if (method === 'POST' && path === '/api/companion/export') {
        const body = request.body || {};
        const text = await exportTranscript(deps.store, body.sessionId, {
          includeReports: body.includeReports === true,
          includeMobility: body.includeMobility === true
        });
        if (text === null) return { status: 404, json: { error: 'session_not_found' } };
        return { status: 200, text, contentType: 'text/plain; charset=utf-8' };
      }

      if (method === 'POST' && path === '/api/share') {
        const share = await createShare(deps.store, request.body?.sessionId, request.body?.routeId);
        if (share.error) return { status: 404, json: { error: share.error } };
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

      // ---- campuses & team-pinned places ---------------------------------

      if (method === 'GET' && path === '/api/campuses') {
        return { status: 200, json: { campuses: publicCampuses() } };
      }

      if (method === 'GET' && path === '/api/places') {
        const campusId = request.query?.campus;
        const places = (await deps.store.listCampusPlaces())
          .filter(isUsable)
          .filter((place) => !campusId || place.campusId === campusId)
          .map(publicPlace)
          .sort((a, b) => a.name.localeCompare(b.name));
        return { status: 200, json: { places } };
      }

      if (path === '/api/admin/places' || path.startsWith('/api/admin/places/')) {
        return handleAdminPlaces(deps, request);
      }

      // ---- live trips ------------------------------------------------------

      if (method === 'POST' && path === '/api/trips') {
        const result = await createTrip(deps.store, { displayName: request.body?.displayName, placeId: request.body?.placeId });
        if (result.error) return { status: result.status, json: { error: result.error } };
        return { status: 201, json: result };
      }

      const tripMatch = /^\/api\/trips\/([^/]+)(?:\/(location|end))?$/.exec(path);
      if (tripMatch) {
        const [, tripId, action] = tripMatch;
        const ownerToken = request.headers['x-owner-token'];
        if (method === 'GET' && !action) {
          const view = await viewTrip(deps.store, tripId, request.query?.lang);
          return view ? { status: 200, json: view } : notFound();
        }
        if (method === 'POST' && action === 'location') {
          const result = await recordLocation(deps.store, tripId, ownerToken, request.body);
          if (result.error) return { status: result.status, json: { error: result.error, trip: result.trip } };
          return { status: 200, json: result.trip };
        }
        if (method === 'POST' && action === 'end') {
          const result = await endTrip(deps.store, tripId, ownerToken, request.body?.reason);
          if (result.error) return { status: result.status, json: { error: result.error } };
          return { status: 200, json: result.trip };
        }
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

/** The user's walking-speed setting, bounded; 1 when missing or invalid. */
function clampSpeedMultiplier(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  return Math.min(config.SPEED_MULTIPLIER_MAX, Math.max(config.SPEED_MULTIPLIER_MIN, number));
}

/**
 * Admin-only CRUD for campus places, authorised by the ADMIN_API_TOKEN secret
 * (header x-admin-token). Admin responses include unverified fields (notes,
 * verifiedBy) that the public place list never exposes.
 */
async function handleAdminPlaces(deps, request) {
  const expected = deps.getAdminToken ? deps.getAdminToken() : '';
  if (!expected) return { status: 503, json: { error: 'admin_disabled' } };
  if (!isAdmin(expected, request.headers['x-admin-token'])) return { status: 401, json: { error: 'unauthorized' } };

  const { method, path } = request;
  const id = path.startsWith('/api/admin/places/') ? decodeURIComponent(path.slice('/api/admin/places/'.length)) : null;

  if (method === 'GET' && !id) {
    return { status: 200, json: { places: await deps.store.listCampusPlaces() } };
  }
  if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
    if (id && !(await deps.store.getCampusPlace(id))) return notFound();
    const validated = validatePlace(request.body || {});
    if (validated.error) return { status: 400, json: validated };
    const savedId = await deps.store.saveCampusPlace(id, validated.place);
    return { status: id ? 200 : 201, json: { id: savedId, ...validated.place } };
  }
  if (method === 'DELETE' && id) {
    return (await deps.store.deleteCampusPlace(id)) ? { status: 204 } : notFound();
  }
  return notFound();
}

module.exports = { createApi, VOICE_LATENCY_BUDGET_MS };
