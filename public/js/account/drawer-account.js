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

  function render(user) {
    el.signedOut.hidden = Boolean(user);
    el.signedIn.hidden = !user;
    el.name.textContent = user ? user.displayName || 'Your account' : 'Guest';
    el.detail.textContent = user ? user.email || '' : 'Sign in or create an account';
  }

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
