'use strict';

const { buildDirections } = require('../directions/buildDirections');
const { isKnownLanguage, SOURCE_LANGUAGE } = require('../language/languages');
const { newId } = require('../store/memoryStore');

/**
 * The route card shown by the companion, the route planner and share links:
 * facts from the routing engine plus Tier 2 directions from verified phrase
 * templates. Nothing here is model-generated.
 *
 * @param route  a route from the routing service (see routingService.js)
 * @param lang   requested directions language
 * @param travelTime optional { minutes } (always labelled an estimate)
 */
async function buildRouteCard(store, route, lang, travelTime) {
  const directionsLang = lang && isKnownLanguage(lang) ? lang : SOURCE_LANGUAGE;
  const templates = await store.getPhraseTemplates([...new Set([directionsLang, SOURCE_LANGUAGE])]);
  const time = travelTime && Number.isFinite(travelTime.minutes) ? { minutes: travelTime.minutes, basis: 'estimate' } : null;
  const directions = buildDirections(route, directionsLang, templates, time);

  return {
    // Lets the user share this exact card, not just the latest route.
    routeId: newId(),
    from: route.path[0].name,
    to: route.path[route.path.length - 1].name,
    fromNodeId: route.path[0].node_id,
    toNodeId: route.path[route.path.length - 1].node_id,
    distanceM: route.distance_m,
    accessible: route.accessible,
    steps: directions.steps.map(({ phraseKey, params, text, lang: stepLang, pointIndex }) => ({
      phraseKey,
      params,
      text,
      lang: stepLang,
      pointIndex
    })),
    // Map-pixel positions for drawing the route on the campus map.
    points: route.path.map(({ node_id: nodeId, name, x, y }) => ({ nodeId, name, x, y })),
    edgeIds: route.segments.map((segment) => segment.edge_id),
    directionsLang,
    fallbackToEnglish: directions.fallbackToEnglish,
    routingSource: route.source,
    travelTime: time
  };
}

/** Minutes shown for an engine estimate: rounded up, never below 1. */
function estimateMinutes(seconds) {
  return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : null;
}

module.exports = { buildRouteCard, estimateMinutes };
