// WitsPath settings - one module for every page.
//
// Stored under the Android app's preference keys (util/Prefs.java), so when
// you're signed in they sync to users/{uid}.preferences and follow you
// between the website and the app. Saved places, home base and the next-class
// reminder stay on this device, as they do on Android.
//
// window.WitsPathSettings:
//   get(name) / set(name, value) / onChange(fn) / apply()
//   LANGUAGES  - interface languages (the Android app's six)
(function () {
  'use strict';

  // Android Languages.java: "" follows the browser.
  const LANGUAGES = [
    { tag: '', name: 'Browser default' },
    { tag: 'en', name: 'English' },
    { tag: 'zu', name: 'isiZulu' },
    { tag: 'st', name: 'Sesotho' },
    { tag: 'tn', name: 'Setswana' },
    { tag: 'xh', name: 'isiXhosa' },
    { tag: 'af', name: 'Afrikaans' }
  ];

  // name -> [Android preference key, default, synced to the account?]
  const SETTINGS = {
    language: ['pref_ui_language', '', true],
    textSize: ['pref_text_size', 'default', true],
    highContrast: ['pref_high_contrast', false, true],
    stepFreeOnly: ['pref_step_free_only', true, true],
    mobilityProfile: ['pref_mobility_profile', 'none', true],
    walkingSpeed: ['pref_walking_speed_multiplier', 1, true],
    syncEnabled: ['pref_sync_enabled', true, true],
    homeNodeId: ['pref_home_node_id', '', false],
    savedPlaces: ['pref_saved_places_json', [], false],
    nextClass: ['witspath_next_class', null, false]
  };

  const listeners = new Set();
  let pushTimer = null;

  function storage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function get(name) {
    const [key, fallback] = SETTINGS[name];
    let raw = null;
    try {
      raw = storage()?.getItem(key) ?? null;
    } catch {
      raw = null;
    }
    if (raw === null) return fallback;
    if (typeof fallback === 'boolean') return raw === 'true';
    if (typeof fallback === 'number') {
      const number = Number(raw);
      return Number.isFinite(number) ? number : fallback;
    }
    if (Array.isArray(fallback) || fallback === null) {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
    return raw;
  }

  function write(name, value) {
    const [key, fallback] = SETTINGS[name];
    let raw;
    if (typeof fallback === 'number') raw = Number(value).toFixed(1); // Android stores "1.0"
    else if (Array.isArray(fallback) || fallback === null) raw = JSON.stringify(value);
    else raw = String(value);
    try {
      storage()?.setItem(key, raw);
    } catch {
      // Storage blocked: the setting applies for this page only.
    }
  }

  function set(name, value) {
    write(name, value);
    apply();
    listeners.forEach((fn) => fn(name, get(name)));
    if (SETTINGS[name][2]) schedulePush();
  }

  /** Apply the settings that change how every page looks. */
  function apply() {
    const body = document.body;
    if (!body) return;
    body.dataset.textScale = get('textSize');
    body.dataset.contrast = String(get('highContrast'));
    const language = get('language') || (navigator.language || 'en').split('-')[0];
    const known = LANGUAGES.some((lang) => lang.tag === language) ? language : 'en';
    body.dataset.uiLang = known;
    document.documentElement.lang = known;
  }

  // ---- account sync --------------------------------------------------------

  function androidValue(name) {
    const value = get(name);
    return name === 'walkingSpeed' ? Number(value).toFixed(1) : value;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 800);
  }

  async function push() {
    const auth = window.WitsPathAuth;
    if (!auth?.user || !get('syncEnabled')) return;
    const preferences = {};
    for (const [name, [key, , synced]] of Object.entries(SETTINGS)) {
      if (synced) preferences[key] = androidValue(name);
    }
    try {
      await auth.authorizedFetch('/api/me/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferences })
      });
    } catch {
      // Offline: the next change pushes everything again.
    }
  }

  /** On sign-in, the account's saved preferences win over this device's. */
  async function pull() {
    const auth = window.WitsPathAuth;
    try {
      const response = await auth.authorizedFetch('/api/me');
      if (!response.ok) return;
      const { preferences } = await response.json();
      if (preferences.pref_sync_enabled === false) return;
      for (const [name, [key, , synced]] of Object.entries(SETTINGS)) {
        if (synced && preferences[key] !== undefined) write(name, preferences[key]);
      }
      apply();
      listeners.forEach((fn) => fn('*', null));
    } catch {
      // Keep this device's settings.
    }
  }

  function watchAccount() {
    const auth = window.WitsPathAuth;
    if (!auth) return;
    let lastUid = null;
    auth.ready.then((enabled) => {
      if (!enabled) return;
      auth.onChange((user) => {
        if (user && user.uid !== lastUid) pull();
        lastUid = user?.uid || null;
      });
    });
  }

  window.WitsPathSettings = {
    LANGUAGES,
    get,
    set,
    apply,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };

  // Apply as early as possible to avoid a flash of the wrong theme/size.
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('DOMContentLoaded', watchAccount);
})();
