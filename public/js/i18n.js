// Interface translations imported from the WitsPath Android app
// (public/i18n/*.json, made by functions/scripts/import-android-strings.js).
//
// Elements marked data-i18n="key" get the translated text for the interface
// language (settings.js). English is the text already in the page. Imported
// translations that nobody has reviewed yet are labelled as such.
//
// Only interface labels are translated here. Directions and live-trip status
// lines come from the server's verified phrase templates, never from here.
//
// window.WitsPathI18n.t(key, englishFallback) for text built in JavaScript.
(function () {
  'use strict';

  let strings = {};
  let current = 'en';

  function t(key, fallback) {
    return (current !== 'en' && strings[key]) || fallback;
  }

  function applyStrings() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      if (!('i18nEn' in element.dataset)) element.dataset.i18nEn = element.textContent;
      const key = element.dataset.i18n;
      const translated = current !== 'en' ? strings[key] : null;
      element.textContent = translated || element.dataset.i18nEn;
      if (translated) element.lang = current;
      else element.removeAttribute('lang');
    });
  }

  function showNotice(reviewed) {
    document.getElementById('i18nNotice')?.remove();
    if (current === 'en' || reviewed) return;
    const main = document.querySelector('main');
    if (!main) return;
    const notice = document.createElement('p');
    notice.id = 'i18nNotice';
    notice.className = 'i18n-notice';
    notice.lang = 'en';
    notice.textContent =
      'Interface text in this language comes from the WitsPath Android app and has not been reviewed for the website yet. Some text is still in English.';
    main.prepend(notice);
  }

  async function load() {
    const lang = window.WitsPathSettings ? window.WitsPathSettings.uiLanguage() : 'en';
    if (lang === current && lang === 'en') return;
    current = lang;
    strings = {};
    let reviewed = true;
    if (lang !== 'en') {
      try {
        const response = await fetch(`/i18n/${encodeURIComponent(lang)}.json`);
        if (response.ok) {
          const data = await response.json();
          reviewed = Boolean(data._meta?.reviewed);
          strings = data;
        }
      } catch {
        // Offline: stay in English.
      }
    }
    applyStrings();
    showNotice(reviewed);
    document.dispatchEvent(new CustomEvent('witspath:i18n'));
  }

  window.WitsPathI18n = { t, load };

  document.addEventListener('DOMContentLoaded', () => {
    load();
    window.WitsPathSettings?.onChange((name) => {
      if (name === 'language' || name === '*') load();
    });
  });
})();
