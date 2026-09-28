'use strict';

const config = require('../config');

// users/{uid}, shared with the Android app: { displayName, email,
// preferences: { pref_* } }. Preference keys and values follow the Android
// Prefs class, so a setting changed on the website shows up in the app.

const MOBILITY_PROFILES = ['none', 'wheelchair', 'walking_aid', 'low_vision'];
// Android Languages.TAGS ("" = follow the device).
const UI_LANGUAGES = ['', 'en', 'zu', 'st', 'tn', 'xh', 'af'];
const TEXT_SIZES = ['small', 'default', 'large', 'huge'];

const PREFERENCE_VALIDATORS = {
  pref_ui_language: (value) => UI_LANGUAGES.includes(value),
  pref_mobility_profile: (value) => MOBILITY_PROFILES.includes(value),
  pref_step_free_only: (value) => typeof value === 'boolean',
  pref_avoid_steep_ramps: (value) => typeof value === 'boolean',
  pref_prefer_lifts: (value) => typeof value === 'boolean',
  pref_high_contrast: (value) => typeof value === 'boolean',
  pref_text_size: (value) => TEXT_SIZES.includes(value),
  pref_sync_enabled: (value) => typeof value === 'boolean',
  // Android keeps this as a string in SharedPreferences ("1.0").
  pref_walking_speed_multiplier: (value) => {
    const number = Number(value);
    return (
      typeof value === 'string' &&
      Number.isFinite(number) &&
      number >= config.SPEED_MULTIPLIER_MIN &&
      number <= config.SPEED_MULTIPLIER_MAX
    );
  }
};

/** Keep only known preference keys with valid values. */
function cleanPreferences(input) {
  const result = {};
  const rejected = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (PREFERENCE_VALIDATORS[key]?.(value)) result[key] = value;
    else rejected.push(key);
  }
  return { preferences: result, rejected };
}

async function getProfile(store, claims) {
  const user = (await store.getUser(claims.uid)) || {};
  return {
    uid: claims.uid,
    displayName: user.displayName || claims.name || null,
    email: user.email || claims.email || null,
    preferences: cleanPreferences(user.preferences).preferences
  };
}

/** After sign-up: same document shape the Android SignUpActivity writes. */
async function saveProfile(store, claims, { displayName, mobilityProfile }) {
  const name = typeof displayName === 'string' ? displayName.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return { error: 'invalid_input', message: 'Enter your name.' };
  const profile = MOBILITY_PROFILES.includes(mobilityProfile) ? mobilityProfile : 'none';
  await store.mergeUser(claims.uid, {
    displayName: name,
    email: claims.email || null,
    preferences: { pref_mobility_profile: profile }
  });
  return getProfile(store, claims);
}

async function savePreferences(store, claims, input) {
  const { preferences, rejected } = cleanPreferences(input);
  if (rejected.length) return { error: 'invalid_input', message: `Invalid preferences: ${rejected.join(', ')}` };
  await store.mergeUser(claims.uid, { preferences });
  return getProfile(store, claims);
}

module.exports = { getProfile, saveProfile, savePreferences, cleanPreferences, MOBILITY_PROFILES };
