// Sign up page: same fields and rules as the Android SignUpActivity.
(function () {
  'use strict';

  const MIN_PASSWORD = 8; // as the Android form's helper text says
  const form = document.getElementById('signupForm');
  const submit = document.getElementById('signupSubmit');
  const status = document.getElementById('signupStatus');
  const field = (id) => document.getElementById(id);
  const auth = window.WitsPathAuth;

  function fail(message, input) {
    status.textContent = message;
    input?.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = field('signupName').value.trim();
    const email = field('signupEmail').value.trim();
    const password = field('signupPassword').value;
    if (!name || !email || !password) return fail('All fields are required.', !name ? field('signupName') : !email ? field('signupEmail') : field('signupPassword'));
    if (password.length < MIN_PASSWORD) return fail(`Choose a password with at least ${MIN_PASSWORD} characters.`, field('signupPassword'));
    if (password !== field('signupConfirm').value) return fail('Passwords do not match.', field('signupConfirm'));

    submit.disabled = true;
    status.textContent = 'Creating your account…';
    try {
      await auth.signUp({ name, email, password, mobilityProfile: form.querySelector('input[name="mobility"]:checked').value });
      window.location.assign('/');
    } catch (error) {
      status.textContent = auth.errorMessage(error);
      submit.disabled = false;
    }
  });

  auth.ready.then((enabled) => {
    if (!enabled) {
      document.getElementById('accountsOff').hidden = false;
      submit.disabled = true;
    }
  });
})();
