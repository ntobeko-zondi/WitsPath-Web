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
    exportMobility: document.getElementById('companionExportMobility')
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

  function addRouteCard(route) {
    const item = make('li', 'companion-message companion-assistant');
    const card = make('article', 'companion-route');
    const headingId = `route-${Date.now()}`;
    const heading = make('h3', null, `${route.from} to ${route.to}`);
    heading.id = headingId;
    card.setAttribute('aria-labelledby', headingId);
    card.appendChild(heading);

    const facts = make('p', 'companion-route-facts');
    facts.appendChild(make('span', `companion-chip ${route.accessible ? 'is-good' : 'is-warn'}`, route.accessible ? 'Step-free' : 'Not confirmed step-free'));
    facts.appendChild(make('span', 'companion-chip', `${Math.round(route.distanceM)} m`));
    if (route.travelTime) {
      facts.appendChild(make('span', 'companion-chip', `about ${route.travelTime.minutes} min (estimate)`));
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
    const shareButton = make('button', 'companion-secondary', 'Share route');
    shareButton.type = 'button';
    const shareResult = make('div', 'companion-share-result');
    shareResult.setAttribute('role', 'status');
    shareButton.addEventListener('click', () => shareRoute(shareButton, shareResult));
    actions.append(readButton, shareButton);
    card.append(actions, shareResult);

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
      const response = await fetch('/api/companion/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: readPref('sessionStorage', SESSION_KEY, null),
          text,
          inputMode: voice ? 'voice' : 'text',
          inputLang: voice?.lang || null,
          preferredLang: selectedLang()
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
    if (result.route) addRouteCard(result.route);
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

  async function shareRoute(button, output) {
    button.disabled = true;
    output.textContent = 'Creating link…';
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: readPref('sessionStorage', SESSION_KEY, null) })
      });
      if (!response.ok) throw new Error('share failed');
      const share = await response.json();
      writePref('localStorage', REVOKE_KEY_PREFIX + share.shareId, share.revokeToken);
      const url = new URL(share.path, window.location.origin).href;

      output.textContent = '';
      const link = make('a', null, url);
      link.href = url;
      const expiry = make('p', 'companion-small', `Link works until ${new Date(share.expiresAt).toLocaleDateString()}. It shows only the route card, not this conversation.`);
      const copy = make('button', 'companion-secondary', 'Copy link');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed: select the link instead';
        }
      });
      const revoke = make('button', 'companion-secondary', 'Revoke link');
      revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        const result = await fetch(`/api/share/${encodeURIComponent(share.shareId)}`, {
          method: 'DELETE',
          headers: { 'x-revoke-token': share.revokeToken }
        });
        output.textContent = result.ok ? 'Link revoked. It no longer works.' : 'Could not revoke the link. Please try again.';
        if (!result.ok) return;
        button.disabled = false;
      });
      output.append(link, expiry, copy, revoke);
    } catch {
      output.textContent = "Couldn't create a share link. Please try again.";
      button.disabled = false;
    }
  }

  async function exportConversation() {
    const sessionId = readPref('sessionStorage', SESSION_KEY, null);
    if (!sessionId) {
      el.voiceStatus.textContent = 'There is no conversation to export yet.';
      return;
    }
    const response = await fetch('/api/companion/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        includeReports: el.exportReports.checked,
        includeMobility: el.exportMobility.checked
      })
    });
    if (!response.ok) {
      el.voiceStatus.textContent = "Couldn't export the conversation.";
      return;
    }
    const blob = new Blob([await response.text()], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'witspath-conversation.txt';
    link.click();
    URL.revokeObjectURL(link.href);
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
