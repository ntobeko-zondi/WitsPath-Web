// Step-by-step navigation for the route planner, modelled on the Android
// app's NavigationActivity: one instruction at a time, Previous/Next, a
// progress bar, and the map following a "you are here" marker.
//
// Steps come from the route card (verified phrase templates); only steps tied
// to a point on the route (pointIndex) are navigation steps.
(function () {
  'use strict';

  const el = {
    start: document.getElementById('startNavigation'),
    mode: document.getElementById('navigationMode'),
    stepNumber: document.getElementById('navStepNumber'),
    stepCount: document.getElementById('navStepCount'),
    instruction: document.getElementById('navInstruction'),
    progress: document.getElementById('navProgress'),
    prev: document.getElementById('navPrev'),
    next: document.getElementById('navNext'),
    exit: document.getElementById('navExit'),
    stepsList: document.getElementById('stepsList')
  };

  const state = { card: null, steps: [], index: 0 };

  function setRoute(card) {
    exit();
    state.card = card;
    state.steps = card
      ? card.steps.map((step, listIndex) => ({ ...step, listIndex })).filter((step) => Number.isInteger(step.pointIndex))
      : [];
    el.start.hidden = state.steps.length < 2;
  }

  function start() {
    if (state.steps.length < 2) return;
    state.index = 0;
    el.start.hidden = true;
    el.mode.hidden = false;
    render();
    el.next.focus();
  }

  function render() {
    const step = state.steps[state.index];
    const last = state.steps.length - 1;
    el.stepNumber.textContent = String(state.index + 1);
    el.stepCount.textContent = String(state.steps.length);
    el.instruction.textContent = step.text;
    el.instruction.lang = step.lang;
    el.progress.value = Math.round((state.index / last) * 100);
    el.progress.setAttribute('aria-valuetext', `Step ${state.index + 1} of ${state.steps.length}`);
    el.prev.disabled = state.index === 0;
    el.next.disabled = state.index === last;
    // A disabled button can't keep keyboard focus; hand it to the other one.
    if (document.activeElement === el.next && el.next.disabled) el.prev.focus();
    if (document.activeElement === el.prev && el.prev.disabled) el.next.focus();

    el.stepsList.querySelectorAll('li').forEach((li, listIndex) => {
      const isCurrent = listIndex === step.listIndex;
      li.classList.toggle('is-current', isCurrent);
      li.classList.toggle('is-done', state.steps.some((s, i) => i < state.index && s.listIndex === listIndex));
      if (isCurrent) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });

    const point = state.card.points[step.pointIndex];
    window.setCurrentMarker(point);
    window.centerMapOn(point);
  }

  function move(delta) {
    const nextIndex = Math.min(state.steps.length - 1, Math.max(0, state.index + delta));
    if (nextIndex === state.index) return;
    state.index = nextIndex;
    render();
  }

  function exit() {
    el.mode.hidden = true;
    el.start.hidden = state.steps.length < 2;
    window.setCurrentMarker?.(null);
    el.stepsList.querySelectorAll('li').forEach((li) => {
      li.classList.remove('is-current', 'is-done');
      li.removeAttribute('aria-current');
    });
  }

  el.start.addEventListener('click', start);
  el.next.addEventListener('click', () => move(1));
  el.prev.addEventListener('click', () => move(-1));
  el.exit.addEventListener('click', () => {
    exit();
    el.start.focus();
  });

  window.WitsPathNavigation = { setRoute };
})();
