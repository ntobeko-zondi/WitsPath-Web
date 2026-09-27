'use strict';

// Central configuration for the companion backend. Nothing in this file is a
// secret: the Anthropic and Vulavula keys are read from the environment
// (Firebase Secrets in production, functions/.env locally) and never leave
// the server.

module.exports = {
  // Model named in the implementation brief. Override with COMPANION_MODEL.
  MODEL: process.env.COMPANION_MODEL || 'claude-haiku-4-5-20251001',

  // Replies are deliberately short (mobile/voice-first); tool inputs are tiny.
  MAX_TOKENS: 1024,
  MAX_TOOL_ITERATIONS: 6,
  MAX_USER_MESSAGE_CHARS: 1000,
  // Number of past user turns replayed to the model.
  MAX_HISTORY_TURNS: 10,
  MAX_REPORT_DESCRIPTION_CHARS: 500,
  MAX_AUDIO_BYTES: 10 * 1024 * 1024,

  // find_place guardrail: matches scoring below this are never returned.
  PLACE_MIN_CONFIDENCE: 0.6,
  PLACE_MAX_MATCHES: 5,

  SHARE_TTL_DAYS: 30,

  // Travel-time assumptions. Deliberately on the slow side so estimates err
  // towards leaving earlier. Always surfaced to the user as an estimate.
  SPEED_MPS: {
    wheelchair: 0.8,
    ambulatory: 1.1
  },

  // Routing source of truth (constraint #4 in the brief). See
  // src/routing/routingService.js.
  //   'http'        - call the shared routing service at ROUTING_SERVICE_URL
  //                   (the extracted Android A* engine). Target state.
  //   'fixture'     - PLACEHOLDER: only returns hand-seeded routes. Dev only.
  //   'unavailable' - every get_route returns an explicit error.
  // Defaults to 'unavailable' so a misconfigured deployment fails closed.
  ROUTING_MODE: process.env.ROUTING_MODE || 'unavailable',
  ROUTING_SERVICE_URL: process.env.ROUTING_SERVICE_URL || '',
  ROUTING_TIMEOUT_MS: 8000,

  VULAVULA_TRANSCRIBE_URL:
    process.env.VULAVULA_TRANSCRIBE_URL || 'https://api.lelapa.ai/v1/transcribe/sync',

  // Firestore collection names. The graph collection names must match the
  // Android app's schema. TODO(blocking): confirm these against the Android
  // project - they are inferred from data/wits-west-map.json, not verified.
  COLLECTIONS: {
    graphNodes: process.env.GRAPH_NODES_COLLECTION || 'nodes',
    graphEdges: process.env.GRAPH_EDGES_COLLECTION || 'edges',
    graphFloors: process.env.GRAPH_FLOORS_COLLECTION || 'floors',
    places: 'places',
    pathStatus: 'path_status',
    // Shared with the Android app's MyReportsActivity if the name matches.
    reports: process.env.REPORTS_COLLECTION || 'reports',
    sharedRoutes: 'shared_routes',
    chatSessions: 'chat_sessions',
    phraseTemplates: 'phrase_templates',
    // Placeholder-only data for ROUTING_MODE=fixture.
    routeFixtures: 'dev_route_fixtures'
  }
};
