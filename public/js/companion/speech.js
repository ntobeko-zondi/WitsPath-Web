// WitsPath Companion - voice pipeline.
//
// Provider abstraction (brief section 8). The companion UI talks only to
// LanguageLayer; no vendor is referenced anywhere else, so a new provider can
// be added by writing one class and listing it in createLanguageLayer().
//
// SpeechProvider shape:
//   id: string
//   captureMode: 'recorded' | 'live'
//   canTranscribe(lang | null): boolean     lang null = auto-detect
//   canSynthesize(lang): boolean
//   transcribe(audio: Blob | null, langHint?): Promise<{ text, lang | null }>
//   synthesize(text, lang): Promise<{ play(): Promise<void>, cancel(): void }>
//
// Deviations from the brief's interface, made because of how the providers
// actually work:
// - 'live' providers (the Web Speech API) capture the microphone themselves,
//   so they receive audio = null and are stopped with stopListening().
// - synthesize() returns a playback handle rather than an AudioBuffer: the
//   Web Speech API plays audio directly and never exposes samples, and
//   Vulavula documents no synthesis endpoint.
(function () {
  'use strict';

  const RECORDING_MIME_TYPES = [
    'audio/ogg;codecs=opus',
    'audio/mp4',
    // Chrome only records WebM. Vulavula does not list WebM as a supported
    // format; if it is rejected, the layer falls back to Web Speech.
    'audio/webm;codecs=opus'
  ];

  function pickRecordingMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
  }

  function primarySubtag(tag) {
    return String(tag || '').toLowerCase().replace('_', '-').split('-')[0];
  }

  // Lelapa AI Vulavula: speech-to-text for en/af/zu/st with auto-detection,
  // through our server so the key stays server-side.
  class VulavulaProvider {
    constructor(config) {
      this.id = 'vulavula';
      this.captureMode = 'recorded';
      this.enabled = Boolean(config.voice && config.voice.vulavulaTranscription);
      this.languages = new Set(config.languages.filter((lang) => lang.vulavulaCode).map((lang) => lang.code));
    }

    canTranscribe(lang) {
      return (
        this.enabled &&
        Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
        Boolean(pickRecordingMime()) &&
        (lang === null || this.languages.has(lang))
      );
    }

    canSynthesize() {
      return false;
    }

    async transcribe(audio, langHint) {
      const query = langHint ? `?lang=${encodeURIComponent(langHint)}` : '';
      const response = await fetch(`/api/speech/transcribe${query}`, {
        method: 'POST',
        headers: { 'content-type': audio.type },
        body: audio
      });
      if (!response.ok) throw new Error(`transcription failed (${response.status})`);
      const result = await response.json();
      return { text: result.text, lang: result.lang || null };
    }

    async synthesize() {
      throw new Error('Vulavula does not provide speech synthesis');
    }
  }

  // Browser-native Web Speech API: zero-cost fallback. Language coverage
  // depends on the browser and the voices installed on the device.
  class WebSpeechProvider {
    constructor(config) {
      this.id = 'web-speech';
      this.captureMode = 'live';
      this.bcp47 = Object.fromEntries(config.languages.map((lang) => [lang.code, lang.bcp47]));
      // Voice input is offered only for the Tier 1 languages (brief section
      // 8); browsers rarely recognise the others and we can't verify it.
      this.listenLanguages = new Set(config.languages.filter((lang) => lang.tier === 'full').map((lang) => lang.code));
      this.recognition = null;
    }

    get Recognition() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    // The browser does not tell us which recognition languages it supports.
    // English is the only one we treat as dependable; af/zu/st are
    // best-effort and the UI says so.
    canTranscribe(lang) {
      return Boolean(this.Recognition) && (lang === null || this.listenLanguages.has(lang));
    }

    voiceFor(lang) {
      if (!('speechSynthesis' in window)) return null;
      const voices = window.speechSynthesis.getVoices();
      const exact = voices.find((voice) => voice.lang.toLowerCase().replace('_', '-') === String(this.bcp47[lang]).toLowerCase());
      return exact || voices.find((voice) => primarySubtag(voice.lang) === lang) || null;
    }

    canSynthesize(lang) {
      return Boolean(this.voiceFor(lang));
    }

    transcribe(_audio, langHint) {
      const Recognition = this.Recognition;
      return new Promise((resolve, reject) => {
        const recognition = new Recognition();
        this.recognition = recognition;
        recognition.lang = (langHint && this.bcp47[langHint]) || 'en-ZA';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        let text = '';
        recognition.onresult = (event) => {
          text = Array.from(event.results)
            .map((result) => result[0].transcript)
            .join(' ')
            .trim();
        };
        recognition.onerror = (event) => reject(new Error(event.error || 'recognition error'));
        recognition.onend = () => {
          this.recognition = null;
          // The Web Speech API does not detect language; only report one if
          // the user told us which language they were speaking.
          resolve({ text, lang: langHint || null });
        };
        recognition.start();
      });
    }

    stopListening() {
      if (this.recognition) this.recognition.stop();
    }

    cancelListening() {
      if (this.recognition) this.recognition.abort();
    }

    async synthesize(text, lang) {
      const voice = this.voiceFor(lang);
      if (!voice) throw new Error(`no voice for ${lang}`);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      return {
        play: () =>
          new Promise((resolve) => {
            utterance.onend = resolve;
            utterance.onerror = resolve;
            window.speechSynthesis.speak(utterance);
          }),
        cancel: () => window.speechSynthesis.cancel()
      };
    }
  }

  // Chooses a provider per request. Providers are listed in preference order.
  class LanguageLayer {
    constructor(providers) {
      this.providers = providers;
      this.failed = new Set();
      this.playing = [];
    }

    transcriberFor(lang) {
      return this.providers.find((provider) => !this.failed.has(provider.id) && provider.canTranscribe(lang)) || null;
    }

    synthesizerFor(lang) {
      return this.providers.find((provider) => provider.canSynthesize(lang)) || null;
    }

    /**
     * Start capturing speech. Returns { providerId, stop(): Promise<{text, lang}>, cancel() }.
     * Throws if no provider can listen in this language.
     */
    async startListening(langHint) {
      const provider = this.transcriberFor(langHint || null);
      if (!provider) throw new Error('no_transcriber');

      if (provider.captureMode === 'live') {
        const pending = provider.transcribe(null, langHint || null);
        return {
          providerId: provider.id,
          stop: () => {
            provider.stopListening();
            return pending;
          },
          cancel: () => provider.cancelListening()
        };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: pickRecordingMime() });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const finished = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start();
      const release = () => stream.getTracks().forEach((track) => track.stop());

      return {
        providerId: provider.id,
        stop: async () => {
          recorder.stop();
          await finished;
          release();
          const audio = new Blob(chunks, { type: recorder.mimeType });
          try {
            return await provider.transcribe(audio, langHint || null);
          } catch (error) {
            // Don't keep retrying a failing vendor this page load; the next
            // attempt uses the next provider (e.g. Web Speech).
            this.failed.add(provider.id);
            throw error;
          }
        },
        cancel: () => {
          recorder.stop();
          release();
        }
      };
    }

    /** Speak `text` in `lang`. Resolves false (without speaking) if no voice exists for that language. */
    async speak(text, lang) {
      const provider = lang ? this.synthesizerFor(lang) : null;
      if (!provider) return false;
      const handle = await provider.synthesize(text, lang);
      this.playing.push(handle);
      await handle.play();
      this.playing = this.playing.filter((item) => item !== handle);
      return true;
    }

    canSpeak(lang) {
      return Boolean(lang && this.synthesizerFor(lang));
    }

    cancelSpeech() {
      this.playing.forEach((handle) => handle.cancel());
      this.playing = [];
    }
  }

  window.WitsPathSpeech = {
    createLanguageLayer(config) {
      return new LanguageLayer([new VulavulaProvider(config), new WebSpeechProvider(config)]);
    }
  };
})();
