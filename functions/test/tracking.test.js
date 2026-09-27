'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../src/api');
const { TRACKING } = require('../src/config');
const { createTrip, recordLocation, endTrip, viewTrip } = require('../src/tracking/trips');
const { distanceMetres } = require('../src/geo/geo');
const { makeStore, makeDeps } = require('./helpers');

const ADMIN_TOKEN = 'test-admin-token-123';
// A pin inside the Braamfontein campus outline from OpenStreetMap.
const DESTINATION = { lat: -26.1905, lng: 28.0265 };

function offsetNorth(point, metres) {
  return { lat: point.lat + metres / 111320, lng: point.lng };
}

function apiFor(store) {
  const deps = makeDeps([], { store });
  return createApi({
    store,
    routing: deps.routing,
    log: () => {},
    getAnthropic: () => deps.anthropic,
    getVulavulaKey: () => '',
    getAdminToken: () => ADMIN_TOKEN,
    verifyUser: async () => null
  });
}

async function pinPlace(api, overrides = {}) {
  const response = await api({
    method: 'POST',
    path: '/api/admin/places',
    headers: { 'x-admin-token': ADMIN_TOKEN },
    body: {
      name: 'Commerce Library (accessible entrance)',
      campusId: 'braamfontein',
      lat: DESTINATION.lat,
      lng: DESTINATION.lng,
      kind: 'accessible_entrance',
      accessibleEntrance: true,
      pinnedBy: 'Thandi M. (WitsPath team)',
      ...overrides
    }
  });
  return response;
}

async function tripAt(store, now) {
  const api = apiFor(store);
  const placeId = (await pinPlace(api)).json.id;
  return createTrip(store, { displayName: 'Lindiwe', placeId }, now);
}

test('geo: straight-line distance is accurate enough for campus scale', () => {
  const d = distanceMetres(DESTINATION, offsetNorth(DESTINATION, 100));
  assert.ok(Math.abs(d - 100) < 0.5, `got ${d}`);
});

test('admin places: token required; pins are validated and published only with a pinner', async () => {
  const store = makeStore();
  const api = apiFor(store);

  const noToken = await api({ method: 'POST', path: '/api/admin/places', headers: {}, body: {} });
  assert.equal(noToken.status, 401);
  const wrong = await api({ method: 'GET', path: '/api/admin/places', headers: { 'x-admin-token': 'guess' } });
  assert.equal(wrong.status, 401);

  const created = await pinPlace(api);
  assert.equal(created.status, 201);
  assert.equal(created.json.verifiedBy, 'Thandi M. (WitsPath team)');

  const offCampus = await pinPlace(api, { lat: -33.9249, lng: 18.4241 }); // Cape Town
  assert.equal(offCampus.status, 400);
  assert.match(offCampus.json.message, /too far/);
  const noPinner = await pinPlace(api, { pinnedBy: '  ' });
  assert.equal(noPinner.status, 400);

  const listed = await api({ method: 'GET', path: '/api/places', headers: {}, query: { campus: 'braamfontein' } });
  assert.equal(listed.json.places.length, 1);
  assert.deepEqual(Object.keys(listed.json.places[0]).sort(), ['accessibleEntrance', 'campusId', 'id', 'kind', 'lat', 'lng', 'name']);

  const removed = await api({ method: 'DELETE', path: `/api/admin/places/${created.json.id}`, headers: { 'x-admin-token': ADMIN_TOKEN } });
  assert.equal(removed.status, 204);
});

test('admin is disabled entirely when no admin token is configured', async () => {
  const store = makeStore();
  const deps = makeDeps([], { store });
  const api = createApi({ store, routing: deps.routing, getAnthropic: () => null, getVulavulaKey: () => '', getAdminToken: () => '', verifyUser: async () => null });
  const response = await api({ method: 'GET', path: '/api/admin/places', headers: { 'x-admin-token': '' } });
  assert.equal(response.status, 503);
});

test('campuses endpoint lists all Wits campuses without internal fields', async () => {
  const api = apiFor(makeStore());
  const { json } = await api({ method: 'GET', path: '/api/campuses', headers: {} });
  assert.ok(json.campuses.length >= 4);
  for (const campus of json.campuses) {
    assert.deepEqual(Object.keys(campus).sort(), ['center', 'id', 'name', 'zoom']);
  }
});

test('trips: only verified pinned places can be destinations', async () => {
  const store = makeStore();
  assert.equal((await createTrip(store, { displayName: 'Lindiwe', placeId: 'made-up' })).error, 'unknown_destination');
  const api = apiFor(store);
  const placeId = (await pinPlace(api)).json.id;
  assert.equal((await createTrip(store, { displayName: '   ', placeId })).error, 'invalid_name');
});

test('trips: on the way -> near -> arrived needs precise fixes twice in a row', async () => {
  const store = makeStore();
  const t0 = new Date('2026-09-27T10:00:00Z');
  const trip = await tripAt(store, t0);
  const at = (seconds) => new Date(t0.getTime() + seconds * 1000);
  const send = (point, accuracyM, seconds) => recordLocation(store, trip.tripId, trip.ownerToken, { ...point, accuracyM }, at(seconds));

  assert.equal((await viewTrip(store, trip.tripId, 'en', at(1))).state, 'waiting');

  await send(offsetNorth(DESTINATION, 400), 10, 5);
  let view = await viewTrip(store, trip.tripId, 'en', at(6));
  assert.equal(view.state, 'on_the_way');
  assert.equal(view.messages[0].text, 'Lindiwe is on the way to Commerce Library (accessible entrance).');
  assert.match(view.messages[1].text, /^About 400 metres from .* in a straight line\.$/);
  assert.equal(view.messages[2].text, 'Last update just now.');

  await send(offsetNorth(DESTINATION, 60), 10, 20);
  assert.equal((await viewTrip(store, trip.tripId, 'en', at(21))).state, 'near');

  // Close, but GPS accuracy too poor to confirm arrival.
  await send(offsetNorth(DESTINATION, 5), 80, 30);
  await send(offsetNorth(DESTINATION, 5), 80, 40);
  view = await viewTrip(store, trip.tripId, 'en', at(41));
  assert.equal(view.state, 'near');
  assert.ok(view.messages.some((message) => message.phraseKey === 'tracking_low_accuracy'));

  // One precise fix is not enough...
  await send(offsetNorth(DESTINATION, 8), 8, 50);
  assert.equal((await viewTrip(store, trip.tripId, 'en', at(51))).state, 'near');
  // ...two in a row is.
  const arrived = await send(offsetNorth(DESTINATION, 6), 8, 60);
  assert.equal(arrived.trip.state, 'arrived');
  view = await viewTrip(store, trip.tripId, 'en', at(61));
  assert.equal(view.messages[0].text, 'Lindiwe has arrived at Commerce Library (accessible entrance).');
  // Position is deleted on arrival.
  assert.equal(view.position, null);
  assert.equal(store.trips.get(trip.tripId).lastFix, null);

  // Updates after arrival are refused.
  assert.equal((await send(offsetNorth(DESTINATION, 300), 10, 70)).error, 'trip_not_active');
});

test('trips: stale position says "last seen", not "on the way"', async () => {
  const store = makeStore();
  const t0 = new Date('2026-09-27T10:00:00Z');
  const trip = await tripAt(store, t0);
  await recordLocation(store, trip.tripId, trip.ownerToken, { ...offsetNorth(DESTINATION, 250), accuracyM: 12 }, new Date(t0.getTime() + 5000));
  const later = new Date(t0.getTime() + 5000 + TRACKING.STALE_AFTER_MS + 3 * 60000);
  const view = await viewTrip(store, trip.tripId, 'en', later);
  assert.equal(view.state, 'stale');
  assert.match(view.messages[0].text, /^Lindiwe was last seen about 250 metres from/);
  assert.ok(!view.messages.some((message) => /on the way/.test(message.text)));
  assert.match(view.messages[view.messages.length - 1].text, /^Last update \d+ minutes ago\.$/);
});

test('trips: sender controls, token checks, expiry and privacy of the viewer payload', async () => {
  const store = makeStore();
  const t0 = new Date('2026-09-27T10:00:00Z');
  const trip = await tripAt(store, t0);
  const fix = { ...offsetNorth(DESTINATION, 300), accuracyM: 10 };

  assert.equal((await recordLocation(store, trip.tripId, 'wrong-token', fix, t0)).error, 'not_found');
  assert.equal((await recordLocation(store, trip.tripId, trip.ownerToken, { lat: 95, lng: 0, accuracyM: 5 }, t0)).error, 'invalid_location');
  assert.equal(
    (await recordLocation(store, trip.tripId, trip.ownerToken, { lat: -33.9249, lng: 18.4241, accuracyM: 5 }, t0)).error,
    'location_out_of_range'
  );

  await recordLocation(store, trip.tripId, trip.ownerToken, fix, new Date(t0.getTime() + 1000));
  const view = await viewTrip(store, trip.tripId, 'en', new Date(t0.getTime() + 2000));
  assert.deepEqual(Object.keys(view).sort(), ['destination', 'displayName', 'expiresAt', 'messages', 'position', 'state']);
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes(trip.ownerToken));
  assert.ok(!/ownerTokenHash|arrivalStreak|placeId/.test(serialized));

  assert.equal((await endTrip(store, trip.tripId, 'wrong-token', 'stopped')).error, 'not_found');
  const stopped = await endTrip(store, trip.tripId, trip.ownerToken, 'stopped', new Date(t0.getTime() + 3000));
  assert.equal(stopped.trip.state, 'stopped');
  const stoppedView = await viewTrip(store, trip.tripId, 'en', new Date(t0.getTime() + 4000));
  assert.equal(stoppedView.messages[0].text, 'Lindiwe stopped sharing their trip.');
  assert.equal(stoppedView.position, null);

  const other = await tripAt(store, t0);
  const expired = await viewTrip(store, other.tripId, 'en', new Date(t0.getTime() + TRACKING.TRIP_TTL_MS + 1));
  assert.equal(expired.state, 'ended');
  assert.equal(expired.messages[0].text, 'This live trip has ended.');
});

test('trips: sender can confirm arrival themselves', async () => {
  const store = makeStore();
  const trip = await tripAt(store, new Date());
  const result = await endTrip(store, trip.tripId, trip.ownerToken, 'arrived');
  assert.equal(result.trip.state, 'arrived');
});

test('trips: status lines fall back to verified English for unverified languages', async () => {
  const store = makeStore();
  const trip = await tripAt(store, new Date());
  const view = await viewTrip(store, trip.tripId, 'zu');
  assert.equal(view.messages[0].lang, 'en');
  store.templates.zu.tracking_waiting = { text: 'Silindele indawo ka-{name}.', verifiedBy: 'reviewer:test' };
  const verified = await viewTrip(store, trip.tripId, 'zu');
  assert.deepEqual([verified.messages[0].text, verified.messages[0].lang], ['Silindele indawo ka-Lindiwe.', 'zu']);
});

test('trips API: create, update, view and end over HTTP', async () => {
  const store = makeStore();
  const api = apiFor(store);
  const placeId = (await pinPlace(api)).json.id;
  const created = await api({ method: 'POST', path: '/api/trips', headers: {}, body: { displayName: 'Sipho <script>', placeId } });
  assert.equal(created.status, 201);
  assert.match(created.json.path, /^\/track\/[A-Za-z0-9_-]+$/);

  const { tripId, ownerToken } = created.json;
  const moved = await api({
    method: 'POST',
    path: `/api/trips/${tripId}/location`,
    headers: { 'x-owner-token': ownerToken },
    body: { ...offsetNorth(DESTINATION, 500), accuracyM: 15 }
  });
  assert.equal(moved.json.state, 'on_the_way');

  const viewed = await api({ method: 'GET', path: `/api/trips/${tripId}`, headers: {}, query: { lang: 'en' } });
  assert.equal(viewed.json.displayName, 'Sipho script');
  assert.equal(viewed.json.position.accuracyM, 15);

  const ended = await api({ method: 'POST', path: `/api/trips/${tripId}/end`, headers: { 'x-owner-token': ownerToken }, body: { reason: 'stopped' } });
  assert.equal(ended.json.state, 'stopped');
  assert.equal((await api({ method: 'GET', path: '/api/trips/doesNotExist123', headers: {} })).status, 404);
});
