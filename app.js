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
    if (window.appState.route) {
      requestRoute();
    }
  });

  window.appElements.highContrastToggle.addEventListener('change', (event) => {
    applyContrast(event.target.checked);
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

  window.appElements.routeButton.addEventListener('click', requestRoute);
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

  const storedLanguage = readStorage(STORAGE_KEYS.language, '');
  const storedTextSize = readStorage(STORAGE_KEYS.textSize, 'default');
  const storedContrast = readStorage(STORAGE_KEYS.highContrast, 'false') === 'true';
  const storedStepFree = readStorage(STORAGE_KEYS.stepFreeOnly, 'true') === 'true';

  window.appElements.languageSelect.value = storedLanguage;
  window.appElements.textSizeSelect.value = storedTextSize;
  window.appElements.stepFreeOnly.checked = storedStepFree;
  window.appElements.highContrastToggle.checked = storedContrast;
  applyLanguage(storedLanguage);
  applyTextScale(storedTextSize);
  applyContrast(storedContrast);
}

wireControls();
loadGraph();
