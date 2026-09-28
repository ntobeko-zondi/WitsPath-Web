'use strict';

const crypto = require('crypto');
const { derivePlaces } = require('../places/derivePlaces');
const { buildSeedTemplates } = require('../directions/phrases');

/**
 * In-memory implementation of the store interface, for the local dev server
 * and tests. Same method surface as FirestoreStore.
 */
class MemoryStore {
  constructor({ graph, aliases = {}, phraseRows = buildSeedTemplates() }) {
    this.graph = graph;
    this.places = derivePlaces(graph, aliases);
    this.pathStatus = [];
    this.reports = new Map();
    this.sessions = new Map();
    this.sharedRoutes = new Map();
    this.campusPlaces = new Map();
    this.trips = new Map();
    this.users = new Map();
    this.templates = {};
    for (const row of phraseRows) {
      this.templates[row.lang] = this.templates[row.lang] || {};
      this.templates[row.lang][row.key] = { text: row.text, verifiedBy: row.verifiedBy, verifiedAt: row.verifiedAt };
    }
  }

  async getGraph() {
    return this.graph;
  }

  async getPlaces() {
    return this.places;
  }

  async getPathStatus(nodeIds) {
    const wanted = new Set(nodeIds);
    return this.pathStatus.filter((status) => wanted.has(status.nodeId));
  }

  // Test/dev helper: simulate a live path_status update.
  setPathStatus(status) {
    this.pathStatus = this.pathStatus.filter((existing) => existing.nodeId !== status.nodeId);
    this.pathStatus.push(status);
  }

  async addReport(report) {
    const id = newId();
    this.reports.set(id, { ...report });
    return id;
  }

  async listReportsByUser(userId) {
    return [...this.reports.entries()].filter(([, r]) => r.userId === userId).map(([id, r]) => ({ id, ...r }));
  }

  async listReportsForEdge(edgeId) {
    return [...this.reports.entries()].filter(([, r]) => r.edgeId === edgeId).map(([id, r]) => ({ id, ...r }));
  }

  async getEdge(edgeId) {
    const edge = this.graph.edges.find((item) => item.edgeId === edgeId);
    return edge ? { ...edge } : null;
  }

  // Changes the live graph, as a Firestore edges/{id} update would.
  async setEdgeStatus(edgeId, status) {
    const edge = this.graph.edges.find((item) => item.edgeId === edgeId);
    if (edge) edge.status = status;
  }

  async getUser(uid) {
    const user = this.users.get(uid);
    return user ? structuredClone(user) : null;
  }

  // Same semantics as Firestore set(..., { merge: true }): nested maps merge.
  async mergeUser(uid, patch) {
    const current = this.users.get(uid) || {};
    this.users.set(uid, {
      ...current,
      ...structuredClone(patch),
      preferences: { ...(current.preferences || {}), ...(patch.preferences || {}) }
    });
  }

  async getPhraseTemplates(langs) {
    const result = {};
    for (const lang of langs) {
      result[lang] = this.templates[lang] || {};
    }
    return result;
  }

  async getSession(id) {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async saveSession(id, data) {
    this.sessions.set(id, structuredClone(data));
  }

  async createSharedRoute(doc) {
    const id = newId();
    this.sharedRoutes.set(id, structuredClone(doc));
    return id;
  }

  async getSharedRoute(id) {
    const doc = this.sharedRoutes.get(id);
    return doc ? structuredClone(doc) : null;
  }

  async updateSharedRoute(id, patch) {
    const doc = this.sharedRoutes.get(id);
    if (doc) this.sharedRoutes.set(id, { ...doc, ...structuredClone(patch) });
  }

  async listCampusPlaces() {
    return [...this.campusPlaces.entries()].map(([id, place]) => ({ id, ...structuredClone(place) }));
  }

  async getCampusPlace(id) {
    const place = this.campusPlaces.get(id);
    return place ? { id, ...structuredClone(place) } : null;
  }

  async saveCampusPlace(id, place) {
    const placeId = id || newId();
    this.campusPlaces.set(placeId, structuredClone(place));
    return placeId;
  }

  async deleteCampusPlace(id) {
    return this.campusPlaces.delete(id);
  }

  async createTrip(trip) {
    const id = newId();
    this.trips.set(id, structuredClone(trip));
    return id;
  }

  async getTrip(id) {
    const trip = this.trips.get(id);
    return trip ? structuredClone(trip) : null;
  }

  async updateTrip(id, patch) {
    const trip = this.trips.get(id);
    if (trip) this.trips.set(id, { ...trip, ...structuredClone(patch) });
  }
}

// 128 bits of randomness: session and share IDs are capabilities, so they
// must not be guessable.
function newId() {
  return crypto.randomBytes(16).toString('base64url');
}

module.exports = { MemoryStore, newId };
