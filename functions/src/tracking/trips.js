'use strict';

const crypto = require('crypto');
const { TRACKING } = require('../config');
const { distanceMetres, isValidLatLng } = require('../geo/geo');
const { isUsable } = require('../places/campusPlaces');
const { renderPhrase } = require('../directions/phrases');
const { SOURCE_LANGUAGE, isKnownLanguage } = require('../language/languages');

// Live trips: someone shares their position while heading to a team-pinned
// campus place; anyone with the link can follow along.
//
// Privacy by design:
// - only the latest position is stored (no trail), and it is deleted when the
//   trip stops or arrives;
// - trips end automatically on arrival or after TRIP_TTL_MS;
// - the sender controls the trip with a secret token (hash stored only).
//
// Every status line is rendered from phrase templates here, never by the
// model: "X has arrived" is a safety-relevant claim.

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenMatches(hash, token) {
  if (typeof token !== 'string' || !token || typeof hash !== 'string') return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function cleanName(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, TRACKING.MAX_NAME_CHARS)
    : '';
}

async function createTrip(store, { displayName, placeId }, now = new Date()) {
  const name = cleanName(displayName);
  if (!name) return { error: 'invalid_name', status: 400 };
  const place = typeof placeId === 'string' ? await store.getCampusPlace(placeId) : null;
  if (!isUsable(place)) return { error: 'unknown_destination', status: 400 };

  const ownerToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + TRACKING.TRIP_TTL_MS);
  const tripId = await store.createTrip({
    displayName: name,
    destination: { placeId: place.id, name: place.name, lat: place.lat, lng: place.lng, campusId: place.campusId },
    status: 'active',
    lastFix: null,
    arrivalStreak: 0,
    startedAt: now,
    updatedAt: now,
    expiresAt,
    ownerTokenHash: hashToken(ownerToken)
  });
  return { tripId, path: `/track/${tripId}`, ownerToken, expiresAt: expiresAt.toISOString() };
}

function isExpired(trip, now) {
  return new Date(trip.expiresAt) <= now;
}

async function loadOwnedTrip(store, tripId, ownerToken) {
  const trip = isTripId(tripId) ? await store.getTrip(tripId) : null;
  if (!trip || !tokenMatches(trip.ownerTokenHash, ownerToken)) return null;
  return trip;
}

/**
 * Record a location fix from the sender. Positions are timestamped by the
 * server. Returns the sender's view of the trip, or { error, status }.
 */
async function recordLocation(store, tripId, ownerToken, fix, now = new Date()) {
  const trip = await loadOwnedTrip(store, tripId, ownerToken);
  if (!trip) return { error: 'not_found', status: 404 };
  if (trip.status !== 'active' || isExpired(trip, now)) {
    return { error: 'trip_not_active', status: 409, trip: senderView(trip, now) };
  }

  const position = { lat: Number(fix?.lat), lng: Number(fix?.lng) };
  const accuracyM = Number(fix?.accuracyM);
  if (!isValidLatLng(position) || !Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > TRACKING.MAX_ACCURACY_M) {
    return { error: 'invalid_location', status: 400 };
  }
  const distance = distanceMetres(position, trip.destination);
  if (distance > TRACKING.MAX_DISTANCE_FROM_DESTINATION_M) {
    return { error: 'location_out_of_range', status: 422 };
  }
  // Ignore bursts; the latest accepted fix stays.
  if (trip.lastFix && now - new Date(trip.lastFix.at) < TRACKING.MIN_FIX_INTERVAL_MS) {
    return { trip: senderView(trip, now) };
  }

  const closeAndPrecise = distance <= TRACKING.ARRIVAL_RADIUS_M && accuracyM <= TRACKING.ARRIVAL_MAX_ACCURACY_M;
  const arrivalStreak = closeAndPrecise ? (trip.arrivalStreak || 0) + 1 : 0;
  const patch =
    arrivalStreak >= TRACKING.ARRIVAL_CONSECUTIVE_FIXES
      ? { status: 'arrived', arrivedAt: now, lastFix: null, arrivalStreak, updatedAt: now }
      : { lastFix: { lat: position.lat, lng: position.lng, accuracyM: Math.round(accuracyM), at: now }, arrivalStreak, updatedAt: now };

  await store.updateTrip(tripId, patch);
  return { trip: senderView({ ...trip, ...patch }, now) };
}

/** Sender ends the trip: 'arrived' (their own confirmation) or 'stopped'. */
async function endTrip(store, tripId, ownerToken, reason, now = new Date()) {
  const trip = await loadOwnedTrip(store, tripId, ownerToken);
  if (!trip) return { error: 'not_found', status: 404 };
  if (trip.status === 'active' && !isExpired(trip, now)) {
    const status = reason === 'arrived' ? 'arrived' : 'stopped';
    const patch = { status, lastFix: null, updatedAt: now, ...(status === 'arrived' ? { arrivedAt: now } : {}) };
    await store.updateTrip(tripId, patch);
    return { trip: senderView({ ...trip, ...patch }, now) };
  }
  return { trip: senderView(trip, now) };
}

/** Viewer's view: rendered status lines + map data. Never the token hash. */
async function viewTrip(store, tripId, lang, now = new Date()) {
  const trip = isTripId(tripId) ? await store.getTrip(tripId) : null;
  if (!trip) return null;

  const renderLang = isKnownLanguage(lang) ? lang : SOURCE_LANGUAGE;
  const templates = await store.getPhraseTemplates([...new Set([renderLang, SOURCE_LANGUAGE])]);
  const state = tripState(trip, now);
  const say = (key, params = {}) => renderPhrase(key, { name: trip.displayName, place: trip.destination.name, ...params }, renderLang, templates);

  const messages = [];
  if (state === 'ended') {
    messages.push(say('tracking_ended'));
  } else if (state === 'stopped') {
    messages.push(say('tracking_stopped'));
  } else if (state === 'arrived') {
    messages.push(say('tracking_arrived'));
  } else if (state === 'waiting') {
    messages.push(say('tracking_waiting'));
  } else {
    const fix = trip.lastFix;
    const distance = Math.round(distanceMetres(fix, trip.destination));
    if (state === 'stale') {
      // No recent updates: don't claim they are still moving.
      messages.push(say('tracking_last_seen', { distance }));
    } else {
      messages.push(say(state === 'near' ? 'tracking_near' : 'tracking_on_the_way'));
      if (state !== 'near') messages.push(say('tracking_distance', { distance }));
    }
    if (fix.accuracyM > TRACKING.LOW_ACCURACY_M) messages.push(say('tracking_low_accuracy', { distance: fix.accuracyM }));
    const minutes = Math.floor((now - new Date(fix.at)) / 60000);
    messages.push(
      minutes < 1 ? say('tracking_last_update_now') : minutes === 1 ? say('tracking_last_update_one') : say('tracking_last_update', { minutes })
    );
  }

  const showPosition = ['on_the_way', 'near', 'stale'].includes(state);
  return {
    displayName: trip.displayName,
    destination: { name: trip.destination.name, lat: trip.destination.lat, lng: trip.destination.lng },
    state,
    messages: messages.map(({ text, lang: messageLang, phraseKey }) => ({ phraseKey, text, lang: messageLang })),
    position: showPosition
      ? { lat: trip.lastFix.lat, lng: trip.lastFix.lng, accuracyM: trip.lastFix.accuracyM, at: new Date(trip.lastFix.at).toISOString() }
      : null,
    expiresAt: new Date(trip.expiresAt).toISOString()
  };
}

/**
 * waiting | on_the_way | near | stale | arrived | stopped | ended
 * 'stale' keeps the last position but the status says how old it is.
 */
function tripState(trip, now) {
  if (trip.status === 'arrived') return 'arrived';
  if (trip.status === 'stopped') return 'stopped';
  if (isExpired(trip, now)) return 'ended';
  if (!trip.lastFix) return 'waiting';
  if (now - new Date(trip.lastFix.at) > TRACKING.STALE_AFTER_MS) return 'stale';
  return distanceMetres(trip.lastFix, trip.destination) <= TRACKING.NEAR_RADIUS_M ? 'near' : 'on_the_way';
}

function senderView(trip, now) {
  return {
    state: tripState(trip, now),
    destination: { name: trip.destination.name, lat: trip.destination.lat, lng: trip.destination.lng },
    expiresAt: new Date(trip.expiresAt).toISOString()
  };
}

function isTripId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(value);
}

module.exports = { createTrip, recordLocation, endTrip, viewTrip, tripState };
