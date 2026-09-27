function renderRoute(route) {
  const svg = window.appElements.routeOverlay;
  svg.innerHTML = '';

  if (!route || route.length < 2) {
    window.appState.navigationStarted = false;
    window.appElements.guidanceText.textContent = 'Choose your start and destination to begin.';
    window.appElements.guidanceText.classList.remove('visually-hidden');
    window.appElements.stepsList.innerHTML = '';
    window.appElements.stepsList.hidden = true;
    window.appElements.estimatedTime.textContent = '—';
    window.appElements.estimatedDistance.textContent = '';
    return;
  }

  const points = route
    .map((node) => {
      const pixel = toFloorPixels(node);
      return `${pixel.x},${pixel.y}`;
    })
    .join(' ');

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points);
  svg.appendChild(polyline);

  const startPoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const endPoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const startPixel = toFloorPixels(route[0]);
  const endPixel = toFloorPixels(route[route.length - 1]);

  startPoint.setAttribute('cx', startPixel.x);
  startPoint.setAttribute('cy', startPixel.y);
  startPoint.setAttribute('r', 8);
  startPoint.setAttribute('class', 'route-start');

  endPoint.setAttribute('cx', endPixel.x);
  endPoint.setAttribute('cy', endPixel.y);
  endPoint.setAttribute('r', 8);
  endPoint.setAttribute('class', 'route-end');

  svg.appendChild(startPoint);
  svg.appendChild(endPoint);

  const totalDistance = route.reduce((sum, node, index) => {
    if (index === 0) return sum;
    const previousNode = route[index - 1];
    return sum + computeDistance(previousNode, node, true);
  }, 0);

  const stepDetails = route.map((node, index) => {
    if (index === route.length - 1) {
      return {
        title: `Arrive at ${node.label || node.nodeId}`,
        subtitle: 'Main entrance',
        index: index + 1,
        isArrival: true
      };
    }

    const nextNode = route[index + 1];
    const distance = computeDistance(node, nextNode, true);
    return {
      title: `Continue for ${Math.round(distance)} m`,
      subtitle: `Follow the accessible path toward ${nextNode.label || nextNode.nodeId}`,
      index: index + 1,
      isArrival: false
    };
  });

  window.appElements.guidanceText.textContent = `Total route length: ${Math.round(totalDistance)}m`;
  const navigationStarted = window.appState.navigationStarted;
  window.appElements.stepsList.hidden = !navigationStarted;
  window.appElements.guidanceText.classList.toggle('visually-hidden', navigationStarted);
  window.appElements.guidanceText.textContent = navigationStarted
    ? `Total route length: ${Math.round(totalDistance)}m`
    : 'Route ready. Press Start Navigation to see step-by-step directions.';
  window.appElements.stepsList.innerHTML = navigationStarted
    ? stepDetails
        .map(
          (step) => `
        <li>
          <span class="step-index">${step.index}</span>
          <span class="step-icon" aria-hidden="true">
            ${
              step.isArrival
                ? '<svg viewBox="0 0 24 24"><path d="M6 21V4m0 1h12l-3 4 3 4H6" /></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M12 21V4m-7 7 7-7 7 7" /></svg>'
            }
          </span>
          <div class="step-copy">
            <strong>${step.title}</strong>
            <small>${step.subtitle}</small>
          </div>
        </li>
      `
        )
        .join('')
    : '';
}

function resetMapView() {
  const viewportWidth = window.appElements.mapViewport.clientWidth;
  const viewportHeight = window.appElements.mapViewport.clientHeight;
  const surfaceWidth = window.appElements.mapSurface.offsetWidth || 647;
  const surfaceHeight = window.appElements.mapSurface.offsetHeight || 717;
  window.appState.mapScale = Math.min(
    viewportWidth / surfaceWidth,
    viewportHeight / surfaceHeight,
    window.appState.maxScale
  );
  window.appState.mapX = 0;
  window.appState.mapY = 0;
  applyMapTransform();
}

function applyMapTransform() {
  const scale = Math.min(Math.max(window.appState.mapScale, window.appState.minScale), window.appState.maxScale);
  const viewportWidth = window.appElements.mapViewport.clientWidth;
  const viewportHeight = window.appElements.mapViewport.clientHeight;
  const surfaceWidth = window.appElements.mapSurface.offsetWidth || 647;
  const surfaceHeight = window.appElements.mapSurface.offsetHeight || 717;
  const scaledWidth = surfaceWidth * scale;
  const scaledHeight = surfaceHeight * scale;
  const x = scaledWidth <= viewportWidth
    ? (viewportWidth - scaledWidth) / 2
    : Math.min(0, Math.max(window.appState.mapX, viewportWidth - scaledWidth));
  const y = scaledHeight <= viewportHeight
    ? (viewportHeight - scaledHeight) / 2
    : Math.min(0, Math.max(window.appState.mapY, viewportHeight - scaledHeight));
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
