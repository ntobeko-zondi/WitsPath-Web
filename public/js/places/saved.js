// Saved places page: home base, saved places ({ nodeId, label, detail }, the
// Android SavedPlace shape) and the next-class reminder.
(function () {
  'use strict';

  const settings = window.WitsPathSettings;
  const reminders = window.WitsPathReminders;
  const el = (id) => document.getElementById(id);
  let placesById = new Map();

  function renderSaved() {
    const saved = settings.get('savedPlaces');
    if (!saved.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No saved places yet.';
      el('savedList').replaceChildren(empty);
      return;
    }
    el('savedList').replaceChildren(
      ...saved.map((place, index) => {
        const li = document.createElement('li');
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = place.label;
        text.appendChild(name);
        if (place.detail) {
          const detail = document.createElement('span');
          detail.className = 'companion-small';
          detail.textContent = place.detail;
          text.appendChild(detail);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'companion-secondary';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${place.label}`);
        remove.addEventListener('click', () => {
          const next = settings.get('savedPlaces').filter((_, i) => i !== index);
          settings.set('savedPlaces', next);
          renderSaved();
          el('savedPlace').focus();
        });
        li.append(text, remove);
        return li;
      })
    );
  }

  function renderReminder() {
    const text = reminders.describe();
    el('classStatus').textContent = text || '';
    el('classClear').hidden = !settings.get('nextClass');
  }

  async function init() {
    const places = await window.WitsPathPlaces.load();
    placesById = new Map(places.map((place) => [place.nodeId, place]));
    await Promise.all([
      window.WitsPathPlaces.fillSelect(el('homeSelect'), 'Not set'),
      window.WitsPathPlaces.fillSelect(el('savedPlace')),
      window.WitsPathPlaces.fillSelect(el('classPlace')),
      window.WitsPathPlaces.fillSelect(el('classFrom'))
    ]);
    el('homeSelect').value = settings.get('homeNodeId');
    el('classFrom').value = settings.get('homeNodeId') || places[0].nodeId;
    const reminder = settings.get('nextClass');
    if (reminder) {
      el('classPlace').value = reminder.nodeId;
      el('classTime').value = reminder.time;
      el('classFrom').value = reminder.fromNodeId;
    }
    renderSaved();
    renderReminder();
  }

  el('homeSelect').addEventListener('change', (event) => settings.set('homeNodeId', event.target.value));

  el('savedAddForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const place = placesById.get(el('savedPlace').value);
    if (!place) return;
    const saved = settings.get('savedPlaces').filter((item) => item.nodeId !== place.nodeId);
    saved.push({ nodeId: place.nodeId, label: place.name, detail: el('savedDetail').value.trim() });
    settings.set('savedPlaces', saved);
    el('savedDetail').value = '';
    renderSaved();
  });

  el('classForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const to = placesById.get(el('classPlace').value);
    const from = placesById.get(el('classFrom').value);
    if (!to || !from || !el('classTime').value) return;
    if (to.nodeId === from.nodeId) {
      el('classStatus').textContent = 'Choose a different place to leave from.';
      return;
    }
    el('classSet').disabled = true;
    el('classStatus').textContent = 'Estimating your travel time…';
    // Ask while we still have the click (browsers require a user gesture).
    await reminders.askForNotifications();
    const result = await reminders.setReminder({
      fromNodeId: from.nodeId,
      fromName: from.name,
      toNodeId: to.nodeId,
      toName: to.name,
      time: el('classTime').value
    });
    el('classSet').disabled = false;
    if (result.error) {
      el('classStatus').textContent = result.error;
      return;
    }
    renderReminder();
  });

  el('classClear').addEventListener('click', () => {
    reminders.clearReminder();
    renderReminder();
    el('classSet').focus();
  });

  init().catch(() => {
    el('savedList').textContent = "Couldn't load the campus places. Reload the page to try again.";
  });
})();
