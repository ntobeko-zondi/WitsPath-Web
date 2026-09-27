'use strict';

// Last line of defence for "the model never invents a distance or time".
// Every number in the model's reply must be traceable to a tool result or
// something the user said. Small integers are allowed for ordinary language
// ("one of 2 matches", "floor 1").
const ALWAYS_ALLOWED_MAX = 10;
const MAX_GROUNDED_NUMBERS = 500;

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

function key(value) {
  return String(Math.round(value * 100) / 100);
}

/** All the ways a grounded number may reasonably be written in a reply. */
function variants(value) {
  return [value, Math.round(value), Math.floor(value), Math.ceil(value), Math.round(value * 10) / 10, value / 1000, Math.round(value / 100) / 10].map(key);
}

/** Collect numbers from any JSON-ish value, including digits inside strings (place names like "Ramp 2"). */
function collectNumbers(value, into = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    variants(value).forEach((v) => into.add(v));
  } else if (typeof value === 'string') {
    for (const match of value.match(NUMBER_PATTERN) || []) {
      variants(Number(match.replace(',', '.'))).forEach((v) => into.add(v));
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNumbers(item, into));
  }
  return into;
}

/** @returns the list of numbers in `text` that are not grounded. */
function findUngroundedNumbers(text, groundedSet) {
  const ungrounded = [];
  for (const match of text.match(NUMBER_PATTERN) || []) {
    const value = Number(match.replace(',', '.'));
    if (Number.isInteger(value) && value <= ALWAYS_ALLOWED_MAX) continue;
    if (!groundedSet.has(key(value))) ungrounded.push(match);
  }
  return ungrounded;
}

function capGrounded(set) {
  return [...set].slice(-MAX_GROUNDED_NUMBERS);
}

module.exports = { collectNumbers, findUngroundedNumbers, capGrounded };
