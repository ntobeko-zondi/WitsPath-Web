'use strict';

const config = require('../config');
const { LANGUAGES, fromVulavulaCode } = require('../language/languages');

// Server-side proxy for Lelapa AI's Vulavula speech-to-text, so the Vulavula
// key never reaches the browser. Vulavula documents transcription only (no
// speech synthesis), so spoken replies use the browser's voices instead.
// API reference: https://docs.lelapa.ai/transcribe/sync

const EXTENSIONS = {
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/opus': 'opus'
};

async function transcribe({ apiKey, audio, contentType, langHint, fetchImpl = fetch }) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[mime];
  if (!extension) {
    return { error: 'unsupported_audio', status: 415 };
  }

  const url = new URL(config.VULAVULA_TRANSCRIBE_URL);
  const vulavulaCode = LANGUAGES[langHint]?.vulavulaCode;
  // Omitting lang_code asks Vulavula to auto-detect the language.
  if (vulavulaCode) url.searchParams.set('lang_code', vulavulaCode);

  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), `speech.${extension}`);

  let body;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'X-CLIENT-TOKEN': apiKey },
      body: form,
      signal: AbortSignal.timeout(30000)
    });
    body = await response.json();
    if (!response.ok) return { error: 'transcription_failed', status: 502 };
  } catch (error) {
    return { error: 'transcription_unreachable', status: 502 };
  }

  if (body.error_message || typeof body.transcription_text !== 'string') {
    return { error: 'transcription_failed', status: 502 };
  }
  return { text: body.transcription_text.trim(), lang: fromVulavulaCode(body.language_code) };
}

module.exports = { transcribe };
