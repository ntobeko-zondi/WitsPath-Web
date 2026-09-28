const profileInputs = document.querySelectorAll('input[name="mobilityProfile"]');
const profileStatus = document.getElementById('profileStatus');
const savedProfile = readStorage(STORAGE_KEYS.mobilityProfile, '');
const initialProfile = savedProfile || (
  readBooleanSetting(STORAGE_KEYS.stepFreeOnly, true) ? 'wheelchair' : 'no-preference'
);
const languageSelect = document.getElementById('language');

Object.entries(LANGUAGES).forEach(([tag, label]) => {
  const option = document.createElement('option');
  option.value = tag;
  option.textContent = label;
  languageSelect.appendChild(option);
});

languageSelect.value = readStorage(STORAGE_KEYS.language, '');
document.getElementById('textSize').value = readStorage(STORAGE_KEYS.textSize, 'default');
document.getElementById('username').value = readStorage(STORAGE_KEYS.username, '');
document.getElementById('email').value = readStorage(STORAGE_KEYS.email, '');
document.documentElement.lang = languageSelect.value || 'en';
document.body.dataset.theme = readStorage(STORAGE_KEYS.darkMode, 'false') === 'true' ? 'dark' : 'light';
document.body.dataset.contrast = readStorage(STORAGE_KEYS.highContrast, 'false') === 'true' ? 'true' : 'false';
document.body.dataset.textScale = readStorage(STORAGE_KEYS.textSize, 'default');

document.querySelectorAll('[data-setting]').forEach((control) => {
  const key = STORAGE_KEYS[control.dataset.setting];
  if (!key) {
    return;
  }

  if (control.type === 'checkbox') {
    control.checked = readBooleanSetting(key);
  } else if (control.type === 'radio') {
    control.checked = readStorage(key, 'meters') === control.value;
  } else {
    control.value = readStorage(key, control.dataset.setting === 'language' ? '' : 'default');
  }

  control.addEventListener('change', () => {
    if (control.type === 'radio' && !control.checked) {
      return;
    }
    const value = control.type === 'checkbox' ? String(control.checked) : control.value;
    setStorage(key, value);

    if (control.dataset.setting === 'language') {
      document.documentElement.lang = control.value || 'en';
    } else if (control.dataset.setting === 'darkMode') {
      document.body.dataset.theme = control.checked ? 'dark' : 'light';
    } else if (control.dataset.setting === 'highContrast') {
      document.body.dataset.contrast = control.checked ? 'true' : 'false';
    } else if (control.dataset.setting === 'textSize') {
      document.body.dataset.textScale = control.value;
    }
    profileStatus.textContent = 'Setting saved.';
  });
});

profileInputs.forEach((input) => {
  input.checked = input.value === initialProfile;
  input.addEventListener('change', (event) => {
    const profile = event.target.value;
    const stepFreeOnly = profile === 'wheelchair' || profile === 'low-vision';
    const avoidSteepRamps = profile === 'wheelchair' || profile === 'walking-aid';
    setStorage(STORAGE_KEYS.mobilityProfile, profile);
    setStorage(STORAGE_KEYS.stepFreeOnly, String(stepFreeOnly));
    setStorage(STORAGE_KEYS.avoidSteepRamps, String(avoidSteepRamps));
    document.getElementById('stepFreeOnly').checked = stepFreeOnly;
    document.getElementById('avoidSteepRamps').checked = avoidSteepRamps;
    profileStatus.textContent = 'Mobility profile saved.';
  });
});

function initializeProfileDefaults(profile) {
  if (localStorage.getItem(STORAGE_KEYS.stepFreeOnly) === null) {
    const stepFreeOnly = profile === 'wheelchair' || profile === 'low-vision';
    document.getElementById('stepFreeOnly').checked = stepFreeOnly;
    setStorage(STORAGE_KEYS.stepFreeOnly, String(stepFreeOnly));
  }
  if (localStorage.getItem(STORAGE_KEYS.avoidSteepRamps) === null) {
    const avoidSteepRamps = profile === 'wheelchair' || profile === 'walking-aid';
    document.getElementById('avoidSteepRamps').checked = avoidSteepRamps;
    setStorage(STORAGE_KEYS.avoidSteepRamps, String(avoidSteepRamps));
  }
}

initializeProfileDefaults(initialProfile);

const usernameInput = document.getElementById('username');
const emailInput = document.getElementById('email');
const editAccountButton = document.getElementById('editAccount');
const saveAccountButton = document.getElementById('saveAccount');

editAccountButton.addEventListener('click', () => {
  usernameInput.disabled = false;
  emailInput.disabled = false;
  saveAccountButton.disabled = false;
  usernameInput.focus();
});

document.getElementById('saveAccount').addEventListener('click', () => {
  if (!emailInput.reportValidity()) return;
  setStorage(STORAGE_KEYS.username, usernameInput.value.trim());
  setStorage(STORAGE_KEYS.email, emailInput.value.trim());
  usernameInput.disabled = true;
  emailInput.disabled = true;
  saveAccountButton.disabled = true;
  profileStatus.textContent = 'Account information saved on this device.';
});