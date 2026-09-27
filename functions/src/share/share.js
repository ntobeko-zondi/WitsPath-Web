'use strict';

const crypto = require('crypto');
const config = require('../config');

// The only fields a shared link ever exposes (brief section 9).
const CARD_FIELDS = ['from', 'to', 'distanceM', 'accessible', 'steps', 'createdAt', 'expiresAt'];
const STEP_FIELDS = ['phraseKey', 'params', 'text', 'lang'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a share link for one route card in a session (the latest one if no
 * routeId is given). The card is built from server-side session data, never
 * from client input, so a shared link can't carry a forged route.
 *
 * @returns the share, or { error: 'session_not_found' | 'route_not_found' }
 */
async function createShare(store, sessionId, routeId, now = new Date()) {
  const session = typeof sessionId === 'string' ? await store.getSession(sessionId) : null;
  if (!session) return { error: 'session_not_found' };
  const routes = session.routes || [];
  const route = routeId ? routes.find((candidate) => candidate.routeId === routeId) : routes[routes.length - 1];
  if (!route) return { error: 'route_not_found' };

  const revokeToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + config.SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const doc = {
    from: route.from,
    to: route.to,
    distanceM: route.distanceM,
    accessible: route.accessible,
    steps: route.steps.map((step) => pick(step, STEP_FIELDS)),
    createdAt: now,
    expiresAt,
    // Private fields - never returned by getShare.
    revoked: false,
    revokeTokenHash: hashToken(revokeToken)
  };
  const shareId = await store.createSharedRoute(doc);
  return { shareId, path: `/share/${shareId}`, revokeToken, expiresAt: expiresAt.toISOString() };
}

async function getShare(store, shareId, now = new Date()) {
  if (typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(shareId)) return null;
  const doc = await store.getSharedRoute(shareId);
  if (!doc || doc.revoked || new Date(doc.expiresAt) <= now) return null;

  const card = pick(doc, CARD_FIELDS);
  card.steps = (card.steps || []).map((step) => pick(step, STEP_FIELDS));
  card.createdAt = new Date(card.createdAt).toISOString();
  card.expiresAt = new Date(card.expiresAt).toISOString();
  return card;
}

async function revokeShare(store, shareId, revokeToken) {
  if (typeof revokeToken !== 'string' || !revokeToken) return false;
  const doc = typeof shareId === 'string' ? await store.getSharedRoute(shareId) : null;
  if (!doc) return false;
  const expected = Buffer.from(doc.revokeTokenHash, 'hex');
  const actual = Buffer.from(hashToken(revokeToken), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  await store.updateSharedRoute(shareId, { revoked: true, revokedAt: new Date() });
  return true;
}

// Words that reveal mobility needs. Best-effort: export redacts them unless
// the user explicitly opts in.
const MOBILITY_PATTERN =
  /\b(wheel ?chairs?|crutch(?:es)?|walkers?|walking (?:frame|stick)|cane|mobility|disab(?:led|ility)|paraly[sz]ed|amputee|prosthe(?:tic|sis)|rollator|scooter|injur(?:y|ed))\b/gi;

/**
 * Opt-in transcript export. Report content and mobility details are removed
 * unless the user ticked the matching boxes.
 */
async function exportTranscript(store, sessionId, { includeReports = false, includeMobility = false } = {}) {
  const session = typeof sessionId === 'string' ? await store.getSession(sessionId) : null;
  if (!session) return null;

  const lines = session.messages.map((message) => {
    const speaker = message.role === 'user' ? 'You' : 'WitsPath Companion';
    let text = message.text;
    if (message.containsReport && !includeReports) {
      text = '[message removed: contained issue-report details]';
    }
    if (!includeMobility) {
      text = text.replace(MOBILITY_PATTERN, '[removed]');
    }
    const at = new Date(message.timestamp).toISOString();
    return `[${at}] ${speaker}: ${text}`;
  });

  return ['WitsPath Companion conversation', '', ...lines, ''].join('\n');
}

function pick(object, fields) {
  const result = {};
  for (const field of fields) {
    if (object[field] !== undefined) result[field] = object[field];
  }
  return result;
}

module.exports = { createShare, getShare, revokeShare, exportTranscript, CARD_FIELDS };
