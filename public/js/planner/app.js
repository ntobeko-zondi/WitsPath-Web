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
  languageSelect: document.getElementById('languageSelect'),
  textSizeSelect: document.getElementById('textSizeSelect'),
  stepFreeOnly: document.getElementById('stepFreeOnly'),
  highContrastToggle: document.getElementById('highContrastToggle'),
  fromSelect: document.getElementById('fromSelect'),
  toSelect: document.getElementById('toSelect'),
  routeButton: document.getElementById('routeButton'),
  swapButton: document.getElementById('swapButton'),
  statusMessage: document.getElementById('statusMessage'),
  mapTitle: document.getElementById('mapTitle'),
  guidanceText: document.getElementById('guidanceText'),
  stepsList: document.getElementById('stepsList'),
  mapViewport: document.getElementById('mapViewport'),
  mapSurface: document.getElementById('mapSurface'),
  routeOverlay: document.getElementById('routeOverlay'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  resetView: document.getElementById('resetView'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  navToggle: document.getElementById('navToggle'),
  closeDrawer: document.getElementById('closeDrawer'),
  languageButton: document.getElementById('languageButton'),
  contrastToggle: document.getElementById('contrastToggle')
};

function openDrawer() {
  window.appElements.settingsDrawer.classList.add('open');
  window.appElements.drawerBackdrop.hidden = false;
}

function closeDrawer() {
  window.appElements.settingsDrawer.classList.remove('open');
  window.appElements.drawerBackdrop.hidden = true;
}

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
// named place. Unnamed junctions ("node" type) are waypoints, not destinations.
function buildNodeOptions(nodes) {
  const list = nodes
    .filter((node) => node && node.label && node.type !== 'node')
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

function setDefaultSelection() {
  // Start from the home base when one is set (as the Android app does).
  const home = window.WitsPathSettings.get('homeNodeId');
  const defaultFrom = window.appState.graph.nodes.some((node) => node.nodeId === home) ? home : 'nd_mu84hhsut';
  const defaultTo = 'nd_mu842rrrm';
  const fromValue = window.appState.graph.nodes.some((node) => node.nodeId === defaultFrom)
    ? defaultFrom
    : window.appState.graph.nodes[0]?.nodeId || '';
  const toValue = window.appState.graph.nodes.some((node) => node.nodeId === defaultTo)
    ? defaultTo
    : window.appState.graph.nodes[1]?.nodeId || '';
  window.appElements.fromSelect.value = fromValue;
  window.appElements.toSelect.value = toValue;
  window.appElements.mapTitle.textContent = 'Select a route';
}

function swapLocations() {
  const currentFromValue = window.appElements.fromSelect.value;
  window.appElements.fromSelect.value = window.appElements.toSelect.value;
  window.appElements.toSelect.value = currentFromValue;
  requestRoute();
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
    renderRoute(null);
    return;
  }

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
        accessible: window.appElements.stepFreeOnly.checked,
        lang: window.WitsPathSettings?.get('language') || document.documentElement.lang,
        speedMultiplier: window.WitsPathSettings?.get('walkingSpeed')
      })
    });
    body = await response.json();
  } catch {
    if (requestId !== routeRequestId) return;
    showStatus("Can't reach the WitsPath server right now.", 'error');
    renderRoute(null);
    return;
  }
  // A newer request (e.g. a quick swap) has replaced this one.
  if (requestId !== routeRequestId) return;

  if (!response.ok) {
    const stepFree = window.appElements.stepFreeOnly.checked;
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
    renderRoute(null);
    return;
  }

  window.appState.route = body;
  window.appElements.mapTitle.textContent = `${body.from} to ${body.to}`;
  showStatus(`Route ready • ${Math.round(body.distanceM)} metres`, 'success');
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

// Reflect the shared settings (settings.js) in the drawer's quick controls.
function syncControls() {
  const settings = window.WitsPathSettings;
  window.appElements.languageSelect.value = settings.get('language');
  window.appElements.textSizeSelect.value = settings.get('textSize');
  window.appElements.stepFreeOnly.checked = settings.get('stepFreeOnly');
  window.appElements.highContrastToggle.checked = settings.get('highContrast');
  const language = settings.LANGUAGES.find((lang) => lang.tag === settings.get('language'));
  window.appElements.languageButton.textContent = language && language.tag ? language.name : 'Language';
}

function wireControls() {
  const settings = window.WitsPathSettings;
  settings.LANGUAGES.forEach(({ tag, name }) => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = name;
    if (tag) option.lang = tag;
    window.appElements.languageSelect.appendChild(option);
  });

  window.appElements.languageSelect.addEventListener('change', (event) => settings.set('language', event.target.value));
  window.appElements.textSizeSelect.addEventListener('change', (event) => settings.set('textSize', event.target.value));
  window.appElements.highContrastToggle.addEventListener('change', (event) => settings.set('highContrast', event.target.checked));
  window.appElements.stepFreeOnly.addEventListener('change', (event) => {
    settings.set('stepFreeOnly', event.target.checked);
    if (window.appState.route) {
      requestRoute();
    }
  });
  settings.onChange(syncControls);

  window.appElements.navToggle.addEventListener('click', () => openDrawer());
  window.appElements.closeDrawer.addEventListener('click', () => closeDrawer());
  window.appElements.drawerBackdrop.addEventListener('click', () => closeDrawer());
  window.appElements.languageButton.addEventListener('click', () => openDrawer());
  window.appElements.contrastToggle.addEventListener('click', () => {
    settings.set('highContrast', !settings.get('highContrast'));
  });

  window.appElements.routeButton.addEventListener('click', requestRoute);
  document.getElementById('saveDestination').addEventListener('click', saveDestination);
  const nextClass = window.WitsPathReminders?.describe();
  const note = document.getElementById('nextClassNote');
  if (nextClass && note) {
    note.textContent = nextClass;
    note.hidden = false;
  }
  window.appElements.swapButton.addEventListener('click', swapLocations);
  window.appElements.zoomIn.addEventListener('click', () => zoomMap(1.2));
  window.appElements.zoomOut.addEventListener('click', () => zoomMap(1 / 1.2));
  window.appElements.resetView.addEventListener('click', resetMapView);

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

  syncControls();
}

wireControls();
loadGraph();
