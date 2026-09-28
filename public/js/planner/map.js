const SVG_NS = 'http://www.w3.org/2000/svg';

function svgCircle(point, className) {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', point.x);
  circle.setAttribute('cy', point.y);
  circle.setAttribute('r', 8);
  circle.setAttribute('class', className);
  return circle;
}

/**
 * Draw a route card from /api/route: the line on the campus map (points are
 * in map pixels) and the verified turn-by-turn steps.
 */
function renderRoute(card) {
  const svg = window.appElements.routeOverlay;
  svg.replaceChildren();

  if (!card || !card.points || card.points.length < 2) {
    window.appElements.guidanceText.textContent = 'Choose a destination to see your route.';
    window.appElements.stepsList.replaceChildren();
    window.appElements.stepsList.hidden = true;
    window.WitsPathNavigation?.setRoute(null);
    window.WitsPathReport?.setRoute(null);
    return;
  }

  const polyline = document.createElementNS(SVG_NS, 'polyline');
  polyline.setAttribute('points', card.points.map((point) => `${point.x},${point.y}`).join(' '));
  svg.append(polyline, svgCircle(card.points[0], 'route-start'), svgCircle(card.points[card.points.length - 1], 'route-end'));

  // Time and distance are in the summary card; the steps appear with Start Navigation.
  window.appElements.guidanceText.textContent =
    `Route ready: ${card.accessible ? 'step-free' : 'not confirmed step-free'}. ` +
    'Press Start Navigation for step-by-step directions.';

  window.appElements.stepsList.replaceChildren(
    ...card.steps.map((step, index) => {
      const li = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'step-index';
      number.textContent = String(index + 1);
      const copy = document.createElement('div');
      copy.className = 'step-copy';
      const text = document.createElement('strong');
      text.textContent = step.text;
      text.lang = step.lang;
      copy.appendChild(text);
      li.append(number, copy);
      return li;
    })
  );
  window.WitsPathNavigation?.setRoute(card);
  window.WitsPathReport?.setRoute(card);
}

/** "You are here" marker for step-by-step navigation; null removes it. */
function setCurrentMarker(point) {
  window.appElements.routeOverlay.querySelector('.route-current')?.remove();
  if (point) window.appElements.routeOverlay.appendChild(svgCircle(point, 'route-current'));
}

/** Zoom in (at least 2x) and pan so the point is in the middle of the map. */
function centerMapOn(point) {
  const viewport = window.appElements.mapViewport;
  window.appState.mapScale = Math.max(window.appState.mapScale, 2);
  window.appState.mapX = viewport.clientWidth / 2 - point.x * window.appState.mapScale;
  window.appState.mapY = viewport.clientHeight / 2 - point.y * window.appState.mapScale;
  applyMapTransform();
}

function resetMapView() {
  window.appState.mapScale = 1;
  window.appState.mapX = 0;
  window.appState.mapY = 0;
  applyMapTransform();
}

function applyMapTransform() {
  const scale = Math.min(Math.max(window.appState.mapScale, window.appState.minScale), window.appState.maxScale);
  const viewportWidth = window.appElements.mapViewport.clientWidth;
  const viewportHeight = window.appElements.mapViewport.clientHeight;
  const surfaceWidth = window.appState.floor ? window.appState.floor.imageWidth : 647;
  const surfaceHeight = window.appState.floor ? window.appState.floor.imageHeight : 717;
  const x = Math.min(0, Math.max(window.appState.mapX, viewportWidth - surfaceWidth * scale));
  const y = Math.min(0, Math.max(window.appState.mapY, viewportHeight - surfaceHeight * scale));
  window.appState.mapX = x;
  window.appState.mapY = y;
  window.appElements.mapSurface.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function zoomMap(factor) {
  window.appState.mapScale = Math.min(
    Math.max(window.appState.mapScale * factor, window.appState.minScale),
    window.appState.maxScale
  );
  applyMapTransform();
}

function handleMapWheel(event) {
  event.preventDefault();
  const direction = event.deltaY > 0 ? 1 / 1.1 : 1.1;
  zoomMap(direction);
}

let dragState = null;

function startMapDrag(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  dragState = {
    startX: event.clientX,
    startY: event.clientY,
    originX: window.appState.mapX,
    originY: window.appState.mapY
  };
  window.appElements.mapViewport.setPointerCapture(event.pointerId);
}

function moveMapDrag(event) {
  if (!dragState) {
    return;
  }

  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  window.appState.mapX = dragState.originX + dx;
  window.appState.mapY = dragState.originY + dy;
  applyMapTransform();
}

function stopMapDrag(event) {
  if (!dragState) {
    return;
  }

  dragState = null;
  if (event?.pointerId !== undefined) {
    window.appElements.mapViewport.releasePointerCapture(event.pointerId);
  }
}
