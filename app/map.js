function renderRoute(route) {
  const svg = window.appElements.routeOverlay;
  svg.innerHTML = '';

  if (!route || route.length < 2) {
    window.appElements.guidanceText.textContent = 'Choose your start and destination to begin.';
    window.appElements.stepsList.innerHTML = '';
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
        subtitle: 'Destination reached',
        index: index + 1
      };
    }

    const nextNode = route[index + 1];
    const distance = computeDistance(node, nextNode, true);
    return {
      title: `Walk ${Math.round(distance)}m to ${nextNode.label || nextNode.nodeId}`,
      subtitle: node.label || node.nodeId,
      index: index + 1
    };
  });

  window.appElements.guidanceText.textContent = `Total route length: ${Math.round(totalDistance)}m`;
  window.appElements.stepsList.innerHTML = stepDetails
    .map(
      (step) => `
        <li>
          <span class="step-index">${step.index}</span>
          <div class="step-copy">
            <strong>${step.title}</strong>
            <small>${step.subtitle}</small>
          </div>
        </li>
      `
    )
    .join('');
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
