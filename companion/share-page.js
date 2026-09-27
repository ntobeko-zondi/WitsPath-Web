// Renders a shared route card from /api/share/{id}. Only the route card
// fields are available here - never the conversation.
(function () {
  'use strict';

  const REVOKE_KEY_PREFIX = 'witspath.share.revoke.';
  const title = document.getElementById('shareTitle');
  const status = document.getElementById('shareStatus');
  const card = document.getElementById('shareCard');
  const facts = document.getElementById('shareFacts');
  const steps = document.getElementById('shareSteps');
  const expiry = document.getElementById('shareExpiry');
  const revokeButton = document.getElementById('shareRevoke');

  const shareId = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

  function chip(text, className) {
    const span = document.createElement('span');
    span.className = `companion-chip ${className || ''}`;
    span.textContent = text;
    return span;
  }

  function readRevokeToken() {
    try {
      return window.localStorage.getItem(REVOKE_KEY_PREFIX + shareId);
    } catch {
      return null;
    }
  }

  function unavailable() {
    title.textContent = 'Route not available';
    status.textContent = 'This link has expired, was revoked, or does not exist.';
    card.hidden = true;
  }

  async function load() {
    let route;
    try {
      const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
      if (!response.ok) {
        unavailable();
        return;
      }
      route = await response.json();
    } catch {
      title.textContent = 'Could not load route';
      status.textContent = 'Please check your connection and try again.';
      return;
    }

    title.textContent = `${route.from} to ${route.to}`;
    document.title = `${route.from} to ${route.to} · WitsPath`;
    facts.append(
      chip(route.accessible ? 'Step-free' : 'Not confirmed step-free', route.accessible ? 'is-good' : 'is-warn'),
      chip(`${Math.round(route.distanceM)} ${Math.round(route.distanceM) === 1 ? 'metre' : 'metres'}`)
    );
    for (const step of route.steps) {
      const li = document.createElement('li');
      li.textContent = step.text;
      li.lang = step.lang;
      steps.appendChild(li);
    }
    expiry.textContent = `This link works until ${new Date(route.expiresAt).toLocaleDateString()}.`;
    card.hidden = false;

    const token = readRevokeToken();
    if (token) {
      revokeButton.hidden = false;
      revokeButton.addEventListener('click', async () => {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`, {
          method: 'DELETE',
          headers: { 'x-revoke-token': token }
        });
        if (response.ok) {
          unavailable();
          status.textContent = 'Link revoked. It no longer works for anyone.';
        } else {
          status.textContent = 'Could not revoke the link. Please try again.';
        }
      });
    }
  }

  load();
})();
