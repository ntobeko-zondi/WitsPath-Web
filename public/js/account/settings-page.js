// Settings page: every control reads and writes window.WitsPathSettings,
// which applies the change and (when signed in) syncs it to the account.
(function () {
  'use strict';

  const settings = window.WitsPathSettings;
  const auth = window.WitsPathAuth;
  const el = (id) => document.getElementById(id);
  const status = el('settingsStatus');

  settings.LANGUAGES.forEach(({ tag, name }) => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = name;
    if (tag) option.lang = tag;
    el('settingLanguage').appendChild(option);
  });

  // Same base speeds as the routing engine (TravelTimeConfig.speedFor).
  const BASE_SPEED = { wheelchair: 0.8, walking_aid: 1.1, low_vision: 1.1, none: 1.4 };

  function speedLabel(value) {
    const base = BASE_SPEED[settings.get('mobilityProfile')] || 1.4;
    return `${Number(value).toFixed(1)}× (${(base * value).toFixed(1)} metres per second)`;
  }

  function render() {
    el('settingTextSize').value = settings.get('textSize');
    el('settingContrast').checked = settings.get('highContrast');
    el('settingStepFree').checked = settings.get('stepFreeOnly');
    el('settingLifts').checked = settings.get('preferLifts');
    el('settingSteep').checked = settings.get('avoidSteepRamps');
    const dark = settings.get('darkMode');
    el('settingDark').value = dark === null ? 'system' : dark ? 'on' : 'off';
    el('settingSpeed').value = settings.get('walkingSpeed');
    el('settingSpeedValue').textContent = speedLabel(settings.get('walkingSpeed'));
    el('settingSpeed').setAttribute('aria-valuetext', speedLabel(settings.get('walkingSpeed')));
    el('settingLanguage').value = settings.get('language');
    el('settingSync').checked = settings.get('syncEnabled');
    const profile = document.querySelector(`input[name="settingProfile"][value="${settings.get('mobilityProfile')}"]`);
    if (profile) profile.checked = true;
  }

  function saved() {
    status.textContent = 'Saved.';
    clearTimeout(saved.timer);
    saved.timer = setTimeout(() => (status.textContent = ''), 2000);
  }

  const bind = (id, name, read) =>
    el(id).addEventListener('change', (event) => {
      settings.set(name, read(event.target));
      saved();
    });
  bind('settingTextSize', 'textSize', (t) => t.value);
  bind('settingContrast', 'highContrast', (t) => t.checked);
  bind('settingStepFree', 'stepFreeOnly', (t) => t.checked);
  bind('settingLifts', 'preferLifts', (t) => t.checked);
  bind('settingSteep', 'avoidSteepRamps', (t) => t.checked);
  bind('settingDark', 'darkMode', (t) => (t.value === 'system' ? null : t.value === 'on'));
  bind('settingSpeed', 'walkingSpeed', (t) => Number(t.value));
  bind('settingLanguage', 'language', (t) => t.value);
  bind('settingSync', 'syncEnabled', (t) => t.checked);
  el('settingSpeed').addEventListener('input', (event) => {
    el('settingSpeedValue').textContent = speedLabel(event.target.value);
  });
  document.querySelectorAll('input[name="settingProfile"]').forEach((input) =>
    input.addEventListener('change', () => {
      settings.set('mobilityProfile', input.value);
      saved();
    })
  );

  settings.onChange(render);
  render();

  auth.ready.then((enabled) => {
    if (!enabled) return;
    auth.onChange((user) => {
      el('syncGroup').hidden = !user;
      el('syncNote').textContent = user
        ? 'You are signed in: settings follow your account on the website and in the Android app (unless you turn syncing off).'
        : 'Settings are saved on this device. Sign in to have them follow you to the Android app.';
    });
  });
})();
