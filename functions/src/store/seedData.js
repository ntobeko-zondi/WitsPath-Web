'use strict';

const fs = require('fs');
const path = require('path');

// Seed inputs shared by the in-memory dev store and the Firestore seed script.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GRAPH_PATH = path.join(REPO_ROOT, 'public', 'data', 'wits-west-map.json');
const SEED_DIR = path.resolve(__dirname, '..', '..', 'seed');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadSeedData() {
  return {
    graph: readJson(GRAPH_PATH),
    aliases: readJson(path.join(SEED_DIR, 'place-aliases.json'))
  };
}

module.exports = { loadSeedData };
