const STORAGE_KEYS = {
  language: 'pref_ui_language',
  highContrast: 'pref_high_contrast',
  darkMode: 'pref_dark_mode',
  stepFreeOnly: 'pref_step_free_only',
  textSize: 'pref_text_size',
  mobilityProfile: 'pref_mobility_profile',
  username: 'account_username',
  email: 'account_email',
  syncSettings: 'pref_sync_settings',
  screenReaderDescriptions: 'pref_screen_reader_descriptions',
  visualAssistance: 'pref_visual_assistance',
  preferLifts: 'pref_prefer_lifts',
  avoidSteepRamps: 'pref_avoid_steep_ramps',
  voiceGuidance: 'pref_voice_guidance',
  vibrationCues: 'pref_vibration_cues',
  autoDetectLocation: 'pref_auto_detect_location',
  distanceDisplay: 'pref_distance_display',
  showFlaggedPaths: 'pref_show_flagged_paths',
  reports: 'witspath_reports'
};

const LANGUAGES = {
  '': 'System default',
  en: 'English',
  zu: 'isiZulu',
  st: 'Sesotho',
  tn: 'Setswana',
  xh: 'isiXhosa',
  af: 'Afrikaans'
};

function readStorage(key, fallback) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value;
}

function setStorage(key, value) {
  localStorage.setItem(key, value);
}

function readBooleanSetting(key, fallback = false) {
  return readStorage(key, String(fallback)) === 'true';
}

function formatRouteDistance(distanceMeters, displayMode = 'meters', mobilityProfile = 'no-preference') {
  if (displayMode === 'feet') {
    return `${Math.round(distanceMeters * 3.28084)} ft`;
  }

  if (displayMode === 'minutes') {
    const speeds = {
      wheelchair: 0.8,
      'walking-aid': 1.1,
      'low-vision': 1.1,
      'no-preference': 1.73
    };
    const speed = speeds[mobilityProfile] || speeds['no-preference'];
    return `${Math.max(1, Math.round(distanceMeters / speed / 60))} min`;
  }

  return `${Math.round(distanceMeters)} m`;
}

function applyTextScale(value, persist = true) {
  document.body.dataset.textScale = value || 'default';
  if (persist) setStorage(STORAGE_KEYS.textSize, value || 'default');
}

function applyContrast(enabled, persist = true) {
  document.body.dataset.contrast = enabled ? 'true' : 'false';
  if (persist) setStorage(STORAGE_KEYS.highContrast, String(enabled));
}

function applyDarkMode(enabled, persist = true) {
  document.body.dataset.theme = enabled ? 'dark' : 'light';
  if (persist) setStorage(STORAGE_KEYS.darkMode, String(enabled));
  if (window.appElements?.darkModeCheckbox) {
    window.appElements.darkModeCheckbox.checked = enabled;
  }
  if (window.appElements?.darkModeToggle) {
    const label = enabled ? 'Switch to light mode' : 'Switch to dark mode';
    window.appElements.darkModeToggle.setAttribute('aria-label', label);
    window.appElements.darkModeToggle.setAttribute('title', label);
    window.appElements.darkModeToggle.setAttribute('aria-pressed', String(enabled));
  }
}

function applyLanguage(tag, persist = true) {
  const activeTag = tag || '';
  const languageLabel = LANGUAGES[activeTag] || LANGUAGES[''];
  document.documentElement.lang = activeTag || 'en';
  if (persist) setStorage(STORAGE_KEYS.language, activeTag);
  if (window.appElements?.languageButton) {
    window.appElements.languageButton.title = languageLabel;
    window.appElements.languageButton.setAttribute('aria-label', `Language: ${languageLabel}`);
  }
}
