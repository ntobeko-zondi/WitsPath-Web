// Campus places admin: the WitsPath team pins buildings and entrances that
// become live-trip destinations. The server re-validates everything.
(function () {
  'use strict';

  const TOKEN_KEY = 'witspath.admin.token';
  const PINNER_KEY = 'witspath.admin.pinnedBy';

  const el = Object.fromEntries(
    [
      'adminLogin', 'adminToken', 'adminLoginStatus', 'adminWork', 'adminCampus', 'adminPlaces', 'adminForm',
      'adminFormTitle', 'placeName', 'placeKind', 'placeLat', 'placeLng', 'placeAliases', 'placeNode', 'placeNotes',
      'placePinnedBy', 'placeSave', 'placeCancel', 'adminStatus', 'adminMap'
    ].map((id) => [id, document.getElementById(id)])
  );

  const state = { token: '', campuses: [], places: [], editingId: null, map: null };

  function session(key, value) {
    try {
      if (value === undefined) return window.sessionStorage.getItem(key);
      window.sessionStorage.setItem(key, value);
    } catch {
      return null;
    }
    return null;
  }

  function local(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch {
      return null;
    }
    return null;
  }

  async function adminFetch(path, options = {}) {
    return fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-admin-token': state.token, ...(options.headers || {}) }
    });
  }

  // ---- sign in ----------------------------------------------------------------

  async function signIn(token) {
    state.token = token;
    let response;
    try {
      response = await adminFetch('/api/admin/places');
    } catch {
      el.adminLoginStatus.textContent = "Can't reach the WitsPath server.";
      return false;
    }
    if (response.status === 401) {
      el.adminLoginStatus.textContent = 'That admin token is not correct.';
      return false;
    }
    if (response.status === 503) {
      el.adminLoginStatus.textContent = 'Admin editing is turned off on this server (ADMIN_API_TOKEN is not set).';
      return false;
    }
    session(TOKEN_KEY, token);
    el.adminLogin.hidden = true;
    el.adminWork.hidden = false;
    state.places = (await response.json()).places;
    renderPlaces();
    return true;
  }

  // ---- list & map -------------------------------------------------------------

  function campus() {
    return state.campuses.find((item) => item.id === el.adminCampus.value);
  }

  function renderPlaces() {
    const current = campus();
    const places = state.places.filter((place) => place.campusId === current.id).sort((a, b) => a.name.localeCompare(b.name));

    for (const place of state.places) state.map.removeMarker(`place-${place.id}`);
    for (const place of places) state.map.setMarker(`place-${place.id}`, place, { kind: 'place', label: place.name });

    if (!places.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No places pinned on this campus yet.';
      el.adminPlaces.replaceChildren(empty);
      return;
    }
    el.adminPlaces.replaceChildren(
      ...places.map((place) => {
        const li = document.createElement('li');
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = place.name;
        const meta = document.createElement('span');
        meta.className = 'companion-small';
        const access = place.accessibleEntrance === true ? 'step-free' : place.accessibleEntrance === false ? 'not step-free' : 'access not checked';
        meta.textContent = `${place.kind.replace('_', ' ')} · ${access} · pinned by ${place.verifiedBy}`;
        text.append(name, meta);

        const actions = document.createElement('div');
        actions.className = 'page-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'companion-secondary';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit ${place.name}`);
        edit.addEventListener('click', () => startEdit(place));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'companion-secondary';
        remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete ${place.name}`);
        remove.addEventListener('click', () => deletePlace(place));
        actions.append(edit, remove);

        li.append(text, actions);
        return li;
      })
    );
  }

  function changeCampus() {
    const current = campus();
    state.map.setView(current.center, current.zoom);
    clearForm();
    renderPlaces();
  }

  // ---- form ---------------------------------------------------------------------

  function setDraft(position) {
    el.placeLat.value = position.lat.toFixed(7);
    el.placeLng.value = position.lng.toFixed(7);
    state.map.setMarker('draft', position, { kind: 'draft', label: 'New pin', draggable: true, onDragEnd: setDraft });
  }

  function draftFromInputs() {
    const lat = Number(el.placeLat.value);
    const lng = Number(el.placeLng.value);
    if (el.placeLat.value && el.placeLng.value && Number.isFinite(lat) && Number.isFinite(lng)) {
      state.map.removeMarker('draft');
      setDraft({ lat, lng });
    }
  }

  function startEdit(place) {
    state.editingId = place.id;
    el.adminFormTitle.textContent = `Edit ${place.name}`;
    el.placeName.value = place.name;
    el.placeKind.value = place.kind;
    el.adminForm.querySelector(
      `input[name="placeAccessible"][value="${place.accessibleEntrance === true ? 'true' : place.accessibleEntrance === false ? 'false' : 'unknown'}"]`
    ).checked = true;
    el.placeAliases.value = (place.aliases || []).join(', ');
    el.placeNode.value = place.graphNodeId || '';
    el.placeNotes.value = place.notes || '';
    state.map.removeMarker('draft');
    setDraft(place);
    state.map.setView(place, 18);
    el.placeName.focus();
  }

  function clearForm() {
    state.editingId = null;
    el.adminFormTitle.textContent = 'Add a place';
    el.adminForm.reset();
    el.placePinnedBy.value = local(PINNER_KEY) || '';
    state.map.removeMarker('draft');
  }

  async function savePlace(event) {
    event.preventDefault();
    const accessible = el.adminForm.querySelector('input[name="placeAccessible"]:checked').value;
    const body = {
      name: el.placeName.value,
      campusId: campus().id,
      kind: el.placeKind.value,
      accessibleEntrance: accessible === 'true' ? true : accessible === 'false' ? false : null,
      lat: Number(el.placeLat.value),
      lng: Number(el.placeLng.value),
      aliases: el.placeAliases.value.split(',').map((alias) => alias.trim()).filter(Boolean),
      graphNodeId: el.placeNode.value,
      notes: el.placeNotes.value,
      pinnedBy: el.placePinnedBy.value
    };
    local(PINNER_KEY, el.placePinnedBy.value.trim());

    const path = state.editingId ? `/api/admin/places/${encodeURIComponent(state.editingId)}` : '/api/admin/places';
    let response;
    try {
      response = await adminFetch(path, { method: state.editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
    } catch {
      el.adminStatus.textContent = "Can't reach the WitsPath server. The place was not saved.";
      return;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      el.adminStatus.textContent = result.message || "Couldn't save the place.";
      return;
    }
    state.places = state.places.filter((place) => place.id !== result.id).concat(result);
    el.adminStatus.textContent = `Saved ${result.name}.`;
    clearForm();
    renderPlaces();
  }

  async function deletePlace(place) {
    if (!window.confirm(`Delete ${place.name}? Live trips can no longer use it as a destination.`)) return;
    let response;
    try {
      response = await adminFetch(`/api/admin/places/${encodeURIComponent(place.id)}`, { method: 'DELETE' });
    } catch {
      el.adminStatus.textContent = "Can't reach the WitsPath server. Nothing was deleted.";
      return;
    }
    if (!response.ok && response.status !== 404) {
      el.adminStatus.textContent = "Couldn't delete the place.";
      return;
    }
    state.map.removeMarker(`place-${place.id}`);
    state.places = state.places.filter((item) => item.id !== place.id);
    el.adminStatus.textContent = `Deleted ${place.name}.`;
    renderPlaces();
  }

  // ---- startup --------------------------------------------------------------------

  async function init() {
    const response = await fetch('/api/campuses');
    state.campuses = (await response.json()).campuses;
    el.adminCampus.replaceChildren(
      ...state.campuses.map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        return option;
      })
    );
    state.map = window.WitsPathMap.create(el.adminMap, { center: state.campuses[0].center, zoom: state.campuses[0].zoom, label: 'Campus map. Click to drop a pin.' });
    state.map.onClick((position) => {
      if (!el.adminWork.hidden) setDraft(position);
    });

    el.adminLogin.addEventListener('submit', (event) => {
      event.preventDefault();
      signIn(el.adminToken.value.trim());
    });
    el.adminCampus.addEventListener('change', changeCampus);
    el.adminForm.addEventListener('submit', savePlace);
    el.placeCancel.addEventListener('click', clearForm);
    el.placeLat.addEventListener('change', draftFromInputs);
    el.placeLng.addEventListener('change', draftFromInputs);
    el.placePinnedBy.value = local(PINNER_KEY) || '';

    const saved = session(TOKEN_KEY);
    if (saved) await signIn(saved);
  }

  init();
})();
