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
    const names = [place.name, ...(place.aliases || [])];
    const confidence = Math.max(...names.map((name) => scoreName(query, name)));
    if (confidence >= PLACE_MIN_CONFIDENCE) {
      scored.push({ place, confidence });
    }
  }

  const wantsRamp = tokens(query).some((token) => token === 'ramp' || token === 'ramps');
  const isRamp = ({ place }) => place.type === 'ramp';
  const preferred = scored.filter((match) => isRamp(match) === wantsRamp);
  const candidates = preferred.length ? preferred : scored;

  candidates.sort((a, b) => b.confidence - a.confidence || a.place.name.localeCompare(b.place.name));
  return candidates.slice(0, PLACE_MAX_MATCHES);
}

module.exports = { matchPlaces, scoreName, normalize };
