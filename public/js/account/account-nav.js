// Account part of the page navigation: "Log in" for guests; the user's name
// and "Log out" when signed in (like the Android nav drawer header).
(function () {
  'use strict';

  const el = {
    name: document.getElementById('accountName'),
    signedOut: document.getElementById('accountSignedOut'),
    signedIn: document.getElementById('accountSignedIn'),
    logOut: document.getElementById('logOutButton')
  };
  const auth = window.WitsPathAuth;

  // The user's own name is set in code, never through data-i18n.
  function render(user) {
    el.signedOut.hidden = Boolean(user);
    el.signedIn.hidden = !user;
    el.name.textContent = user ? user.displayName || user.email || 'Your account' : '';
  }

  el.logOut.addEventListener('click', async () => {
    const ok = window.confirm(
      'Log out?\n\nYour saved places stay on this device, but reports you make will be anonymous until you log back in.'
    );
    if (ok) await auth.signOut();
  });

  auth.ready.then((enabled) => {
    // Without accounts there is nothing to log in to; hide the link.
    if (!enabled) {
      el.signedOut.hidden = true;
      el.signedIn.hidden = true;
      return;
    }
    auth.onChange(render);
  });
})();
