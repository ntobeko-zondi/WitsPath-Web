'use strict';

const { PLACE_MIN_CONFIDENCE, PLACE_MAX_MATCHES } = require('../config');

// Words that carry no identity for a campus place. "building" is included so
// "wits arm" matches "Wits Arm Building".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'at', 'in', 'on', 'for', 'and', 'near', 'by',
  'building', 'bldg', 'where', 'is', 'please', 'take', 'me', 'find', 'go',
  'how', 'do', 'i', 'get', 'can', 'you', 'nearest', 'closest', 'entrance'
]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter((token) => token && !STOPWORDS.has(token));
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokensMatch(a, b) {
  if (a === b) return true;
  // Numbers must match exactly: "CLM 2" is not "CLM 3".
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false;
  // Typo tolerance only for longer words ("accoutancy" ~ "accountancy").
  if (a.length >= 5 && b.length >= 5 && editDistanceAtMostOne(a, b)) return true;
  // Abbreviations: "maths" -> "mathematical", "lib" is too short to count.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/**
 * Score one candidate name against the query, 0..1. Pure and deterministic.
 */
function scoreName(query, candidate) {
  const qNorm = normalize(query);
  const cNorm = normalize(candidate);
  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 1;

  const qTokens = tokens(query);
  const cTokens = tokens(candidate);
  if (!qTokens.length || !cTokens.length) return 0;

  const qMatched = qTokens.filter((q) => cTokens.some((c) => tokensMatch(q, c))).length;
  const cMatched = cTokens.filter((c) => qTokens.some((q) => tokensMatch(q, c))).length;
  if (!qMatched || !cMatched) return 0;

  const precision = qMatched / qTokens.length;
  const recall = cMatched / cTokens.length;
  const f1 = (2 * precision * recall) / (precision + recall);
  return Math.round(0.95 * f1 * 1000) / 1000;
}

// Things that are not where someone is going unless they say so: a parking bay, a staircase, a vehicle gate.
// "Commerce Library" must not become "Commerce Library - disabled parking".
const KIND_WORDS = {
  parking: ['parking', 'park'],
  stairs: ['stairs', 'stair', 'staircase', 'steps'],
  gate: ['gate', 'gates']
};
const HIDDEN_UNLESS_ASKED = new Set(Object.keys(KIND_WORDS));

// A query that fits inside a building's own name ("commerce" for "Commerce, Law & Management") finds that building.
const CONTAINED_SCORE = 0.7;

function askedKinds(query) {
  const asked = new Set();
  const queryTokens = tokens(query);
  for (const [kind, words] of Object.entries(KIND_WORDS)) {
    if (queryTokens.some((token) => words.includes(token))) asked.add(kind);
  }
  return asked;
}

function kindOf(place) {
  return place.kind || place.type;
}

function scorePlace(query, place) {
  const names = [place.name, ...(place.aliases || [])];
  let best = Math.max(...names.map((name) => scoreName(query, name)));

  // Only for labels like "Building - accessible entrance"; a bare number ("School of Business Sciences - 2")
  // is a second copy of the same name and keeps being scored on its full name.
  if (place.building && place.building !== place.name && /[a-z]/i.test(place.detail || '')) {
    best = Math.max(best, scoreName(query, place.building));
    const queryTokens = tokens(query);
    const buildingTokens = tokens(place.building);
    if (queryTokens.length && queryTokens.every((q) => buildingTokens.some((b) => tokensMatch(q, b)))) {
      best = Math.max(best, CONTAINED_SCORE);
    }
  }
  return best;
}

/**
 * "Wits Plus - accessible entrance 1" and "... entrance 2" are the same kind of door into the same building.
 * Offer one, and list the others, so a newcomer is not asked to choose between identical doors.
 */
function collapseNumberedDuplicates(matches) {
  const kept = [];
  const byKey = new Map();
  for (const match of matches) {
    const place = match.place;
    const detail = String(place.detail || '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // Only doors: two ramps or two staircases are different things, and a report must name the right one.
    if (kindOf(place) !== 'entrance' || !place.building || !/[a-z]/.test(detail)) {
      kept.push(match);
      continue;
    }
    const key = [place.building.toLowerCase(), kindOf(place), detail].join('|');
    const first = byKey.get(key);
    if (first) {
      first.alternates.push(place);
    } else {
      const entry = { ...match, alternates: [] };
      byKey.set(key, entry);
      kept.push(entry);
    }
  }
  return kept;
}

/**
 * find_place core. Returns only matches that clear PLACE_MIN_CONFIDENCE; an
 * empty list means "ask the user to clarify", never "pick the closest".
 *
 * Ramps are waypoints on a building's approach, not the building itself, and
 * they share its acronym ("MSB" also matches "MSB - Ramp 1"). So a query that
 * doesn't say "ramp" prefers real destinations, and one that does prefers
 * ramps (e.g. "the ramp at MSB is blocked"), whenever both kinds match.
 */
function matchPlaces(query, places, { accessibleOnly = false } = {}) {
  const scored = [];
  for (const place of places) {
    if (accessibleOnly && place.accessibleEntrance === false) {
      continue;
    }
    const confidence = scorePlace(query, place);
    if (confidence >= PLACE_MIN_CONFIDENCE) {
      scored.push({ place, confidence });
    }
  }

  const asked = askedKinds(query);
  const offered = scored.filter(({ place }) => !HIDDEN_UNLESS_ASKED.has(kindOf(place)) || asked.has(kindOf(place)));

  const wantsRamp = tokens(query).some((token) => token === 'ramp' || token === 'ramps');
  const isRamp = ({ place }) => place.type === 'ramp';
  const preferred = offered.filter((match) => isRamp(match) === wantsRamp);
  const candidates = preferred.length ? preferred : offered;

  candidates.sort((a, b) => b.confidence - a.confidence || a.place.name.localeCompare(b.place.name));
  return collapseNumberedDuplicates(candidates).slice(0, PLACE_MAX_MATCHES);
}

module.exports = { matchPlaces, scoreName, scorePlace, normalize };
