// Viewer side of a live trip (/track/{tripId}). Polls the server and shows
// the status lines it renders from verified phrase templates, plus a map.
(function () {
  'use strict';

  const POLL_VISIBLE_MS = 5000;
  const POLL_HIDDEN_MS = 30000;
  const FINAL_STATES = new Set(['arrived', 'stopped', 'ended']);

  const title = document.getElementById('trackTitle');
  const live = document.getElementById('trackLive');
  const status = document.getElementById('trackStatus');
  const errorLine = document.getElementById('trackError');
  const mapContainer = document.getElementById('trackMap');

  const tripId = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');
  const lang = new URLSearchParams(window.location.search).get('lang') || (navigator.language || 'en').split('-')[0];

  let map = null;
  let lastRendered = '';
  let framed = false;
  let timer = null;

  function render(view) {
    title.textContent = `${view.displayName}'s trip to ${view.destination.name}`;
    document.title = `${view.displayName}'s live trip · WitsPath`;
    live.hidden = FINAL_STATES.has(view.state) || view.state === 'stale';

    // Only touch the live region when the text changes, so screen readers
    // aren't interrupted every poll.
    const signature = JSON.stringify(view.messages);
    if (signature !== lastRendered) {
      lastRendered = signature;
      status.replaceChildren(
        ...view.messages.map((message) => {
          const li = document.createElement('li');
          li.textContent = message.text;
          li.lang = message.lang;
          return li;
        })
      );
    }

    if (!map) {
      map = window.WitsPathMap.create(mapContainer, { center: view.destination, zoom: 17, label: `Map of ${view.displayName}'s trip` });
    }
    map.setMarker('destination', view.destination, { kind: 'destination', label: view.destination.name });
    if (view.position) {
      map.setMarker('person', view.position, { kind: 'person', label: view.displayName });
      map.setAccuracy('person', view.position, view.position.accuracyM);
      if (!framed) {
        map.fitTo([view.position, view.destination]);
        framed = true;
      }
    } else {
      map.removeMarker('person');
      map.setAccuracy('person', null);
    }
  }

  async function poll() {
    let response;
    try {
      response = await fetch(`/api/trips/${encodeURIComponent(tripId)}?lang=${encodeURIComponent(lang)}`);
    } catch {
      errorLine.textContent = "Can't reach WitsPath right now. Retrying…";
      schedule();
      return;
    }
    if (response.status === 404) {
      title.textContent = 'Trip not found';
      status.replaceChildren();
      errorLine.textContent = 'This link is not valid, or the trip was removed.';
      return;
    }
    if (!response.ok) {
      errorLine.textContent = 'Something went wrong loading the trip. Retrying…';
      schedule();
      return;
    }
    errorLine.textContent = '';
    const view = await response.json();
    render(view);
    if (!FINAL_STATES.has(view.state)) schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(poll, document.visibilityState === 'visible' ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timer) {
      clearTimeout(timer);
      poll();
    }
  });

  poll();
})();
