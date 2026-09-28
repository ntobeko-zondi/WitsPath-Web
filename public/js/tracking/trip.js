// Sender side of a live trip: picks a team-pinned destination, shares the
// browser's location with the server, and ends the trip. The server decides
// arrival and renders every status line; this page never claims arrival on
// its own except when the user presses "I've arrived".
(function () {
  'use strict';

  const TRIP_KEY = 'witspath.trip.active';
  const NAME_KEY = 'witspath.trip.name';
  // Send when moved this far, or at least this often while standing still so
  // followers don't see the trip go stale.
  const SEND_MIN_MOVE_M = 10;
  const SEND_MIN_INTERVAL_MS = 10000;
  const HEARTBEAT_MS = 30000;
  const SERVER_UNREACHABLE = "Can't reach the WitsPath server. Your location will be sent again when the connection is back.";

  const el = Object.fromEntries(
    [
      'tripSetup', 'tripName', 'tripCampus', 'tripPlace', 'tripNoPlaces', 'tripStart', 'tripSetupStatus',
      'tripActive', 'tripSenderStatus', 'tripLinkInput', 'tripCopy', 'tripNativeShare', 'tripWhatsApp', 'tripEmail',
      'tripSms', 'tripKeepAwakeRow', 'tripKeepAwake', 'tripArrived', 'tripStop', 'tripActionStatus', 'tripDone',
      'tripDoneMessage', 'tripMap'
    ].map((id) => [id, document.getElementById(id)])
  );

  const state = {
    campuses: [],
    places: [],
    map: null,
    trip: null, // { tripId, ownerToken, url, destination, expiresAt }
    watchId: null,
    lastSent: null, // { lat, lng, at }
    latestFix: null,
    heartbeat: null,
    wakeLock: null
  };

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the trip just won't resume after a reload.
    }
  }

  function metresBetween(a, b) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function setStatus(lines) {
    el.tripSenderStatus.replaceChildren(
      ...lines.map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      })
    );
  }

  // ---- setup --------------------------------------------------------------

  async function loadCampuses() {
    const response = await fetch('/api/campuses');
    state.campuses = (await response.json()).campuses;
    el.tripCampus.replaceChildren(
      ...state.campuses.map((campus) => {
        const option = document.createElement('option');
        option.value = campus.id;
        option.textContent = campus.name;
        return option;
      })
    );
  }

  async function loadPlaces() {
    const campus = state.campuses.find((item) => item.id === el.tripCampus.value);
    const response = await fetch(`/api/places?campus=${encodeURIComponent(campus.id)}`);
    state.places = (await response.json()).places;
    el.tripPlace.replaceChildren(
      ...state.places.map((place) => {
        const option = document.createElement('option');
        option.value = place.id;
        option.textContent = place.accessibleEntrance === true ? `${place.name} (accessible entrance)` : place.name;
        return option;
      })
    );
    el.tripNoPlaces.hidden = state.places.length > 0;
    el.tripStart.disabled = state.places.length === 0;
    state.map.setView(campus.center, campus.zoom);
    showSelectedPlace();
  }

  function showSelectedPlace() {
    const place = state.places.find((item) => item.id === el.tripPlace.value);
    if (!place) {
      state.map.removeMarker('destination');
      return;
    }
    state.map.setMarker('destination', place, { kind: 'destination', label: place.name });
    state.map.setView(place, 17);
  }

  async function startTrip(event) {
    event.preventDefault();
    const displayName = el.tripName.value.trim();
    if (!displayName) {
      el.tripSetupStatus.textContent = 'Please enter your name.';
      el.tripName.focus();
      return;
    }
    if (!('geolocation' in navigator)) {
      el.tripSetupStatus.textContent = "This browser can't share your location.";
      return;
    }
    storageSet(NAME_KEY, displayName);
    el.tripStart.disabled = true;
    el.tripSetupStatus.textContent = 'Starting…';

    let response;
    try {
      response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName, placeId: el.tripPlace.value })
      });
    } catch {
      el.tripSetupStatus.textContent = "Can't reach the WitsPath server. Check your connection and try again.";
      el.tripStart.disabled = false;
      return;
    }
    if (!response.ok) {
      el.tripSetupStatus.textContent = "Couldn't start the trip. Please choose a destination and try again.";
      el.tripStart.disabled = false;
      return;
    }
    const created = await response.json();
    const place = state.places.find((item) => item.id === el.tripPlace.value);
    state.trip = {
      tripId: created.tripId,
      ownerToken: created.ownerToken,
      url: new URL(created.path, window.location.origin).href,
      destination: { name: place.name, lat: place.lat, lng: place.lng },
      expiresAt: created.expiresAt,
      displayName
    };
    storageSet(TRIP_KEY, JSON.stringify(state.trip));
    beginSharing();
  }

  // ---- sharing --------------------------------------------------------------

  function beginSharing() {
    const trip = state.trip;
    el.tripSetup.hidden = true;
    el.tripActive.hidden = false;
    state.map.setMarker('destination', trip.destination, { kind: 'destination', label: trip.destination.name });
    setStatus([`Waiting for your location…`, `Destination: ${trip.destination.name}`]);
    fillShareLinks();

    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 30000
    });
    state.heartbeat = setInterval(() => {
      if (state.latestFix) sendLocation(state.latestFix, true);
    }, HEARTBEAT_MS);
    requestWakeLock();
    el.tripArrived.focus();
  }

  function fillShareLinks() {
    const { url, displayName, destination } = state.trip;
    const message = `Follow ${displayName}'s trip to ${destination.name} on WitsPath: ${url}`;
    el.tripLinkInput.value = url;
    el.tripWhatsApp.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
    el.tripEmail.href = `mailto:?subject=${encodeURIComponent(`${displayName}'s live trip on WitsPath`)}&body=${encodeURIComponent(message)}`;
    el.tripSms.href = `sms:?body=${encodeURIComponent(message)}`;
    el.tripNativeShare.hidden = typeof navigator.share !== 'function';
  }

  function onPosition(position) {
    const fix = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracyM: Math.round(position.coords.accuracy)
    };
    state.latestFix = fix;
    state.map.setMarker('me', fix, { kind: 'person', label: 'You' });
    state.map.setAccuracy('me', fix, fix.accuracyM);
    if (!state.lastSent) state.map.fitTo([fix, state.trip.destination]);
    sendLocation(fix, false);
  }

  function onPositionError(error) {
    if (error.code === error.PERMISSION_DENIED) {
      el.tripActionStatus.textContent =
        'Location permission was denied, so your trip cannot be shared. Allow location for this site, then start again.';
      finishTrip('stopped');
    } else {
      el.tripActionStatus.textContent = "Can't get your location right now. Move somewhere with a clearer view of the sky if you can.";
    }
  }

  async function sendLocation(fix, isHeartbeat) {
    const now = Date.now();
    if (state.lastSent && !isHeartbeat) {
      const moved = metresBetween(state.lastSent, fix);
      if (moved < SEND_MIN_MOVE_M && now - state.lastSent.at < SEND_MIN_INTERVAL_MS) return;
    }
    state.lastSent = { ...fix, at: now };

    let response;
    try {
      response = await fetch(`/api/trips/${encodeURIComponent(state.trip.tripId)}/location`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-token': state.trip.ownerToken },
        body: JSON.stringify(fix)
      });
    } catch {
      el.tripActionStatus.textContent = SERVER_UNREACHABLE;
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.trip) {
      finishTrip(body.trip.state);
      return;
    }
    if (response.status === 404) {
      el.tripActionStatus.textContent = 'This trip no longer exists on the server.';
      finishTrip('ended');
      return;
    }
    if (!response.ok) {
      el.tripActionStatus.textContent =
        body.error === 'location_out_of_range'
          ? 'Your location looks far from campus, so it was not shared.'
          : "Your last location couldn't be sent. Trying again shortly.";
      return;
    }
    el.tripActionStatus.textContent = '';
    if (body.state === 'arrived') {
      finishTrip('arrived');
      return;
    }
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const lines = [
      body.state === 'near' ? `You're near ${state.trip.destination.name}.` : `On the way to ${state.trip.destination.name}.`,
      `Location last shared at ${time}.`
    ];
    if (fix.accuracyM > 50) lines.push(`Your location is approximate, to within about ${fix.accuracyM} metres.`);
    setStatus(lines);
  }

  async function endTrip(reason) {
    el.tripArrived.disabled = true;
    el.tripStop.disabled = true;
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(state.trip.tripId)}/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-token': state.trip.ownerToken },
        body: JSON.stringify({ reason })
      });
      const body = await response.json().catch(() => ({}));
      finishTrip(body.state || reason);
    } catch {
      el.tripActionStatus.textContent = "Can't reach the WitsPath server. Your trip is still shared; try again.";
      el.tripArrived.disabled = false;
      el.tripStop.disabled = false;
    }
  }

  function finishTrip(finalState) {
    if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    clearInterval(state.heartbeat);
    releaseWakeLock();
    storageSet(TRIP_KEY, null);
    state.map.removeMarker('me');
    state.map.setAccuracy('me', null);

    const destination = state.trip ? state.trip.destination.name : 'your destination';
    const messages = {
      arrived: `You've arrived at ${destination}. Location sharing has stopped, and followers can see you arrived.`,
      stopped: 'Location sharing has stopped. Your last position was deleted.',
      ended: 'This trip has ended and location sharing has stopped.'
    };
    el.tripActive.hidden = true;
    el.tripSetup.hidden = true;
    el.tripDone.hidden = false;
    el.tripDoneMessage.textContent = messages[finalState] || messages.ended;
    el.tripDoneMessage.focus?.();
  }

  // ---- screen wake lock -----------------------------------------------------

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    el.tripKeepAwakeRow.hidden = false;
    if (!el.tripKeepAwake.checked || state.watchId === null) return;
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Denied (e.g. battery saver): sharing still works while the page is visible.
    }
  }

  function releaseWakeLock() {
    state.wakeLock?.release().catch(() => {});
    state.wakeLock = null;
  }

  // ---- copy & share -----------------------------------------------------------

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.tripLinkInput.value);
      el.tripCopy.textContent = 'Copied';
      el.tripActionStatus.textContent = 'Link copied. Paste it into WhatsApp, email or a text message.';
    } catch {
      el.tripLinkInput.select();
      el.tripActionStatus.textContent = 'Copying is blocked here. Select the link and copy it manually.';
    }
  }

  // ---- startup -----------------------------------------------------------------

  async function init() {
    const firstCampus = { lat: -26.1888766, lng: 28.0247912 };
    state.map = window.WitsPathMap.create(el.tripMap, { center: firstCampus, zoom: 16, label: 'Map of your trip' });

    el.tripName.value = storageGet(NAME_KEY) || '';
    el.tripSetup.addEventListener('submit', startTrip);
    el.tripCampus.addEventListener('change', loadPlaces);
    el.tripPlace.addEventListener('change', showSelectedPlace);
    el.tripCopy.addEventListener('click', copyLink);
    el.tripNativeShare.addEventListener('click', () =>
      navigator.share({ title: 'WitsPath live trip', url: state.trip.url }).catch(() => {})
    );
    el.tripArrived.addEventListener('click', () => endTrip('arrived'));
    el.tripStop.addEventListener('click', () => endTrip('stopped'));
    el.tripKeepAwake.addEventListener('change', () => (el.tripKeepAwake.checked ? requestWakeLock() : releaseWakeLock()));
    // Wake locks are dropped when the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.watchId !== null) requestWakeLock();
    });

    // Resume a trip after an accidental reload.
    const saved = storageGet(TRIP_KEY);
    if (saved) {
      try {
        const trip = JSON.parse(saved);
        if (new Date(trip.expiresAt) > new Date()) {
          state.trip = trip;
          beginSharing();
          return;
        }
      } catch {
        // Corrupt entry: fall through to a fresh setup.
      }
      storageSet(TRIP_KEY, null);
    }

    try {
      await loadCampuses();
      const requested = new URLSearchParams(window.location.search).get('campus');
      if (requested && state.campuses.some((campus) => campus.id === requested)) el.tripCampus.value = requested;
      await loadPlaces();
    } catch {
      el.tripSetupStatus.textContent = "Can't reach the WitsPath server. Check your connection and reload the page.";
      el.tripStart.disabled = true;
    }
  }

  init();
})();
