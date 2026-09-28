// WitsPath accounts: Firebase Auth email/password sign-in, the same accounts
// as the Android app. Loaded on every page after firebase-config.js.
//
// window.WitsPathAuth:
//   ready                     Promise<boolean>  (false when accounts are off)
//   enabled                   boolean
//   user                      { uid, displayName, email } | null
//   onChange(fn)              calls fn(user) now and on every change; returns unsubscribe
//   signIn(email, password)
//   signUp({ name, email, password, mobilityProfile })
//   signOut()
//   resetPassword(email)
//   authorizedFetch(url, options)   fetch with the user's ID token attached
//   errorMessage(error)       a friendly sentence for a Firebase auth error
(function () {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
  const config = window.WITSPATH_FIREBASE_CONFIG;
  const listeners = new Set();
  let auth = null;
  let sdk = null;
  let current = null;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function publicUser() {
    return current && !current.isAnonymous
      ? { uid: current.uid, displayName: current.displayName || null, email: current.email || null }
      : null;
  }

  function notify() {
    const user = publicUser();
    listeners.forEach((fn) => fn(user));
  }

  async function init() {
    if (!config || !config.apiKey) {
      resolveReady(false);
      notify();
      return;
    }
    try {
      const [appSdk, authSdk] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
      sdk = authSdk;
      auth = authSdk.getAuth(appSdk.initializeApp(config));
      authSdk.onAuthStateChanged(auth, (user) => {
        current = user;
        notify();
        resolveReady(true);
      });
    } catch (error) {
      console.error('[witspath] Could not load sign-in', error);
      resolveReady(false);
      notify();
    }
  }

  function requireAuth() {
    if (!auth) throw Object.assign(new Error('Accounts are not set up on this site yet.'), { code: 'witspath/disabled' });
  }

  async function authorizedFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (current) headers.authorization = `Bearer ${await current.getIdToken()}`;
    return fetch(url, { ...options, headers });
  }

  const MESSAGES = {
    'auth/invalid-credential': 'That email and password don’t match an account.',
    'auth/wrong-password': 'That email and password don’t match an account.',
    'auth/user-not-found': 'That email and password don’t match an account.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Try logging in.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Can’t reach the sign-in service. Check your connection.',
    'witspath/disabled': 'Accounts are not set up on this site yet.'
  };

  window.WitsPathAuth = {
    ready,
    get enabled() {
      return Boolean(auth);
    },
    get user() {
      return publicUser();
    },
    onChange(fn) {
      listeners.add(fn);
      fn(publicUser());
      return () => listeners.delete(fn);
    },
    async signIn(email, password) {
      requireAuth();
      await sdk.signInWithEmailAndPassword(auth, email, password);
    },
    // Same steps as the Android SignUpActivity: create the account, set the
    // display name, then save users/{uid} (here through the server).
    async signUp({ name, email, password, mobilityProfile }) {
      requireAuth();
      const credential = await sdk.createUserWithEmailAndPassword(auth, email, password);
      await sdk.updateProfile(credential.user, { displayName: name });
      current = credential.user;
      const response = await authorizedFetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name, mobilityProfile })
      });
      if (!response.ok) throw new Error('Your account was created, but your profile could not be saved. Try again from Settings.');
      notify();
    },
    async signOut() {
      requireAuth();
      await sdk.signOut(auth);
    },
    async resetPassword(email) {
      requireAuth();
      await sdk.sendPasswordResetEmail(auth, email);
    },
    authorizedFetch,
    errorMessage(error) {
      return MESSAGES[error?.code] || error?.message || 'Something went wrong. Please try again.';
    }
  };

  init();
})();
