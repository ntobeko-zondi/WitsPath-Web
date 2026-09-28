// "Report a blocked path" for the route on screen. Same issue types and
// Firestore report shape as the Android app; three different signed-in people
// reporting the same path flags it for everyone.
(function () {
  'use strict';

  const el = {
    panel: document.getElementById('reportPanel'),
    signIn: document.getElementById('reportSignIn'),
    form: document.getElementById('reportForm'),
    segment: document.getElementById('reportSegment'),
    description: document.getElementById('reportDescription'),
    submit: document.getElementById('reportSubmit'),
    status: document.getElementById('reportStatus')
  };
  const auth = window.WitsPathAuth;

  /** Called by the route planner whenever the shown route changes. */
  function setRoute(card) {
    el.status.textContent = '';
    if (!card || !card.edgeIds?.length) {
      el.panel.hidden = true;
      return;
    }
    el.segment.replaceChildren(
      ...card.edgeIds.map((edgeId, i) => {
        const option = document.createElement('option');
        option.value = edgeId;
        option.textContent = `${card.points[i].name} to ${card.points[i + 1].name}`;
        return option;
      })
    );
    el.panel.hidden = false;
  }

  function updateAccess(user) {
    const canReport = Boolean(user);
    el.signIn.hidden = canReport;
    el.form.hidden = !canReport;
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.submit.disabled = true;
    el.status.className = 'status-message';
    el.status.textContent = 'Sending report…';
    try {
      const response = await auth.authorizedFetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: el.segment.value,
          issueType: el.form.querySelector('input[name="issueType"]:checked').value,
          description: el.description.value
        })
      });
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json();
      el.status.className = 'status-message success';
      el.status.textContent = result.flagged
        ? 'Reported. This path is now flagged for everyone, and routes will avoid it.'
        : 'Obstacle reported. Thank you!';
      el.description.value = '';
    } catch {
      el.status.className = 'status-message error';
      el.status.textContent = 'Failed to report obstacle. Please try again.';
    } finally {
      el.submit.disabled = false;
    }
  });

  auth.ready.then((enabled) => {
    if (!enabled) {
      el.signIn.textContent = 'Reporting needs an account, and accounts are not set up on this site yet.';
      updateAccess(null);
      return;
    }
    auth.onChange(updateAccess);
  });

  window.WitsPathReport = { setRoute };
})();
