'use strict';

const crypto = require('crypto');
const { distanceMetres, isValidLatLng } = require('../geo/geo');
const campusSeed = require('../../seed/campuses.json');

// Team-pinned places across all Wits campuses, with GPS coordinates. A place
// is only used by the app once a named team member has pinned it
// (verifiedBy), the same review gate as phrase_templates.

const CAMPUSES = campusSeed.campuses;
const KINDS = ['building', 'entrance', 'accessible_entrance', 'lift', 'ramp', 'other'];

function campusById(id) {
  return CAMPUSES.find((campus) => campus.id === id) || null;
}

function publicCampuses() {
  return CAMPUSES.map(({ id, name, center, zoom }) => ({ id, name, center, zoom }));
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Validate an admin-submitted place. Returns { place } or { error, message }.
 */
function validatePlace(input) {
  const name = cleanText(input.name, 80);
  const campus = campusById(input.campusId);
  const pinnedBy = cleanText(input.pinnedBy, 80);
  const position = { lat: Number(input.lat), lng: Number(input.lng) };

  if (!name) return { error: 'invalid_place', message: 'Name is required.' };
  if (!campus) return { error: 'invalid_place', message: 'Choose a campus.' };
  if (!pinnedBy) return { error: 'invalid_place', message: 'Enter who pinned this place.' };
  if (!isValidLatLng(position)) return { error: 'invalid_place', message: 'Pin the place on the map.' };
  if (distanceMetres(position, campus.center) > campus.maxPinDistanceM) {
    return { error: 'invalid_place', message: `That pin is too far from ${campus.name}. Check the campus.` };
  }
  if (!KINDS.includes(input.kind)) return { error: 'invalid_place', message: 'Choose what kind of place this is.' };

  const accessibleEntrance =
    input.accessibleEntrance === true ? true : input.accessibleEntrance === false ? false : null;
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map((alias) => cleanText(alias, 80)).filter(Boolean).slice(0, 10)
    : [];

  return {
    place: {
      name,
      campusId: campus.id,
      lat: position.lat,
      lng: position.lng,
      kind: input.kind,
      accessibleEntrance,
      aliases,
      graphNodeId: cleanText(input.graphNodeId, 40) || null,
      notes: cleanText(input.notes, 300),
      verifiedBy: pinnedBy,
      verifiedAt: new Date()
    }
  };
}

function isUsable(place) {
  return Boolean(place && typeof place.verifiedBy === 'string' && place.verifiedBy.trim() && isValidLatLng(place));
}

/** What the public app may see about a place. */
function publicPlace(place) {
  return {
    id: place.id,
    name: place.name,
    campusId: place.campusId,
    lat: place.lat,
    lng: place.lng,
    kind: place.kind,
    accessibleEntrance: place.accessibleEntrance ?? null
  };
}

/** Constant-time admin token check. An unset token disables admin access. */
function isAdmin(expectedToken, providedToken) {
  if (!expectedToken || typeof providedToken !== 'string') return false;
  const expected = crypto.createHash('sha256').update(expectedToken).digest();
  const provided = crypto.createHash('sha256').update(providedToken).digest();
  return crypto.timingSafeEqual(expected, provided);
}

module.exports = { CAMPUSES, KINDS, campusById, publicCampuses, validatePlace, isUsable, publicPlace, isAdmin };
