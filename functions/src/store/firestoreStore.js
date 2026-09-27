'use strict';

const { COLLECTIONS } = require('../config');
const { newId } = require('./memoryStore');

const GRAPH_CACHE_MS = 60 * 1000;
const FIRESTORE_IN_LIMIT = 30;

/**
 * Firestore implementation of the store interface.
 *
 * Reads the campus graph from the same collections the Android app uses
 * (names in config.COLLECTIONS - confirm them), and the companion's own
 * collections added by this feature.
 */
class FirestoreStore {
  constructor(db) {
    this.db = db;
    this.graphCache = null;
    this.placesCache = null;
  }

  async getGraph() {
    if (this.graphCache && Date.now() - this.graphCache.at < GRAPH_CACHE_MS) {
      return this.graphCache.value;
    }
    const [nodes, edges, floors] = await Promise.all([
      this.db.collection(COLLECTIONS.graphNodes).get(),
      this.db.collection(COLLECTIONS.graphEdges).get(),
      this.db.collection(COLLECTIONS.graphFloors).get()
    ]);
    const value = {
      nodes: nodes.docs.map((doc) => ({ nodeId: doc.id, ...doc.data() })),
      edges: edges.docs.map((doc) => ({ edgeId: doc.id, ...doc.data() })),
      floors: floors.docs.map((doc) => ({ floorId: doc.id, ...doc.data() }))
    };
    this.graphCache = { at: Date.now(), value };
    return value;
  }

  async getPlaces() {
    if (this.placesCache && Date.now() - this.placesCache.at < GRAPH_CACHE_MS) {
      return this.placesCache.value;
    }
    const snapshot = await this.db.collection(COLLECTIONS.places).get();
    const value = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    this.placesCache = { at: Date.now(), value };
    return value;
  }

  // Not cached: blocked-path status must be live.
  async getPathStatus(nodeIds) {
    const results = [];
    for (let i = 0; i < nodeIds.length; i += FIRESTORE_IN_LIMIT) {
      const chunk = nodeIds.slice(i, i + FIRESTORE_IN_LIMIT);
      const snapshot = await this.db.collection(COLLECTIONS.pathStatus).where('nodeId', 'in', chunk).get();
      snapshot.forEach((doc) => results.push(toPlain(doc.data())));
    }
    return results;
  }

  async addReport(report) {
    const ref = await this.db.collection(COLLECTIONS.reports).add(report);
    return ref.id;
  }

  async getPhraseTemplates(langs) {
    const result = {};
    await Promise.all(
      langs.map(async (lang) => {
        const snapshot = await this.db
          .collection(COLLECTIONS.phraseTemplates)
          .doc(lang)
          .collection('phrases')
          .get();
        result[lang] = {};
        snapshot.forEach((doc) => {
          result[lang][doc.id] = toPlain(doc.data());
        });
      })
    );
    return result;
  }

  async getRouteFixture(fromNodeId, toNodeId) {
    const collection = this.db.collection(COLLECTIONS.routeFixtures);
    const forward = await collection.where('from', '==', fromNodeId).where('to', '==', toNodeId).limit(1).get();
    if (!forward.empty) return forward.docs[0].data().path;
    const reverse = await collection.where('from', '==', toNodeId).where('to', '==', fromNodeId).limit(1).get();
    if (!reverse.empty) return [...reverse.docs[0].data().path].reverse();
    return null;
  }

  async getSession(id) {
    const doc = await this.db.collection(COLLECTIONS.chatSessions).doc(id).get();
    return doc.exists ? toPlain(doc.data()) : null;
  }

  async saveSession(id, data) {
    await this.db.collection(COLLECTIONS.chatSessions).doc(id).set(data);
  }

  async createSharedRoute(doc) {
    const id = newId();
    await this.db.collection(COLLECTIONS.sharedRoutes).doc(id).set(doc);
    return id;
  }

  async getSharedRoute(id) {
    const doc = await this.db.collection(COLLECTIONS.sharedRoutes).doc(id).get();
    return doc.exists ? toPlain(doc.data()) : null;
  }

  async updateSharedRoute(id, patch) {
    await this.db.collection(COLLECTIONS.sharedRoutes).doc(id).update(patch);
  }

  async listCampusPlaces() {
    const snapshot = await this.db.collection(COLLECTIONS.campusPlaces).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...toPlain(doc.data()) }));
  }

  async getCampusPlace(id) {
    const doc = await this.db.collection(COLLECTIONS.campusPlaces).doc(id).get();
    return doc.exists ? { id: doc.id, ...toPlain(doc.data()) } : null;
  }

  async saveCampusPlace(id, place) {
    const collection = this.db.collection(COLLECTIONS.campusPlaces);
    if (id) {
      await collection.doc(id).set(place);
      return id;
    }
    const ref = await collection.add(place);
    return ref.id;
  }

  async deleteCampusPlace(id) {
    const ref = this.db.collection(COLLECTIONS.campusPlaces).doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  }

  async createTrip(trip) {
    const id = newId();
    await this.db.collection(COLLECTIONS.liveTrips).doc(id).set(trip);
    return id;
  }

  async getTrip(id) {
    const doc = await this.db.collection(COLLECTIONS.liveTrips).doc(id).get();
    return doc.exists ? toPlain(doc.data()) : null;
  }

  async updateTrip(id, patch) {
    await this.db.collection(COLLECTIONS.liveTrips).doc(id).update(patch);
  }
}

// Convert Firestore Timestamps back to Dates, recursively.
function toPlain(value) {
  if (value && typeof value.toDate === 'function') return value.toDate();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toPlain(inner)]));
  }
  return value;
}

module.exports = { FirestoreStore };
