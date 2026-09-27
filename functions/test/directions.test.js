'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTurn } = require('../src/directions/buildDirections');
const { buildSeedTemplates, renderPhrase, PHRASE_KEYS, isVerified, SOURCE_PHRASES } = require('../src/directions/phrases');

test('source phrases write units in full, never "m" or "min"', () => {
  for (const [key, text] of Object.entries(SOURCE_PHRASES)) {
    assert.doesNotMatch(text, /\}\s*(m|km|min)\b/, key);
  }
  assert.match(SOURCE_PHRASES.turn_left, /\{distance\} metres/);
});
const { LANGUAGE_CODES } = require('../src/language/languages');

test('turn classification uses screen coordinates (y down)', () => {
  const origin = { x: 0, y: 0 };
  const east = { x: 10, y: 0 };
  assert.equal(classifyTurn(origin, east, { x: 10, y: 10 }), 'turn_right'); // east then south
  assert.equal(classifyTurn(origin, east, { x: 10, y: -10 }), 'turn_left'); // east then north
  assert.equal(classifyTurn(origin, east, { x: 20, y: 1 }), 'go_straight');
  assert.equal(classifyTurn(origin, east, { x: 20, y: 6 }), 'slight_right');
});

test('phrase_templates seed covers all 11 official languages x every phrase key', () => {
  const rows = buildSeedTemplates();
  assert.equal(LANGUAGE_CODES.length, 11);
  assert.equal(rows.length, 11 * PHRASE_KEYS.length);
  assert.ok(PHRASE_KEYS.length >= 20 && PHRASE_KEYS.length <= 30);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['key', 'lang', 'text', 'verifiedAt', 'verifiedBy']);
    // Only English ships verified; nothing else may reach users yet.
    assert.equal(isVerified(row), row.lang === 'en', `${row.lang}/${row.key}`);
  }
});

test('unverified phrases never render; English fallback is flagged', () => {
  const templates = {
    en: { turn_left: { text: 'Turn left and continue {distance} metres to {place}.', verifiedBy: 'team' } },
    zu: { turn_left: { text: 'Jika ngasekhohlo', verifiedBy: '' } }
  };
  const step = renderPhrase('turn_left', { place: 'CLM', distance: 20 }, 'zu', templates);
  assert.equal(step.text, 'Turn left and continue 20 metres to CLM.');
  assert.equal(step.lang, 'en');
  assert.equal(step.fallback, true);

  templates.zu.turn_left.verifiedBy = 'native-reviewer';
  templates.zu.turn_left.text = 'Jika ngasekhohlo uqhubeke {distance} m uye e-{place}.';
  const verified = renderPhrase('turn_left', { place: 'CLM', distance: 20 }, 'zu', templates);
  assert.equal(verified.lang, 'zu');
  assert.equal(verified.text, 'Jika ngasekhohlo uqhubeke 20 m uye e-CLM.');
});
