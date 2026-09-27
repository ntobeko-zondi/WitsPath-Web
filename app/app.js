<<<<<<< HEAD
window.appState = {
  graph: null,
  route: null,
  floor: null,
  map: null,
  mapScale: 1,
  mapX: 0,
  mapY: 0,
  minScale: 0.35,
  maxScale: 4
};

window.appElements = {
  languageSelect: document.getElementById('languageSelect'),
  textSizeSelect: document.getElementById('textSizeSelect'),
  stepFreeOnly: document.getElementById('stepFreeOnly'),
  highContrastToggle: document.getElementById('highContrastToggle'),
  darkModeCheckbox: document.getElementById('darkModeCheckbox'),
  fromSelect: document.getElementById('fromSelect'),
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
  resetView: document.getElementById('resetView'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  navToggle: document.getElementById('navToggle'),
  closeDrawer: document.getElementById('closeDrawer'),
  languageButton: document.getElementById('languageButton'),
  contrastToggle: document.getElementById('contrastToggle'),
  darkModeToggle: document.getElementById('darkModeToggle')
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

  const requireAccessible = window.appElements.stepFreeOnly.checked;
  const route = solveRoute(fromNode, toNode, requireAccessible);

  if (!route || route.length < 2) {
    window.appState.route = null;
    window.appState.navigationStarted = false;
    window.appElements.routeButton.querySelector('span').textContent = 'Start Navigation';
    const detail = requireAccessible
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
  window.appElements.estimatedTime.textContent = `${Math.max(1, Math.ceil(totalDistance / 65))} min`;
  window.appElements.estimatedDistance.textContent = `(${Math.round(totalDistance)} m)`;
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
    })
    .catch((error) => {
      showStatus(error.message, 'error');
      window.appElements.guidanceText.textContent = 'The campus map could not be loaded. Please check routing data and try again.';
      window.appElements.mapTitle.textContent = 'Map unavailable';
    });
}

function wireControls() {
  Object.entries(LANGUAGES).forEach(([tag, label]) => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = label;
    window.appElements.languageSelect.appendChild(option);
  });

  window.appElements.languageSelect.addEventListener('change', (event) => {
    applyLanguage(event.target.value);
  });

  window.appElements.textSizeSelect.addEventListener('change', (event) => {
    applyTextScale(event.target.value);
  });

  window.appElements.stepFreeOnly.addEventListener('change', (event) => {
    setStorage(STORAGE_KEYS.stepFreeOnly, String(event.target.checked));
    const activeMode = event.target.checked ? 'wheelchair' : 'general';
    document.querySelectorAll('.mode-button').forEach((button) => {
      const selected = button.dataset.mode === activeMode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (window.appState.route) {
      requestRoute();
    }
  });

  window.appElements.highContrastToggle.addEventListener('change', (event) => {
    applyContrast(event.target.checked);
  });

  window.appElements.darkModeCheckbox.addEventListener('change', (event) => {
    applyDarkMode(event.target.checked);
  });

  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      document.querySelectorAll('.mode-button').forEach((modeButton) => {
        const selected = modeButton === button;
        modeButton.classList.toggle('is-selected', selected);
        modeButton.setAttribute('aria-pressed', String(selected));
      });
      const requiresStepFree = mode !== 'general';
      window.appElements.stepFreeOnly.checked = requiresStepFree;
      setStorage(STORAGE_KEYS.stepFreeOnly, String(requiresStepFree));
      if (window.appState.route) {
        requestRoute();
      }
    });
  });

  window.appElements.navToggle.addEventListener('click', () => openDrawer());
  window.appElements.closeDrawer.addEventListener('click', () => closeDrawer());
  window.appElements.drawerBackdrop.addEventListener('click', () => closeDrawer());
  window.appElements.languageButton.addEventListener('click', () => openDrawer());
  window.appElements.contrastToggle.addEventListener('click', () => {
    const nextValue = !(document.body.dataset.contrast === 'true');
    window.appElements.highContrastToggle.checked = nextValue;
    applyContrast(nextValue);
  });
  window.appElements.darkModeToggle.addEventListener('click', () => {
    applyDarkMode(document.body.dataset.theme !== 'dark');
  });

  window.appElements.swapButton.addEventListener('click', swapLocations);
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
  const storedStepFree = readStorage(STORAGE_KEYS.stepFreeOnly, 'true') === 'true';

  window.appElements.languageSelect.value = storedLanguage;
  window.appElements.textSizeSelect.value = storedTextSize;
  window.appElements.stepFreeOnly.checked = storedStepFree;
  window.appElements.highContrastToggle.checked = storedContrast;
  applyLanguage(storedLanguage);
  applyTextScale(storedTextSize);
  applyDarkMode(storedDarkMode);
  applyContrast(storedContrast);
}

wireControls();
loadGraph();
=======
window.appState = {
  graph: null,
  route: null,
  floor: null,
  map: null,
  mapScale: 1,
  mapX: 0,
  mapY: 0,
  minScale: 0.35,
  maxScale: 4
};

window.appElements = {
  languageSelect: document.getElementById('languageSelect'),
  textSizeSelect: document.getElementById('textSizeSelect'),
  stepFreeOnly: document.getElementById('stepFreeOnly'),
  highContrastToggle: document.getElementById('highContrastToggle'),
  darkModeCheckbox: document.getElementById('darkModeCheckbox'),
  fromSelect: document.getElementById('fromSelect'),
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
  resetView: document.getElementById('resetView'),
  settingsDrawer: document.getElementById('settingsDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  navToggle: document.getElementById('navToggle'),
  closeDrawer: document.getElementById('closeDrawer'),
  languageButton: document.getElementById('languageButton'),
  contrastToggle: document.getElementById('contrastToggle'),
  darkModeToggle: document.getElementById('darkModeToggle')
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

  const requireAccessible = window.appElements.stepFreeOnly.checked;
  const route = solveRoute(fromNode, toNode, requireAccessible);

  if (!route || route.length < 2) {
    window.appState.route = null;
    window.appState.navigationStarted = false;
    window.appElements.routeButton.querySelector('span').textContent = 'Start Navigation';
    const detail = requireAccessible
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
  window.appElements.estimatedTime.textContent = `${Math.max(1, Math.ceil(totalDistance / 65))} min`;
  window.appElements.estimatedDistance.textContent = `(${Math.round(totalDistance)} m)`;
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
    })
    .catch((error) => {
      showStatus(error.message, 'error');
      window.appElements.guidanceText.textContent = 'The campus map could not be loaded. Please check routing data and try again.';
      window.appElements.mapTitle.textContent = 'Map unavailable';
    });
}

function wireControls() {
  Object.entries(LANGUAGES).forEach(([tag, label]) => {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = label;
    window.appElements.languageSelect.appendChild(option);
  });

  window.appElements.languageSelect.addEventListener('change', (event) => {
    applyLanguage(event.target.value);
  });

  window.appElements.textSizeSelect.addEventListener('change', (event) => {
    applyTextScale(event.target.value);
  });

  window.appElements.stepFreeOnly.addEventListener('change', (event) => {
    setStorage(STORAGE_KEYS.stepFreeOnly, String(event.target.checked));
    const activeMode = event.target.checked ? 'wheelchair' : 'general';
    document.querySelectorAll('.mode-button').forEach((button) => {
      const selected = button.dataset.mode === activeMode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (window.appState.route) {
      requestRoute();
    }
  });

  window.appElements.highContrastToggle.addEventListener('change', (event) => {
    applyContrast(event.target.checked);
  });

  window.appElements.darkModeCheckbox.addEventListener('change', (event) => {
    applyDarkMode(event.target.checked);
  });

  document.querySelectorAll('.mode-button').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      document.querySelectorAll('.mode-button').forEach((modeButton) => {
        const selected = modeButton === button;
        modeButton.classList.toggle('is-selected', selected);
        modeButton.setAttribute('aria-pressed', String(selected));
      });
      const requiresStepFree = mode !== 'general';
      window.appElements.stepFreeOnly.checked = requiresStepFree;
      setStorage(STORAGE_KEYS.stepFreeOnly, String(requiresStepFree));
      if (window.appState.route) {
        requestRoute();
      }
    });
  });

  window.appElements.navToggle.addEventListener('click', () => openDrawer());
  window.appElements.closeDrawer.addEventListener('click', () => closeDrawer());
  window.appElements.drawerBackdrop.addEventListener('click', () => closeDrawer());
  window.appElements.languageButton.addEventListener('click', () => openDrawer());
  window.appElements.contrastToggle.addEventListener('click', () => {
    const nextValue = !(document.body.dataset.contrast === 'true');
    window.appElements.highContrastToggle.checked = nextValue;
    applyContrast(nextValue);
  });
  window.appElements.darkModeToggle.addEventListener('click', () => {
    applyDarkMode(document.body.dataset.theme !== 'dark');
  });

  window.appElements.swapButton.addEventListener('click', swapLocations);
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
  const storedStepFree = readStorage(STORAGE_KEYS.stepFreeOnly, 'true') === 'true';

  window.appElements.languageSelect.value = storedLanguage;
  window.appElements.textSizeSelect.value = storedTextSize;
  window.appElements.stepFreeOnly.checked = storedStepFree;
  window.appElements.highContrastToggle.checked = storedContrast;
  applyLanguage(storedLanguage);
  applyTextScale(storedTextSize);
  applyDarkMode(storedDarkMode);
  applyContrast(storedContrast);
}

wireControls();
loadGraph();
>>>>>>> 0d20464a2253b7892412f13760e51bcbb4ea5fbd
