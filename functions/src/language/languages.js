'use strict';

// The 11 official South African languages and what the companion can honestly
// do in each one. This is the single source of truth: the browser widget
// fetches it from /api/companion/config instead of keeping its own copy.
//
// tier 'full'    - Tier 1 free-form replies are enabled, and the language has
//                  real speech-to-text vendor support (Vulavula).
// tier 'limited' - the model may attempt a reply, but the UI must flag it as
//                  unverified. No vendor STT. Spoken output only if the
//                  viewer's device happens to have a voice for it.
//
// Tier 2 (safety-critical direction phrases) is independent of this tier: it
// depends only on which phrase_templates entries carry a verifiedBy value.

const LANGUAGES = {
  en: { name: 'English', tier: 'full', bcp47: 'en-ZA', vulavulaCode: 'eng' },
  af: { name: 'Afrikaans', tier: 'full', bcp47: 'af-ZA', vulavulaCode: 'afr' },
  zu: { name: 'isiZulu', tier: 'full', bcp47: 'zu-ZA', vulavulaCode: 'zul' },
  st: { name: 'Sesotho', tier: 'full', bcp47: 'st-ZA', vulavulaCode: 'sot' },
  xh: { name: 'isiXhosa', tier: 'limited', bcp47: 'xh-ZA', vulavulaCode: null },
  tn: { name: 'Setswana', tier: 'limited', bcp47: 'tn-ZA', vulavulaCode: null },
  nso: { name: 'Sepedi', tier: 'limited', bcp47: 'nso-ZA', vulavulaCode: null },
  ss: { name: 'siSwati', tier: 'limited', bcp47: 'ss-ZA', vulavulaCode: null },
  ve: { name: 'Tshivenda', tier: 'limited', bcp47: 've-ZA', vulavulaCode: null },
  ts: { name: 'Xitsonga', tier: 'limited', bcp47: 'ts-ZA', vulavulaCode: null },
  nr: { name: 'isiNdebele', tier: 'limited', bcp47: 'nr-ZA', vulavulaCode: null }
};

const LANGUAGE_CODES = Object.keys(LANGUAGES);
const SOURCE_LANGUAGE = 'en';

function isKnownLanguage(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

// Any language outside the 11 (e.g. French) is 'unsupported' - flagged in the
// UI even more strongly than 'limited'.
function tierFor(code) {
  return isKnownLanguage(code) ? LANGUAGES[code].tier : 'unsupported';
}

function fromVulavulaCode(vulavulaCode) {
  const match = LANGUAGE_CODES.find((code) => LANGUAGES[code].vulavulaCode === vulavulaCode);
  return match || null;
}

function publicLanguageList() {
  return LANGUAGE_CODES.map((code) => ({ code, ...LANGUAGES[code] }));
}

module.exports = {
  LANGUAGES,
  LANGUAGE_CODES,
  SOURCE_LANGUAGE,
  isKnownLanguage,
  tierFor,
  fromVulavulaCode,
  publicLanguageList
};
