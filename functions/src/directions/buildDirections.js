'use strict';

const { renderPhrase } = require('./phrases');

// Turns sharper than this are "turn"; between SLIGHT and TURN are "bear
// slightly"; below SLIGHT is "go straight". Conservative: when in doubt the
// instruction still names the next landmark, so it stays correct even if the
// angle reading is imperfect.
const SLIGHT_TURN_DEG = 25;
const TURN_DEG = 55;

/**
 * Classify the turn at `via` when walking from `prev` to `next`, using the map
 * coordinates of the route the routing service returned. Map pixels have y
 * pointing down, so a positive cross product is a clockwise (right) turn.
 */
function classifyTurn(prev, via, next) {
  const ax = via.x - prev.x;
  const ay = via.y - prev.y;
  const bx = next.x - via.x;
  const by = next.y - via.y;
  const lenA = Math.hypot(ax, ay);
  const lenB = Math.hypot(bx, by);
  if (!lenA || !lenB) {
    return 'continue_to';
  }

  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (lenA * lenB)));
  const angle = (Math.acos(cos) * 180) / Math.PI;
  const cross = ax * by - ay * bx;

  if (angle < SLIGHT_TURN_DEG) return 'go_straight';
  if (angle < TURN_DEG) return cross > 0 ? 'slight_right' : 'slight_left';
  return cross > 0 ? 'turn_right' : 'turn_left';
}

/**
 * Assemble turn-by-turn directions for a confirmed route, entirely from
 * phrase templates. The model never sees or rewrites these strings.
 *
 * @param route {{ path: [{node_id, name, type, x, y}], segments: [{distance_m}], distance_m, accessible }}
 * @param lang  requested language code
 * @param templatesByLang phrase templates keyed by lang then phrase key
 * @param travelTime optional {minutes}
 */
function buildDirections(route, lang, templatesByLang, travelTime) {
  const steps = [];
  const say = (key, params) => steps.push(renderPhrase(key, params, lang, templatesByLang));
  const path = route.path;
  const last = path[path.length - 1];

  say('route_summary', { place: last.name, distance: Math.round(route.distance_m) });
  say(route.accessible ? 'step_free_route' : 'not_step_free', {});
  if (travelTime && Number.isFinite(travelTime.minutes)) {
    say('estimated_time', { minutes: travelTime.minutes });
  }
  say('start_at', { place: path[0].name });

  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const to = path[i];
    const distance = Math.round(route.segments[i - 1].distance_m);

    if (from.type === 'ramp') {
      say('use_ramp', { place: from.name });
    }

    if (i === 1) {
      say('head_towards', { place: to.name, distance });
    } else {
      const key = hasCoordinates(path[i - 2], from, to) ? classifyTurn(path[i - 2], from, to) : 'continue_to';
      say(key, { place: to.name, distance });
    }
  }

  say('arrive', { place: last.name });

  return {
    steps,
    lang,
    fallbackToEnglish: steps.some((step) => step.fallback)
  };
}

function hasCoordinates(...nodes) {
  return nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
}

module.exports = { buildDirections, classifyTurn };
