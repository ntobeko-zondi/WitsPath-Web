// WitsPath Companion - chat widget.
//
// Talks only to our own /api/** endpoints. There is no API key here or
// anywhere else in the browser; the Anthropic call happens in the Cloud
// Function. All model text is rendered with textContent (never innerHTML).
(function () {
  'use strict';

  const SESSION_KEY = 'witspath.companion.sessionId';
  const LANG_KEY = 'witspath.companion.replyLang';
  const SPEAK_KEY = 'witspath.companion.speakReplies';
  const REVOKE_KEY_PREFIX = 'witspath.share.revoke.';

  const TIER_LABELS = {
    full: 'Supported',
    limited: 'Limited support, unverified',
    unsupported: 'Not supported, may be unreliable',
    unconfirmed: 'Language not confirmed'
  };

  const el = {
    launcher: document.getElementById('companionLauncher'),
    panel: document.getElementById('companionPanel'),
    close: document.getElementById('companionClose'),
    langSelect: document.getElementById('companionLang'),
    speakToggle: document.getElementById('companionSpeak'),
    langNotice: document.getElementById('companionLangNotice'),
    log: document.getElementById('companionLog'),
    form: document.getElementById('companionForm'),
    input: document.getElementById('companionInput'),
    send: document.getElementById('companionSend'),
    mic: document.getElementById('companionMic'),
    voiceStatus: document.getElementById('companionVoiceStatus'),
    stopSpeaking: document.getElementById('companionStopSpeaking'),
    exportButton: document.getElementById('companionExportButton'),
    exportReports: document.getElementById('companionExportReports'),
    exportMobility: document.getElementById('companionExportMobility'),
    exportStatus: document.getElementById('companionExportStatus'),
    shareDialog: document.getElementById('shareDialog'),
    shareClose: document.getElementById('shareDialogClose'),
    shareRoute: document.getElementById('shareDialogRoute'),
    shareStatus: document.getElementById('shareDialogStatus'),
    shareCreateStep: document.getElementById('shareCreateStep'),
    shareCreate: document.getElementById('shareCreate'),
    shareLinkStep: document.getElementById('shareLinkStep'),
    shareLinkInput: document.getElementById('shareLinkInput'),
    shareCopy: document.getElementById('shareCopy'),
    shareNative: document.getElementById('shareNative'),
    shareWhatsApp: document.getElementById('shareWhatsApp'),
    shareEmail: document.getElementById('shareEmail'),
    shareSms: document.getElementById('shareSms'),
    shareExpiryNote: document.getElementById('shareExpiryNote'),
    shareDelete: document.getElementById('shareDelete')
  };

  const state = {
    config: null,
    languages: {},
    speech: null,
    listening: null,
    busy: false,
    speechGeneration: 0,
    metrics: []
  };

  function storage(kind) {
    try {
      return window[kind];
    } catch {
      return null;
    }
  }

  function readPref(kind, key, fallback) {
    try {
      const value = storage(kind)?.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writePref(kind, key, value) {
    try {
      storage(kind)?.setItem(key, value);
    } catch {
      // Storage blocked: preferences just won't persist.
    }
  }

  function languageName(code) {
    return state.languages[code]?.name || 'this language';
  }

  // Units are always written in full so they read (and are spoken) clearly.
  function formatMetres(value) {
    const metres = Math.round(value);
    return `${metres} ${metres === 1 ? 'metre' : 'metres'}`;
  }

  function formatMinutes(value) {
    return `${value} ${value === 1 ? 'minute' : 'minutes'}`;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- panel open/close -------------------------------------------------

  function openPanel() {
    el.panel.hidden = false;
    el.launcher.setAttribute('aria-expanded', 'true');
    el.input.focus();
  }

  function closePanel() {
    el.panel.hidden = true;
    el.launcher.setAttribute('aria-expanded', 'false');
    el.launcher.focus();
  }

  // ---- language selection & honest capability notices -------------------

  function populateLanguages() {
    for (const lang of state.config.languages) {
      const option = document.createElement('option');
      option.value = lang.code;
      option.lang = lang.code;
      option.textContent = `${lang.name} (${TIER_LABELS[lang.tier]}${directionsCaveat(lang)})`;
      el.langSelect.appendChild(option);
    }
    el.langSelect.value = state.languages[readPref('localStorage', LANG_KEY, '')] ? readPref('localStorage', LANG_KEY, '') : '';
    updateLanguageNotice();
  }

  // Directions only appear in a language once native speakers have verified
  // its phrases; say so rather than implying full coverage.
  function directionsCaveat(lang) {
    const { verified, total } = lang.directionsVerified || { verified: 0, total: 1 };
    if (verified >= total) return '';
    return verified === 0 ? '; directions in English' : '; directions partly in English';
  }

  function selectedLang() {
    return el.langSelect.value || null;
  }

  function updateLanguageNotice() {
    const code = selectedLang();
    const notes = [];
    if (code) {
      const lang = state.languages[code];
      if (lang.tier === 'limited') {
        notes.push(`${lang.name} support is limited: replies are not verified and may contain mistakes.`);
      }
      if (directionsCaveat(lang)) {
        notes.push(`Turn-by-turn directions are shown in English where verified ${lang.name} wording isn't available yet.`);
      }
      if (!state.speech.transcriberFor(code)) {
        notes.push(`Voice input isn't available in ${lang.name} yet. Please type instead.`);
      } else if (state.speech.transcriberFor(code).id === 'web-speech' && code !== 'en') {
        notes.push(`Voice input in ${lang.name} depends on your browser and may not work.`);
      }
      if (el.speakToggle.checked && !state.speech.canSpeak(code)) {
        notes.push(`This device has no ${lang.name} voice, so replies won't be read aloud in ${lang.name}.`);
      }
    }
    el.langNotice.textContent = notes.join(' ');
    el.langNotice.hidden = notes.length === 0;
  }

  // ---- conversation log -------------------------------------------------

  function addMessage(role, text, options = {}) {
    const item = make('li', `companion-message companion-${role}`);
    item.appendChild(make('span', 'visually-hidden', role === 'user' ? 'You said: ' : 'Companion: '));
    const body = make('p', 'companion-text', text);
    if (options.lang) body.lang = options.lang;
    item.appendChild(body);

    if (options.language && role === 'assistant') {
      const badge = languageBadge(options.language);
      if (badge) item.appendChild(badge);
    }
    el.log.appendChild(item);
    item.scrollIntoView({ block: 'nearest' });
    return item;
  }

  function languageBadge(language) {
    const tier = language.tier;
    if (tier === 'full') return null;
    const badge = make('p', `companion-badge companion-badge-${tier}`);
    if (tier === 'limited') {
      badge.textContent = `${languageName(language.code)}: limited support. This reply is unverified and may contain mistakes.`;
    } else if (tier === 'unsupported') {
      badge.textContent = 'This language is not supported yet. The reply may be unreliable.';
    } else {
      badge.textContent = TIER_LABELS.unconfirmed;
    }
    return badge;
  }

  function addRouteCard(route, sessionId) {
    const item = make('li', 'companion-message companion-assistant');
    const card = make('article', 'companion-route');
    const headingId = `route-${Date.now()}`;
    const heading = make('h3', null, `${route.from} to ${route.to}`);
    heading.id = headingId;
    card.setAttribute('aria-labelledby', headingId);
    card.appendChild(heading);

    const facts = make('p', 'companion-route-facts');
    facts.appendChild(make('span', `companion-chip ${route.accessible ? 'is-good' : 'is-warn'}`, route.accessible ? 'Step-free' : 'Not confirmed step-free'));
    facts.appendChild(make('span', 'companion-chip', formatMetres(route.distanceM)));
    if (route.travelTime) {
      facts.appendChild(make('span', 'companion-chip', `about ${formatMinutes(route.travelTime.minutes)} (estimate)`));
    }
    card.appendChild(facts);

    if (route.routingSource === 'placeholder-fixture') {
      card.appendChild(
        make('p', 'companion-badge companion-badge-limited', 'Placeholder route data for testing. Not yet from the shared WitsPath routing engine.')
      );
    }
    if (route.fallbackToEnglish) {
      card.appendChild(
        make('p', 'companion-badge companion-badge-info', `Some directions are in English because verified ${languageName(route.directionsLang)} wording isn't available yet.`)
      );
    }

    const steps = make('ol', 'companion-steps');
    for (const step of route.steps) {
      const li = make('li', null, step.text);
      li.lang = step.lang;
      steps.appendChild(li);
    }
    card.appendChild(steps);

    const actions = make('div', 'companion-card-actions');
    const readButton = make('button', 'companion-secondary', 'Read steps aloud');
    readButton.type = 'button';
    readButton.addEventListener('click', () => speakSequence(route.steps.map((step) => ({ text: step.text, lang: step.lang }))));
    const shareButton = make('button', 'companion-secondary companion-share-button');
    shareButton.type = 'button';
    shareButton.append(shareIcon(), make('span', null, 'Share'));
    shareButton.setAttribute('aria-haspopup', 'dialog');
    // Remember which conversation this card came from, so sharing still
    // targets this exact card later in the chat.
    const shareTarget = { route, sessionId, share: null };
    shareButton.addEventListener('click', () => openShareDialog(shareTarget, shareButton));
    actions.append(readButton, shareButton);
    card.append(actions);

    item.appendChild(card);
    el.log.appendChild(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  // ---- sending messages -------------------------------------------------

  async function sendMessage(text, voice) {
    if (state.busy || !text.trim()) return;
    state.busy = true;
    el.send.disabled = true;
    addMessage('user', text, { lang: voice?.lang || selectedLang() || undefined });
    const pending = addMessage('assistant', 'Thinking…');
    pending.setAttribute('aria-busy', 'true');
    const startedAt = performance.now();

    let result;
    try {
      // Signed-in users' reports count towards flagging a path.
      const send = window.WitsPathAuth ? window.WitsPathAuth.authorizedFetch : fetch;
      const response = await send('/api/companion/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: readPref('sessionStorage', SESSION_KEY, null),
          text,
          inputMode: voice ? 'voice' : 'text',
          inputLang: voice?.lang || null,
          preferredLang: selectedLang(),
          speedMultiplier: window.WitsPathSettings?.get('walkingSpeed')
        })
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.message || 'unavailable');
    } catch (error) {
      pending.remove();
      addMessage('assistant', "The companion isn't available right now. You can still use the route planner on this page.");
      finishSend();
      return;
    }

    pending.remove();
    writePref('sessionStorage', SESSION_KEY, result.sessionId);
    addMessage('assistant', result.reply, { lang: result.language.code || undefined, language: result.language });
    if (result.route) addRouteCard(result.route, result.sessionId);
    if (voice) recordMetric({ ...voice.timing, serverMs: Math.round(performance.now() - startedAt) });
    finishSend();

    if (voice || el.speakToggle.checked) {
      const queue = [{ text: result.reply, lang: result.language.code }];
      if (result.route) queue.push(...result.route.steps.map((step) => ({ text: step.text, lang: step.lang })));
      speakSequence(queue, voice ? performance.now() : null);
    }
  }

  function finishSend() {
    state.busy = false;
    el.send.disabled = false;
  }

  // ---- speech output ----------------------------------------------------

  async function speakSequence(items, timingStart) {
    state.speechGeneration += 1;
    const generation = state.speechGeneration;
    state.speech.cancelSpeech();
    el.stopSpeaking.hidden = false;
    const skipped = new Set();
    let first = true;
    for (const item of items) {
      if (generation !== state.speechGeneration) return;
      if (!state.speech.canSpeak(item.lang)) {
        skipped.add(item.lang ? languageName(item.lang) : 'an unconfirmed language');
        continue;
      }
      if (first && timingStart) {
        state.metrics[state.metrics.length - 1].speechStartMs = Math.round(performance.now() - timingStart);
        reportLatency();
      }
      first = false;
      await state.speech.speak(item.text, item.lang);
    }
    if (generation === state.speechGeneration) el.stopSpeaking.hidden = true;
    if (skipped.size) {
      el.voiceStatus.textContent = `Not read aloud: no voice on this device for ${[...skipped].join(', ')}. The text is shown above.`;
    }
  }

  function stopSpeaking() {
    state.speechGeneration += 1;
    state.speech.cancelSpeech();
    el.stopSpeaking.hidden = true;
  }

  // ---- speech input -----------------------------------------------------

  async function toggleListening() {
    if (state.listening) {
      await finishListening();
      return;
    }
    stopSpeaking();
    const lang = selectedLang();
    try {
      state.listening = await state.speech.startListening(lang);
    } catch (error) {
      el.voiceStatus.textContent =
        error.message === 'no_transcriber'
          ? `Voice input isn't available${lang ? ` in ${languageName(lang)}` : ''} on this device. Please type your message.`
          : 'Microphone unavailable. Check permissions, or type your message.';
      return;
    }
    state.listening.startedAt = performance.now();
    el.mic.setAttribute('aria-pressed', 'true');
    el.mic.textContent = 'Stop and send';
    el.voiceStatus.textContent = 'Listening… press "Stop and send" when you are done.';
  }

  async function finishListening() {
    const session = state.listening;
    state.listening = null;
    el.mic.setAttribute('aria-pressed', 'false');
    el.mic.textContent = 'Speak';
    el.voiceStatus.textContent = 'Transcribing…';
    const stoppedAt = performance.now();
    try {
      const { text, lang } = await session.stop();
      if (!text) {
        el.voiceStatus.textContent = "I didn't catch that. Try again, or type your message.";
        return;
      }
      el.voiceStatus.textContent = '';
      const timing = { provider: session.providerId, transcribeMs: Math.round(performance.now() - stoppedAt) };
      await sendMessage(text, { lang, timing });
    } catch (error) {
      el.voiceStatus.textContent = "Sorry, I couldn't transcribe that. Please try again or type your message.";
    }
  }

  // Latency for test case 4. Logged to the console and kept on
  // window.witspathCompanionMetrics for inspection.
  function recordMetric(metric) {
    state.metrics.push(metric);
    window.witspathCompanionMetrics = state.metrics;
  }

  function reportLatency() {
    const metric = state.metrics[state.metrics.length - 1];
    metric.totalMs = metric.transcribeMs + metric.serverMs + metric.speechStartMs;
    const budget = state.config.voice.latencyBudgetMs;
    const log = metric.totalMs > budget ? console.warn : console.info;
    log(`[companion] voice round trip ${metric.totalMs} ms (budget ${budget} ms)`, metric);
  }

  // ---- share & export ---------------------------------------------------

  // Share flow modelled on chat-sharing apps: Share -> Create link -> Copy
  // link or send it straight to WhatsApp, email or SMS. One dialog is reused
  // by every route card; each card remembers its own link once created.
  const SERVER_UNREACHABLE = "Can't reach the WitsPath server. Check that it's running and your connection, then try again.";
  const shareState = { target: null, returnFocus: null };

  // "Share" icon: an arrow coming out of a box.
  function shareIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of ['M12 3v12', 'M7 8l5-5 5 5', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7']) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
    return svg;
  }

  function openShareDialog(target, button) {
    shareState.target = target;
    shareState.returnFocus = button;
    el.shareRoute.textContent = `${target.route.from} to ${target.route.to}`;
    el.shareStatus.textContent = '';
    if (target.share) showShareLink(target.share);
    else showCreateStep();
    el.shareDialog.showModal();
    (target.share ? el.shareCopy : el.shareCreate).focus();
  }

  function closeShareDialog() {
    if (el.shareDialog.open) el.shareDialog.close();
  }

  function showCreateStep() {
    el.shareCreateStep.hidden = false;
    el.shareLinkStep.hidden = true;
    el.shareCreate.disabled = false;
    el.shareCreate.textContent = 'Create link';
  }

  function showShareLink(share) {
    const { route } = shareState.target;
    const kind = route.accessible ? 'Step-free route' : 'Route';
    const message = `${kind} from ${route.from} to ${route.to} on WitsPath: ${share.url}`;
    el.shareCreateStep.hidden = true;
    el.shareLinkStep.hidden = false;
    el.shareLinkInput.value = share.url;
    el.shareCopy.textContent = 'Copy link';
    el.shareWhatsApp.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
    el.shareEmail.href = `mailto:?subject=${encodeURIComponent(`WitsPath route: ${route.from} to ${route.to}`)}&body=${encodeURIComponent(message)}`;
    el.shareSms.href = `sms:?body=${encodeURIComponent(message)}`;
    el.shareNative.hidden = typeof navigator.share !== 'function';
    el.shareExpiryNote.textContent = `This link works until ${new Date(share.expiresAt).toLocaleDateString()}.`;
  }

  async function createShareLink() {
    const target = shareState.target;
    el.shareCreate.disabled = true;
    el.shareCreate.textContent = 'Creating link…';
    el.shareStatus.textContent = '';
    let response;
    try {
      response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: target.sessionId, routeId: target.route.routeId })
      });
    } catch {
      el.shareStatus.textContent = SERVER_UNREACHABLE;
      showCreateStep();
      return;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      el.shareStatus.textContent =
        body.error === 'session_not_found' || body.error === 'route_not_found'
          ? 'This route is no longer stored on the server (it may have restarted). Ask for the route again, then share the new card.'
          : "Couldn't create a share link. Please try again.";
      showCreateStep();
      return;
    }
    const created = await response.json();
    writePref('localStorage', REVOKE_KEY_PREFIX + created.shareId, created.revokeToken);
    target.share = { ...created, url: new URL(created.path, window.location.origin).href };
    showShareLink(target.share);
    el.shareStatus.textContent = 'Link created.';
    el.shareCopy.focus();
  }

  async function copyShareLink() {
    const url = el.shareLinkInput.value;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API blocked (e.g. insecure context): fall back to selection.
      el.shareLinkInput.select();
      if (!document.execCommand('copy')) {
        el.shareStatus.textContent = 'Copying is blocked here. Select the link and copy it manually.';
        return;
      }
    }
    el.shareCopy.textContent = 'Copied';
    el.shareStatus.textContent = 'Link copied. Paste it into WhatsApp, email or a text message.';
  }

  async function nativeShare() {
    const { route, share } = shareState.target;
    try {
      await navigator.share({ title: `WitsPath: ${route.from} to ${route.to}`, text: `Route from ${route.from} to ${route.to} on WitsPath`, url: share.url });
    } catch {
      // User closed the share sheet; nothing to do.
    }
  }

  async function deleteShareLink() {
    const target = shareState.target;
    let response;
    try {
      response = await fetch(`/api/share/${encodeURIComponent(target.share.shareId)}`, {
        method: 'DELETE',
        headers: { 'x-revoke-token': target.share.revokeToken }
      });
    } catch {
      el.shareStatus.textContent = SERVER_UNREACHABLE;
      return;
    }
    if (!response.ok) {
      el.shareStatus.textContent = 'Could not delete the link. Please try again.';
      return;
    }
    try {
      window.localStorage.removeItem(REVOKE_KEY_PREFIX + target.share.shareId);
    } catch {
      // Storage blocked; the token is useless once the link is gone anyway.
    }
    target.share = null;
    showCreateStep();
    el.shareStatus.textContent = 'Link deleted. It no longer works for anyone.';
    el.shareCreate.focus();
  }

  async function exportConversation() {
    const status = el.exportStatus;
    const sessionId = readPref('sessionStorage', SESSION_KEY, null);
    if (!sessionId) {
      status.textContent = 'There is no conversation to export yet. Send a message first.';
      return;
    }
    status.textContent = 'Preparing download…';
    let response;
    try {
      response = await fetch('/api/companion/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          includeReports: el.exportReports.checked,
          includeMobility: el.exportMobility.checked
        })
      });
    } catch {
      status.textContent = SERVER_UNREACHABLE;
      return;
    }
    if (!response.ok) {
      status.textContent =
        response.status === 404
          ? 'This conversation is no longer stored on the server (it may have restarted), so it cannot be exported.'
          : "Couldn't export the conversation. Please try again.";
      return;
    }
    const blob = new Blob([await response.text()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `witspath-conversation-${new Date().toISOString().slice(0, 10)}.txt`;
    link.download = filename;
    // Some browsers only download from links attached to the document, and
    // cancel the download if the object URL is revoked immediately.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = `Downloaded ${filename}.`;
  }

  // ---- startup ----------------------------------------------------------

  function wire() {
    el.launcher.addEventListener('click', () => (el.panel.hidden ? openPanel() : closePanel()));
    el.close.addEventListener('click', closePanel);
    el.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePanel();
    });
    el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = el.input.value;
      el.input.value = '';
      sendMessage(text, null);
    });
    el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        el.form.requestSubmit();
      }
    });
    el.mic.addEventListener('click', toggleListening);
    el.stopSpeaking.addEventListener('click', stopSpeaking);
    el.exportButton.addEventListener('click', exportConversation);
    el.shareCreate.addEventListener('click', createShareLink);
    el.shareCopy.addEventListener('click', copyShareLink);
    el.shareNative.addEventListener('click', nativeShare);
    el.shareDelete.addEventListener('click', deleteShareLink);
    el.shareClose.addEventListener('click', closeShareDialog);
    el.shareLinkInput.addEventListener('focus', () => el.shareLinkInput.select());
    // Clicking the backdrop closes the dialog, like other share sheets.
    el.shareDialog.addEventListener('click', (event) => {
      if (event.target === el.shareDialog) closeShareDialog();
    });
    el.shareDialog.addEventListener('close', () => shareState.returnFocus?.focus());
    el.langSelect.addEventListener('change', () => {
      writePref('localStorage', LANG_KEY, el.langSelect.value);
      updateLanguageNotice();
    });
    el.speakToggle.checked = readPref('localStorage', SPEAK_KEY, 'false') === 'true';
    el.speakToggle.addEventListener('change', () => {
      writePref('localStorage', SPEAK_KEY, String(el.speakToggle.checked));
      updateLanguageNotice();
    });
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', updateLanguageNotice);
    }
  }

  async function init() {
    try {
      const response = await fetch('/api/companion/config');
      if (!response.ok) throw new Error('config unavailable');
      state.config = await response.json();
    } catch {
      el.launcher.disabled = true;
      el.launcher.textContent = 'Companion unavailable';
      return;
    }
    state.languages = Object.fromEntries(state.config.languages.map((lang) => [lang.code, lang]));
    state.speech = window.WitsPathSpeech.createLanguageLayer(state.config);
    wire();
    populateLanguages();
    el.launcher.hidden = false;
  }

  init();
})();
