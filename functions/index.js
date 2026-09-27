'use strict';

// Cloud Function "companionMessage": serves every /api/** route for the
// WitsPath AI Companion (Firebase Hosting rewrites /api/** here).
//
// Secrets (never in client code or git):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set VULAVULA_API_KEY   (set to "disabled" to turn off)
// Non-secret settings (ROUTING_MODE, ROUTING_SERVICE_URL, ...) go in
// functions/.env - see functions/.env.example.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./src/config');
const { createApi } = require('./src/api');
const { FirestoreStore } = require('./src/store/firestoreStore');
const { createRoutingService } = require('./src/routing/routingService');

initializeApp();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const VULAVULA_API_KEY = defineSecret('VULAVULA_API_KEY');

const store = new FirestoreStore(getFirestore());
const routing = createRoutingService({
  mode: config.ROUTING_MODE,
  url: config.ROUTING_SERVICE_URL,
  timeoutMs: config.ROUTING_TIMEOUT_MS,
  store
});

let anthropic = null;
const api = createApi({
  store,
  routing,
  log: (event, data) => console.log(JSON.stringify({ event, ...data })),
  getAnthropic: () => {
    anthropic = anthropic || new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    return anthropic;
  },
  getVulavulaKey: () => {
    const key = VULAVULA_API_KEY.value();
    return key && key !== 'disabled' ? key : '';
  },
  verifyUser: async (headers) => {
    const match = /^Bearer (.+)$/.exec(headers.authorization || '');
    if (!match) return null;
    try {
      return (await getAuth().verifyIdToken(match[1])).uid;
    } catch {
      return null;
    }
  }
});

exports.companionMessage = onRequest(
  { secrets: [ANTHROPIC_API_KEY, VULAVULA_API_KEY], timeoutSeconds: 60, maxInstances: 10 },
  async (req, res) => {
    const result = await api({
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      body: req.body,
      rawBody: req.rawBody
    });
    res.set('Cache-Control', 'no-store');
    res.status(result.status);
    if (result.json !== undefined) res.json(result.json);
    else if (result.text !== undefined) res.type(result.contentType).send(result.text);
    else res.end();
  }
);
