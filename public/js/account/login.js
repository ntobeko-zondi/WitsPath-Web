// Log in page. After signing in, returns to ?next= (same-site paths only).
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  const email = document.getElementById('loginEmail');
  const password = document.getElementById('loginPassword');
  const submit = document.getElementById('loginSubmit');
  const forgot = document.getElementById('loginForgot');
  const status = document.getElementById('loginStatus');
  const auth = window.WitsPathAuth;

  // Only allow redirects to paths on this site.
  function nextPath() {
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!email.value.trim() || !password.value) {
      status.textContent = 'Email and password are required.';
      return;
    }
    submit.disabled = true;
    status.textContent = '';
    try {
      await auth.signIn(email.value.trim(), password.value);
      window.location.assign(nextPath());
    } catch (error) {
      status.textContent = auth.errorMessage(error);
      submit.disabled = false;
    }
  });

  forgot.addEventListener('click', async () => {
    if (!email.value.trim()) {
      status.textContent = 'Please enter your email address first.';
      email.focus();
      return;
    }
    try {
      await auth.resetPassword(email.value.trim());
      status.textContent = 'If that address has an account, a reset email is on its way.';
    } catch (error) {
      status.textContent = auth.errorMessage(error);
    }
  });

  auth.ready.then((enabled) => {
    if (!enabled) {
      document.getElementById('accountsOff').hidden = false;
      submit.disabled = true;
      forgot.disabled = true;
    } else if (auth.user) {
      window.location.replace(nextPath());
    }
  });
})();
