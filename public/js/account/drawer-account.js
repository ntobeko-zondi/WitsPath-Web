// Account section of the main page's drawer (like the Android nav drawer):
// guest / signed-in name, log in / sign up, my reports, log out.
(function () {
  'use strict';

  const el = {
    name: document.getElementById('accountName'),
    detail: document.getElementById('accountDetail'),
    signedOut: document.getElementById('accountSignedOut'),
    signedIn: document.getElementById('accountSignedIn'),
    logOut: document.getElementById('logOutButton')
  };
  const auth = window.WitsPathAuth;
  const t = (key, fallback) => (window.WitsPathI18n ? window.WitsPathI18n.t(key, fallback) : fallback);
  let lastUser = null;

  // Built in code (not data-i18n) because it shows the user's own name.
  function render(user) {
    lastUser = user;
    el.signedOut.hidden = Boolean(user);
    el.signedIn.hidden = !user;
    el.name.textContent = user ? user.displayName || 'Your account' : t('nav_guest_title', 'Guest');
    el.detail.textContent = user ? user.email || '' : 'Sign in or create an account';
  }
  document.addEventListener('witspath:i18n', () => {
    if (auth.enabled) render(lastUser);
  });

  el.logOut.addEventListener('click', async () => {
    const ok = window.confirm(
      'Log out?\n\nYour saved places stay on this device, but reports you make will be anonymous until you log back in.'
    );
    if (!ok) return;
    await auth.signOut();
    el.name.focus?.();
  });

  auth.ready.then((enabled) => {
    if (!enabled) {
      el.detail.textContent = 'Accounts are not set up on this site yet.';
      el.signedOut.hidden = true;
      el.signedIn.hidden = true;
      return;
    }
    auth.onChange(render);
  });
})();
