'use strict';

const { LANGUAGE_CODES, SOURCE_LANGUAGE } = require('../language/languages');

// Tier 2: safety-critical direction phrases. These are NEVER generated or
// translated by the model. Directions are assembled from these templates and
// interpolated with numbers and place names on the server.
//
// Placeholders: {place} {distance} {minutes} {floor}. Place names are proper
// nouns and are inserted verbatim in every language.
//
// English is the source text. The seed script writes it to
// phrase_templates/en/phrases/{key}; a native-speaker review pass fills in
// the other 10 languages (text + verifiedBy + verifiedAt) with no schema change.
const SOURCE_PHRASES = {
  route_summary: 'Route to {place}: {distance} m.',
  start_at: 'Start at {place}.',
  head_towards: 'Head towards {place} for {distance} m.',
  continue_to: 'Continue {distance} m to {place}.',
  go_straight: 'Go straight on for {distance} m to {place}.',
  turn_left: 'Turn left and continue {distance} m to {place}.',
  turn_right: 'Turn right and continue {distance} m to {place}.',
  slight_left: 'Bear slightly left and continue {distance} m to {place}.',
  slight_right: 'Bear slightly right and continue {distance} m to {place}.',
  use_ramp: 'Use the ramp at {place}.',
  take_elevator: 'Take the elevator to floor {floor}.',
  elevator_out_of_service: 'The elevator at {place} is reported out of service.',
  floor_level: 'You are on floor {floor}.',
  stairs_warning: 'This section has stairs.',
  step_free_route: 'This route is step-free.',
  not_step_free: 'This route is not confirmed step-free.',
  path_blocked: 'The path at {place} is reported blocked.',
  accessible_entrance: 'Use the accessible entrance at {place}.',
  estimated_time: 'Estimated time: about {minutes} min.',
  arrive: 'You have arrived at {place}.',
  route_unavailable: 'A route could not be confirmed.',
  caution_slope: 'Caution: slope ahead.'
};

const PHRASE_KEYS = Object.keys(SOURCE_PHRASES);

// Who signed off the English source wording. English is authored, not
// translated, so it ships verified; change this if your review process
// requires a named reviewer for English too.
const SOURCE_VERIFIER = 'witspath-team:source-text';

// Draft wording supplied in the implementation brief. Stored with an EMPTY
// verifiedBy so it is never shown to users until a native speaker signs it off.
const UNVERIFIED_DRAFTS = {
  zu: { turn_left: 'Jika ngasekhohlo' }
};

/**
 * Seed rows for phrase_templates/{lang}/phrases/{phraseKey}.
 *
 * Note on paths: the brief's `phrase_templates/{lang}/{phraseKey}` has three
 * segments, which Firestore treats as a collection, not a document. The
 * nearest valid shape is `phrase_templates/{lang}/phrases/{phraseKey}`.
 */
function buildSeedTemplates() {
  const rows = [];
  for (const lang of LANGUAGE_CODES) {
    for (const key of PHRASE_KEYS) {
      if (lang === SOURCE_LANGUAGE) {
        rows.push({ lang, key, text: SOURCE_PHRASES[key], verifiedBy: SOURCE_VERIFIER, verifiedAt: null });
      } else {
        const draft = UNVERIFIED_DRAFTS[lang]?.[key] || '';
        rows.push({ lang, key, text: draft, verifiedBy: '', verifiedAt: null });
      }
    }
  }
  return rows;
}

function isVerified(template) {
  return Boolean(
    template &&
      typeof template.text === 'string' &&
      template.text.trim() &&
      typeof template.verifiedBy === 'string' &&
      template.verifiedBy.trim()
  );
}

function interpolate(text, params) {
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    params && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole
  );
}

/**
 * Render one phrase. Uses the requested language only if that exact phrase is
 * verified; otherwise falls back to verified English (from Firestore, or the
 * in-code source text if Firestore has no English row).
 *
 * @param templatesByLang { [lang]: { [key]: {text, verifiedBy} } }
 * @returns {{ phraseKey, params, text, lang, fallback: boolean }}
 */
function renderPhrase(key, params, lang, templatesByLang) {
  if (!SOURCE_PHRASES[key]) {
    throw new Error(`Unknown phrase key: ${key}`);
  }

  const localized = templatesByLang?.[lang]?.[key];
  if (lang !== SOURCE_LANGUAGE && isVerified(localized)) {
    return { phraseKey: key, params, text: interpolate(localized.text, params), lang, fallback: false };
  }

  const english = templatesByLang?.[SOURCE_LANGUAGE]?.[key];
  const englishText = isVerified(english) ? english.text : SOURCE_PHRASES[key];
  return {
    phraseKey: key,
    params,
    text: interpolate(englishText, params),
    lang: SOURCE_LANGUAGE,
    fallback: lang !== SOURCE_LANGUAGE
  };
}

module.exports = {
  SOURCE_PHRASES,
  PHRASE_KEYS,
  buildSeedTemplates,
  isVerified,
  renderPhrase
};
