// WitsPath map adapter.
//
// Pages talk to this small interface only, never to a map library directly,
// so the provider can change without touching them:
//
//   const map = WitsPathMap.create(container, { center: {lat, lng}, zoom, label })
//   map.setMarker(id, {lat, lng}, { label, kind: 'destination' | 'person' | 'place' | 'draft', draggable, onDragEnd })
//   map.removeMarker(id)
//   map.setAccuracy(id, {lat, lng}, radiusMetres)   // null position removes it
//   map.fitTo([{lat, lng}, ...])
//   map.setView({lat, lng}, zoom)
//   map.onClick(({lat, lng}) => ...)
//
// Current provider: OpenStreetMap tiles through Leaflet (vendor/leaflet-1.9.4).
// OSM's public tile server is fine for development and light use but has a
// usage policy (https://operations.osmfoundation.org/policies/tiles/); for
// production traffic, point TILE_URL at a tile provider or switch provider.
//
// Adding Google Maps later: load the Maps JavaScript API with a key that is
// restricted to your site's domains, implement the same methods in a
// createGoogleMap() below using google.maps.Map / AdvancedMarkerElement /
// Circle, and select it with window.WITSPATH_MAP_PROVIDER = 'google'.
(function () {
  'use strict';

  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const COLORS = { person: '#195394', place: '#4d5d73', draft: '#b35c00' };

  // Leaflet renders string tooltip content as HTML. Labels include names typed
  // by users (e.g. a trip sender's display name), so always pass a text node.
  function textElement(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  function createLeafletMap(container, options) {
    const L = window.L;
    L.Icon.Default.imagePath = '/vendor/leaflet-1.9.4/images/';
    const map = L.map(container, { keyboard: true }).setView([options.center.lat, options.center.lng], options.zoom || 16);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    container.setAttribute('aria-label', options.label || 'Map');
    container.setAttribute('role', 'region');

    const markers = new Map();
    const circles = new Map();

    return {
      setMarker(id, position, { label = '', kind = 'place', draggable = false, onDragEnd } = {}) {
        const latLng = [position.lat, position.lng];
        let marker = markers.get(id);
        if (marker) {
          marker.setLatLng(latLng);
          if (label) marker.setTooltipContent(textElement(label));
          return;
        }
        if (kind === 'destination' || kind === 'draft') {
          marker = L.marker(latLng, { draggable, keyboard: true, title: label, alt: label });
        } else {
          marker = L.circleMarker(latLng, { radius: kind === 'person' ? 9 : 7, color: '#ffffff', weight: 3, fillColor: COLORS[kind], fillOpacity: 1 });
        }
        if (label) marker.bindTooltip(textElement(label), { direction: 'top', offset: [0, kind === 'destination' || kind === 'draft' ? -30 : -8] });
        if (draggable && onDragEnd) {
          marker.on('dragend', () => {
            const point = marker.getLatLng();
            onDragEnd({ lat: point.lat, lng: point.lng });
          });
        }
        marker.addTo(map);
        markers.set(id, marker);
      },

      removeMarker(id) {
        markers.get(id)?.remove();
        markers.delete(id);
      },

      setAccuracy(id, position, radiusMetres) {
        circles.get(id)?.remove();
        circles.delete(id);
        if (!position) return;
        const circle = L.circle([position.lat, position.lng], {
          radius: radiusMetres,
          color: COLORS.person,
          weight: 1,
          fillColor: COLORS.person,
          fillOpacity: 0.12,
          interactive: false
        }).addTo(map);
        circles.set(id, circle);
      },

      fitTo(points) {
        const valid = points.filter(Boolean);
        if (valid.length === 1) map.setView([valid[0].lat, valid[0].lng], Math.max(map.getZoom(), 17));
        else if (valid.length > 1) map.fitBounds(valid.map((point) => [point.lat, point.lng]), { padding: [40, 40], maxZoom: 18 });
      },

      setView(center, zoom) {
        map.setView([center.lat, center.lng], zoom || map.getZoom());
      },

      onClick(handler) {
        map.on('click', (event) => handler({ lat: event.latlng.lat, lng: event.latlng.lng }));
      },

      invalidateSize() {
        map.invalidateSize();
      }
    };
  }

  window.WitsPathMap = {
    create(container, options) {
      const provider = window.WITSPATH_MAP_PROVIDER || 'leaflet';
      if (provider !== 'leaflet') {
        throw new Error(`Map provider "${provider}" is not implemented yet`);
      }
      return createLeafletMap(container, options);
    }
  };
})();
