window.appState = {
  graph: null,
  route: null,
  mobilityProfile: 'wheelchair',
  floor: null,
  map: null,
  mapScale: 1,
  mapX: 0,
  mapY: 0,
  minScale: 0.35,
  maxScale: 4
};

window.appElements = {
  fromSelect: document.getElementById('fromSelect'),
  refreshLocation: document.getElementById('refreshLocation'),
  toSelect: document.getElementById('toSelect'),
  routeButton: document.getElementById('routeButton'),
  swapButton: document.getElementById('swapButton'),
  statusMessage: document.getElementById('statusMessage'),
  mapTitle: document.getElementById('mapTitle'),
  estimatedTime: document.getElementById('estimatedTime'),
  estimatedDistance: document.getElementById('estimatedDistance'),
  guidanceText: document.getElementById('guidanceText'),
  stepsList: document.getElementById('stepsList'),
  mapViewport: document.getElementById('mapViewport'),
  mapSurface: document.getElementById('mapSurface'),
  routeOverlay: document.getElementById('routeOverlay'),
  zoomIn: document.getElementById('zoomIn'),
  zoomOut: document.getElementById('zoomOut'),
  resetView: document.getElementById('resetView')
};

const MODE_PROFILES = {
  wheelchair: 'wheelchair',
  'walking-aid': 'walking-aid',
  visual: 'low-vision',
  general: 'no-preference'
};

const PROFILE_MODES = Object.fromEntries(
  Object.entries(MODE_PROFILES).map(([mode, profile]) => [profile, mode])
);

const PROFILE_SPEEDS = {
  wheelchair: 0.8,
  'walking-aid': 1.1,
  'low-vision': 1.1,
  'no-preference': 1.73
};

function updateScreenReaderDescriptions(enabled) {
  document.querySelectorAll('.mode-button').forEach((button) => {
    if (enabled) {
      button.setAttribute('aria-describedby', 'modeAccessibilityDescription');
    } else {
      button.removeAttribute('aria-describedby');
    }
  });
}

function setActiveMode(mode, persist = true) {
  const profile = MODE_PROFILES[mode];
  if (!profile) {
    return;
  }

  document.querySelectorAll('.mode-button').forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  window.appState.mobilityProfile = profile;
  if (persist) {
    setStorage(STORAGE_KEYS.mobilityProfile, profile);
  }
}

function showStatus(message, type) {
  window.appElements.statusMessage.textContent = message;
  window.appElements.statusMessage.className = `status-message ${type}`;
}

function detectCurrentLocation() {
  if (!navigator.geolocation) {
    showStatus('Location detection is not supported by this browser.', 'error');
    return;
  }

  window.appElements.refreshLocation.disabled = true;
  window.appElements.refreshLocation.setAttribute('aria-busy', 'true');
  showStatus('Detecting your current location…', '');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      window.appState.currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        detectedAt: position.timestamp
      };
      window.appElements.refreshLocation.disabled = false;
      window.appElements.refreshLocation.removeAttribute('aria-busy');
      showStatus('Location detected. Choose a campus start location to plan your route.', 'success');
    },
    (error) => {
      window.appElements.refreshLocation.disabled = false;
      window.appElements.refreshLocation.removeAttribute('aria-busy');
      const message = error.code === error.PERMISSION_DENIED
        ? 'Location permission was denied.'
        : 'Current location could not be detected. Try again.';
      showStatus(message, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function buildNodeOptions(nodes) {
  const list = nodes
    .filter((node) => node && node.label)
    .sort((a, b) => a.label.localeCompare(b.label));

  const html = list
    .map((node) => `<option value="${node.nodeId}">${node.label}</option>`)
    .join('');

  window.appElements.fromSelect.innerHTML = html;
  window.appElements.toSelect.innerHTML = html;
}

function setDefaultSelection() {
  const defaultFrom = 'nd_mu84hhsut';
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

function requestRoute() {
  if (!window.appState.graph) {
    return;
  }

  const fromNodeId = window.appElements.fromSelect.value;
  const toNodeId = window.appElements.toSelect.value;

  if (!fromNodeId || !toNodeId) {
    showStatus('Choose both a start and a destination.', 'error');
    return;
  }

  const fromNode = findNode(fromNodeId);
  const toNode = findNode(toNodeId);

  if (!fromNode || !toNode) {
    showStatus('One of the selected locations is invalid.', 'error');
    return;
  }

  const requireStepFree = readBooleanSetting(STORAGE_KEYS.stepFreeOnly, true);
  const mobilityProfile = window.appState.mobilityProfile;
  const distanceDisplay = readStorage(STORAGE_KEYS.distanceDisplay, 'meters');
  window.appElements.estimatedDistance.hidden = distanceDisplay === 'minutes';
  const route = solveRoute(fromNode, toNode, mobilityProfile, requireStepFree);

  if (!route || route.length < 2) {
    window.appState.route = null;
    window.appState.navigationStarted = false;
    window.appElements.routeButton.querySelector('span').textContent = 'Start Navigation';
    const detail = requireStepFree
      ? 'No step-free route is available for that journey.'
      : 'No route could be found between those locations.';
    showStatus(detail, 'error');
    renderRoute(null);
    return;
  }

  window.appState.route = route;
  const totalDistance = route.reduce((sum, node, index) => {
    if (index === 0) return sum;
    const previousNode = route[index - 1];
    return sum + computeDistance(previousNode, node, true);
  }, 0);

  const routeLabel = `${fromNode.label || fromNode.nodeId} to ${toNode.label || toNode.nodeId}`;
  window.appElements.mapTitle.textContent = routeLabel;
  const speed = PROFILE_SPEEDS[mobilityProfile] || PROFILE_SPEEDS['no-preference'];
  const estimatedMinutes = Math.max(1, Math.round(totalDistance / speed / 60));
  window.appElements.estimatedTime.textContent = `${estimatedMinutes} min`;
  window.appElements.estimatedDistance.textContent = `(${formatRouteDistance(totalDistance, distanceDisplay, mobilityProfile)})`;
  showStatus(`Route ready • ${Math.round(totalDistance)} m`, 'success');
  renderRoute(route);
}

function loadGraph() {
  fetch('data/wits-west-map.json')
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
      if (readBooleanSetting(STORAGE_KEYS.autoDetectLocation)) {
        detectCurrentLocation();
      }
    })
    .catch((error) => {
      showStatus(error.message, 'error');
      window.appElements.guidanceText.textContent = 'The campus map could not be loaded. Please check routing data and try again.';
      window.appElements.mapTitle.textContent = 'Map unavailable';
    });
}

function wireControls() {
  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      setActiveMode(mode);
      const requiresStepFree = mode === 'wheelchair' || mode === 'visual';
      setStorage(STORAGE_KEYS.stepFreeOnly, String(requiresStepFree));
      if (window.appState.route) {
        requestRoute();
      }
    });
  });

  window.appElements.swapButton.addEventListener('click', swapLocations);
  window.appElements.refreshLocation.addEventListener('click', detectCurrentLocation);
  window.appElements.routeButton.addEventListener('click', () => {
    if (window.appState.navigationStarted) {
      window.appState.navigationStarted = false;
      window.appElements.routeButton.querySelector('span').textContent = 'Start Navigation';
      renderRoute(window.appState.route);
      showStatus('Navigation ended.', '');
      return;
    }

    requestRoute();
    if (window.appElements.statusMessage.classList.contains('error')) {
      return;
    }

    window.appState.navigationStarted = true;
    window.appElements.routeButton.querySelector('span').textContent = 'End Navigation';
    if (readBooleanSetting(STORAGE_KEYS.vibrationCues) && navigator.vibrate) {
      navigator.vibrate(120);
    }
    if (readBooleanSetting(STORAGE_KEYS.voiceGuidance) && 'speechSynthesis' in window) {
      const from = findNode(window.appElements.fromSelect.value);
      const to = findNode(window.appElements.toSelect.value);
      const utterance = new SpeechSynthesisUtterance(`Navigation started. Route from ${from?.label || 'start'} to ${to?.label || 'destination'}.`);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
    renderRoute(window.appState.route);
    showStatus('Navigation started • Follow the steps.', 'success');
  });
  window.appElements.zoomIn.addEventListener('click', () => zoomMap(1.2));
  window.appElements.zoomOut.addEventListener('click', () => zoomMap(1 / 1.2));
  window.appElements.resetView.addEventListener('click', resetMapView);
  window.addEventListener('resize', resetMapView);

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

  const storedLanguage = readStorage(STORAGE_KEYS.language, '');
  const storedTextSize = readStorage(STORAGE_KEYS.textSize, 'default');
  const storedContrast = readStorage(STORAGE_KEYS.highContrast, 'false') === 'true';
  const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const storedDarkMode = readStorage(STORAGE_KEYS.darkMode, String(prefersDarkMode)) === 'true';
  const storedStepFree = readBooleanSetting(STORAGE_KEYS.stepFreeOnly, true);
  const storedProfile = readStorage(STORAGE_KEYS.mobilityProfile, '');
  const storedMode = PROFILE_MODES[storedProfile] || (storedStepFree ? 'wheelchair' : 'general');

  setActiveMode(storedMode);
  applyLanguage(storedLanguage);
  applyTextScale(storedTextSize);
  applyDarkMode(storedDarkMode);
  applyContrast(storedContrast);
  const screenReaderDescriptions = readBooleanSetting(STORAGE_KEYS.screenReaderDescriptions);
  document.body.dataset.screenReaderDescriptions = String(screenReaderDescriptions);
  updateScreenReaderDescriptions(screenReaderDescriptions);
  document.body.dataset.visualAssistance = String(readBooleanSetting(STORAGE_KEYS.visualAssistance));
}

wireControls();
loadGraph();

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEYS.darkMode) applyDarkMode(event.newValue === 'true', false);
  if (event.key === STORAGE_KEYS.highContrast) applyContrast(event.newValue === 'true', false);
  if (event.key === STORAGE_KEYS.textSize) applyTextScale(event.newValue || 'default', false);
  if (event.key === STORAGE_KEYS.language) applyLanguage(event.newValue || '', false);
  if (event.key === STORAGE_KEYS.screenReaderDescriptions) {
    const enabled = event.newValue === 'true';
    document.body.dataset.screenReaderDescriptions = String(enabled);
    updateScreenReaderDescriptions(enabled);
  }
  if (event.key === STORAGE_KEYS.mobilityProfile) {
    const mode = PROFILE_MODES[event.newValue];
    if (mode) {
      setActiveMode(mode, false);
      requestRoute();
    }
  }
  if ([STORAGE_KEYS.stepFreeOnly, STORAGE_KEYS.preferLifts, STORAGE_KEYS.avoidSteepRamps, STORAGE_KEYS.distanceDisplay, STORAGE_KEYS.showFlaggedPaths, STORAGE_KEYS.reports].includes(event.key)) {
    requestRoute();
  }
});
