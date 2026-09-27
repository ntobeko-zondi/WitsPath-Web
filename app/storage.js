const STORAGE_KEYS = {
  language: 'pref_ui_language',
  highContrast: 'pref_high_contrast',
  darkMode: 'pref_dark_mode',
  stepFreeOnly: 'pref_step_free_only',
  textSize: 'pref_text_size'
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

function applyTextScale(value) {
  document.body.dataset.textScale = value || 'default';
  setStorage(STORAGE_KEYS.textSize, value || 'default');
}

function applyContrast(enabled) {
  document.body.dataset.contrast = enabled ? 'true' : 'false';
  setStorage(STORAGE_KEYS.highContrast, String(enabled));
}

function applyDarkMode(enabled) {
  document.body.dataset.theme = enabled ? 'dark' : 'light';
  setStorage(STORAGE_KEYS.darkMode, String(enabled));
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

function applyLanguage(tag) {
  const activeTag = tag || '';
  const languageLabel = LANGUAGES[activeTag] || LANGUAGES[''];
  document.documentElement.lang = activeTag || 'en';
  setStorage(STORAGE_KEYS.language, activeTag);
  if (window.appElements?.languageButton) {
    window.appElements.languageButton.title = languageLabel;
    window.appElements.languageButton.setAttribute('aria-label', `Language: ${languageLabel}`);
  }
}
