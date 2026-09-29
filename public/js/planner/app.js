window.appState = {
  graph: null,
  route: null,
  floor: null,
  mapScale: 1,
  mapX: 0,
  mapY: 0,
  minScale: 1,
  maxScale: 4
};

window.appElements = {
  fromSelect: document.getElementById('fromSelect'),
  toSelect: document.getElementById('toSelect'),
  startNavigation: document.getElementById('startNavigation'),
  swapButton: document.getElementById('swapButton'),
  useHomeBase: document.getElementById('useHomeBase'),
  saveDestination: document.getElementById('saveDestination'),
  statusMessage: document.getElementById('statusMessage'),
  mapTitle: document.getElementById('mapTitle'),
  guidanceText: document.getElementById('guidanceText'),
  stepsList: document.getElementById('stepsList'),
  estimatedTime: document.getElementById('estimatedTime'),
  estimatedDistance: document.getElementById('estimatedDistance'),
  mapViewport: document.getElementById('mapViewport'),
  mapSurface: document.getElementById('mapSurface'),
  routeOverlay: document.getElementById('routeOverlay'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  resetView: document.getElementById('resetView')
};

function showStatus(message, type) {
  window.appElements.statusMessage.textContent = message;
  window.appElements.statusMessage.className = `status-message ${type}`;
}

function placeOption(nodeId, text) {
  const option = document.createElement('option');
  option.value = nodeId;
  option.textContent = text;
  return option;
}

// Home base and saved places first (like the Android room picker), then every
// named place. Junctions ("node") and ramps are waypoints on the way to a
// building, not destinations, so they aren't listed (routes still use them).
const WAYPOINT_TYPES = new Set(['node', 'ramp']);
function buildNodeOptions(nodes) {
  const list = nodes
    .filter((node) => node && node.label && !WAYPOINT_TYPES.has(node.type))
    .sort((a, b) => a.label.localeCompare(b.label));
  const names = new Map(list.map((node) => [node.nodeId, node.label.trim()]));
  const settings = window.WitsPathSettings;
  const home = settings.get('homeNodeId');
  const saved = settings.get('savedPlaces').filter((place) => names.has(place.nodeId));

  for (const select of [window.appElements.fromSelect, window.appElements.toSelect]) {
    const current = select.value;
    const groups = [];
    if (names.has(home) || saved.length) {
      const mine = document.createElement('optgroup');
      mine.label = 'Your places';
      if (names.has(home)) mine.appendChild(placeOption(home, `Home base: ${names.get(home)}`));
      saved.forEach((place) => mine.appendChild(placeOption(place.nodeId, place.detail ? `${place.label} (${place.detail})` : place.label)));
      groups.push(mine);
    }
    const all = document.createElement('optgroup');
    all.label = 'All places';
    list.forEach((node) => all.appendChild(placeOption(node.nodeId, names.get(node.nodeId))));
    groups.push(all);
    select.replaceChildren(...groups);
    if (current) select.value = current;
  }
}

function saveDestination() {
  const settings = window.WitsPathSettings;
  const nodeId = window.appElements.toSelect.value;
  const label = window.appState.graph.nodes.find((node) => node.nodeId === nodeId)?.label.trim();
  if (!label) return;
  const saved = settings.get('savedPlaces');
  if (saved.some((place) => place.nodeId === nodeId)) {
    showStatus(`${label} is already in your saved places.`, '');
    return;
  }
  settings.set('savedPlaces', [...saved, { nodeId, label, detail: '' }]);
  buildNodeOptions(window.appState.graph.nodes);
  showStatus(`Saved ${label} to your places.`, 'success');
}

// The Android app's "auto-detect" starts from the home base.
function useHomeBase() {
  const home = window.WitsPathSettings.get('homeNodeId');
  if (!window.appState.graph.nodes.some((node) => node.nodeId === home)) {
    showStatus('Set a home base in Saved places first.', 'error');
    return;
  }
  window.appElements.fromSelect.value = home;
  requestRoute();
}

function setDefaultSelection() {
  // Start from the home base when one is set (as the Android app does).
  const home = window.WitsPathSettings.get('homeNodeId');
  const nodes = window.appState.graph.nodes;
  const defaultFrom = nodes.some((node) => node.nodeId === home) ? home : 'nd_mu84hhsut';
  const defaultTo = 'nd_mu842rrrm';
  window.appElements.fromSelect.value = nodes.some((node) => node.nodeId === defaultFrom) ? defaultFrom : nodes[0]?.nodeId || '';
  window.appElements.toSelect.value = nodes.some((node) => node.nodeId === defaultTo) ? defaultTo : nodes[1]?.nodeId || '';
  window.appElements.mapTitle.textContent = 'Select a route';
}

function swapLocations() {
  const currentFromValue = window.appElements.fromSelect.value;
  window.appElements.fromSelect.value = window.appElements.toSelect.value;
  window.appElements.toSelect.value = currentFromValue;
  requestRoute();
}

// ---- mobility modes (the website team's travel-mode buttons) ----------------

// Wheelchair and visual assistance never use stairs.
const STEP_FREE_PROFILES = new Set(['wheelchair', 'low_vision']);

function renderModes() {
  const profile = window.WitsPathSettings.get('mobilityProfile');
  document.querySelectorAll('.mode-button').forEach((button) => {
    const selected = button.dataset.profile === profile;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function setMode(profile) {
  const settings = window.WitsPathSettings;
  settings.set('mobilityProfile', profile);
  settings.set('stepFreeOnly', STEP_FREE_PROFILES.has(profile));
  renderModes();
  requestRoute();
}

// ---- routes ------------------------------------------------------------------------

function clearSummary() {
  window.appElements.estimatedTime.textContent = '—';
  window.appElements.estimatedDistance.textContent = '';
}

// Routes come from the shared WitsPath routing engine (the same A* as the
// Android app) via /api/route. This page never computes a route itself.
let routeRequestId = 0;

async function requestRoute() {
  if (!window.appState.graph) {
    return;
  }

  const fromNodeId = window.appElements.fromSelect.value;
  const toNodeId = window.appElements.toSelect.value;
  if (!fromNodeId || !toNodeId) {
    showStatus('Choose both a start and a destination.', 'error');
    return;
  }
  if (fromNodeId === toNodeId) {
    showStatus('Start and destination are the same place.', 'error');
    clearSummary();
    renderRoute(null);
    return;
  }

  const settings = window.WitsPathSettings;
  const requestId = ++routeRequestId;
  showStatus('Finding a route…', '');
  let response;
  let body;
  try {
    response = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromNodeId,
        toNodeId,
        accessible: settings.get('stepFreeOnly'),
        mobilityProfile: settings.get('mobilityProfile'),
        preferLifts: settings.get('preferLifts'),
        avoidSteepRamps: settings.get('avoidSteepRamps'),
        speedMultiplier: settings.get('walkingSpeed'),
        // Directions follow the interface language; the server uses verified
        // phrases only and falls back to English otherwise.
        lang: settings.uiLanguage()
      })
    });
    body = await response.json();
  } catch {
    if (requestId !== routeRequestId) return;
    showStatus("Can't reach the WitsPath server right now.", 'error');
    clearSummary();
    renderRoute(null);
    return;
  }
  // A newer request (e.g. a quick swap) has replaced this one.
  if (requestId !== routeRequestId) return;

  if (!response.ok) {
    const stepFree = settings.get('stepFreeOnly');
    const message =
      body.error === 'no_route'
        ? stepFree
          ? 'No step-free route is available for that journey.'
          : 'No route could be found between those locations.'
        : body.error === 'route_blocked'
          ? 'Part of that route is reported blocked, and no confirmed alternative is available.'
          : body.error === 'routing_unavailable'
            ? 'Route planning is unavailable right now.'
            : "Couldn't confirm a route right now.";
    showStatus(message, 'error');
    clearSummary();
    renderRoute(null);
    return;
  }

  window.appState.route = body;
  window.appElements.mapTitle.textContent = `${body.from} to ${body.to}`;
  const minutes = body.travelTime?.minutes;
  window.appElements.estimatedTime.textContent = minutes ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '—';
  window.appElements.estimatedDistance.textContent = `(${Math.round(body.distanceM)} metres, estimate)`;
  showStatus('', '');
  renderRoute(body);
}

function loadGraph() {
  fetch('/data/wits-west-map.json')
    .then((response) => {
      if (!response.ok) {
        throw new Error('Could not load campus route data.');
      }
      return response.json();
    })
    .then((data) => {
      window.appState.graph = data;
      const floor = data.floors[0];
      window.appState.floor = floor;
      window.appElements.mapSurface.style.width = `${floor.imageWidth}px`;
      window.appElements.mapSurface.style.height = `${floor.imageHeight}px`;
      window.appElements.routeOverlay.setAttribute('viewBox', `0 0 ${floor.imageWidth} ${floor.imageHeight}`);
      buildNodeOptions(data.nodes);
      setDefaultSelection();
      resetMapView();
      requestRoute();
    })
    .catch((error) => {
      showStatus(error.message, 'error');
      window.appElements.guidanceText.textContent = 'The campus map could not be loaded. Please check routing data and try again.';
      window.appElements.mapTitle.textContent = 'Map unavailable';
    });
}

function wireControls() {
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.profile));
  });
  renderModes();

  window.appElements.fromSelect.addEventListener('change', requestRoute);
  window.appElements.toSelect.addEventListener('change', requestRoute);
  window.appElements.swapButton.addEventListener('click', swapLocations);
  window.appElements.useHomeBase.addEventListener('click', useHomeBase);
  window.appElements.saveDestination.addEventListener('click', saveDestination);
  window.appElements.zoomIn.addEventListener('click', () => zoomMap(1.2));
  window.appElements.zoomOut.addEventListener('click', () => zoomMap(1 / 1.2));
  window.appElements.resetView.addEventListener('click', resetMapView);

  const nextClass = window.WitsPathReminders?.describe();
  const note = document.getElementById('nextClassNote');
  if (nextClass && note) {
    note.textContent = nextClass;
    note.hidden = false;
  }

  window.appElements.mapViewport.addEventListener('wheel', handleMapWheel, { passive: false });
  window.appElements.mapViewport.addEventListener('pointerdown', startMapDrag);
  document.addEventListener('pointermove', moveMapDrag);
  document.addEventListener('pointerup', stopMapDrag);
  document.addEventListener('pointercancel', stopMapDrag);

  window.appElements.mapViewport.addEventListener('keydown', (event) => {
    const step = 30;
    if (event.key === 'ArrowUp') {
      window.appState.mapY += step;
    } else if (event.key === 'ArrowDown') {
      window.appState.mapY -= step;
    } else if (event.key === 'ArrowLeft') {
      window.appState.mapX += step;
    } else if (event.key === 'ArrowRight') {
      window.appState.mapX -= step;
    } else if (event.key === '+' || event.key === '=') {
      zoomMap(1.2);
    } else if (event.key === '-') {
      zoomMap(1 / 1.2);
    } else {
      return;
    }

    event.preventDefault();
    applyMapTransform();
  });

  // Settings changed in another tab (or pulled from the account).
  window.WitsPathSettings.onChange((name) => {
    if (name === 'mobilityProfile' || name === '*') renderModes();
  });
}

wireControls();
loadGraph();
