// The named places in the WitsPath campus graph (same data as the Android
// app), for place pickers. Unnamed junctions are left out.
(function () {
  'use strict';

  let cache = null;

  async function load() {
    if (!cache) {
      cache = fetch('/data/wits-west-map.json')
        .then((response) => {
          if (!response.ok) throw new Error('Could not load campus places.');
          return response.json();
        })
        .then((graph) =>
          graph.nodes
            .filter((node) => node.label && node.type !== 'node')
            .map((node) => ({ nodeId: node.nodeId, name: node.label.replace(/\s+/g, ' ').trim() }))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
    }
    return cache;
  }

  /** Fill a <select> with places; optional first option (e.g. "Choose a place"). */
  async function fillSelect(select, placeholder) {
    const places = await load();
    const options = places.map(({ nodeId, name }) => {
      const option = document.createElement('option');
      option.value = nodeId;
      option.textContent = name;
      return option;
    });
    if (placeholder) {
      const first = document.createElement('option');
      first.value = '';
      first.textContent = placeholder;
      options.unshift(first);
    }
    select.replaceChildren(...options);
    return places;
  }

  window.WitsPathPlaces = { load, fillSelect };
})();
