'use strict';

// Seed Firestore with the companion's collections.
//
//   node scripts/seed-firestore.js [--graph] [--fixtures] [--campus-places <file>]
//
// Uses Application Default Credentials, or the emulator when
// FIRESTORE_EMULATOR_HOST is set. Safe to re-run:
//   - phrase_templates rows are only created if missing, so a native-speaker
//     review (text + verifiedBy) is never overwritten.
//   - places only refresh derived fields; accessibleEntrance is never reset.
//   --graph     also load data/wits-west-map.json into the graph collections
//               (for an emulator or empty project; refuses if they have data).
//   --fixtures  load PLACEHOLDER routes into dev_route_fixtures.
//   --campus-places <file>  import places pinned on the dev server
//               (functions/.dev-data/campus-places.json).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { COLLECTIONS } = require('../src/config');
const { loadSeedData } = require('../src/store/seedData');
const { derivePlaces } = require('../src/places/derivePlaces');
const { buildSeedTemplates } = require('../src/directions/phrases');
const { validatePlace } = require('../src/places/campusPlaces');
const fs = require('fs');

const args = new Set(process.argv.slice(2));

async function commitInChunks(db, operations) {
  for (let i = 0; i < operations.length; i += 450) {
    const batch = db.batch();
    operations.slice(i, i + 450).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

async function seedGraph(db, graph) {
  for (const name of [COLLECTIONS.graphNodes, COLLECTIONS.graphEdges, COLLECTIONS.graphFloors]) {
    const existing = await db.collection(name).limit(1).get();
    if (!existing.empty) throw new Error(`Refusing to seed graph: ${name} already has data.`);
  }
  const ops = [
    ...graph.nodes.map(({ nodeId, ...data }) => (batch) => batch.set(db.collection(COLLECTIONS.graphNodes).doc(nodeId), data)),
    ...graph.edges.map(({ edgeId, ...data }) => (batch) => batch.set(db.collection(COLLECTIONS.graphEdges).doc(edgeId), data)),
    ...graph.floors.map(({ floorId, ...data }) => (batch) => batch.set(db.collection(COLLECTIONS.graphFloors).doc(floorId), data))
  ];
  await commitInChunks(db, ops);
  console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
}

async function seedPlaces(db, graph, aliases) {
  const places = derivePlaces(graph, aliases);
  const refs = places.map((place) => db.collection(COLLECTIONS.places).doc(place.id));
  const snapshots = await db.getAll(...refs);
  const ops = places.map((place, index) => {
    const { id, accessibleEntrance, ...derived } = place;
    return snapshots[index].exists
      ? (batch) => batch.set(refs[index], derived, { merge: true })
      : (batch) => batch.set(refs[index], { ...derived, accessibleEntrance });
  });
  await commitInChunks(db, ops);
  console.log(`places: ${places.length}`);
}

async function seedPhraseTemplates(db) {
  const rows = buildSeedTemplates();
  const refs = rows.map((row) =>
    db.collection(COLLECTIONS.phraseTemplates).doc(row.lang).collection('phrases').doc(row.key)
  );
  const snapshots = await db.getAll(...refs);
  const ops = [];
  rows.forEach((row, index) => {
    if (snapshots[index].exists) return;
    ops.push((batch) =>
      batch.set(refs[index], {
        text: row.text,
        verifiedBy: row.verifiedBy,
        verifiedAt: row.verifiedBy ? FieldValue.serverTimestamp() : null
      })
    );
  });
  await commitInChunks(db, ops);
  console.log(`phrase_templates: ${ops.length} created, ${rows.length - ops.length} already present (left untouched)`);
}

async function seedFixtures(db, fixtures) {
  const ops = fixtures.map((fixture) => (batch) =>
    batch.set(db.collection(COLLECTIONS.routeFixtures).doc(`${fixture.from}__${fixture.to}`), {
      ...fixture,
      note: 'PLACEHOLDER route data - replace with the shared routing service'
    })
  );
  await commitInChunks(db, ops);
  console.log(`dev_route_fixtures: ${fixtures.length} (placeholder)`);
}

// Import team-pinned places exported by the dev server. Every place is
// re-validated, and existing documents are never overwritten.
async function seedCampusPlaces(db, file) {
  const places = JSON.parse(fs.readFileSync(file, 'utf8'));
  const collection = db.collection(COLLECTIONS.campusPlaces);
  let created = 0;
  for (const { id, ...input } of places) {
    const validated = validatePlace({ ...input, pinnedBy: input.verifiedBy });
    if (validated.error) {
      console.warn(`skipped ${input.name || id}: ${validated.message}`);
      continue;
    }
    const ref = collection.doc(id);
    if ((await ref.get()).exists) continue;
    await ref.set({ ...validated.place, verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : new Date() });
    created += 1;
  }
  console.log(`campus_places: ${created} created from ${file}`);
}

async function main() {
  initializeApp();
  const db = getFirestore();
  const { graph, aliases, fixtures } = loadSeedData();

  if (args.has('--graph')) await seedGraph(db, graph);
  await seedPlaces(db, graph, aliases);
  await seedPhraseTemplates(db);
  if (args.has('--fixtures')) await seedFixtures(db, fixtures);
  const placesFileIndex = process.argv.indexOf('--campus-places');
  if (placesFileIndex > -1) await seedCampusPlaces(db, process.argv[placesFileIndex + 1]);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
