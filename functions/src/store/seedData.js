'use strict';

const fs = require('fs');
const path = require('path');

// Seed inputs shared by the in-memory dev store and the Firestore seed script.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SEED_DIR = path.resolve(__dirname, '..', '..', 'seed');

// The companion routes on the SAME map as the Android app. Place ids in a route card must exist in the app's map,
// so keep this file in step with app/src/main/assets/graph_data.json in the Android repository.
// public/data/wits-west-map.json is the older West Campus map that the website's own planner still uses.
const DEFAULT_GRAPH_FILE = path.join('public', 'data', 'wits-braamfontein-map.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Which map file to use: the `graphFile` argument, else the GRAPH_FILE environment variable, else the app's map.
 * A relative path is taken from the repository root.
 */
function resolveGraphPath(graphFile) {
  const chosen = graphFile || process.env.GRAPH_FILE || DEFAULT_GRAPH_FILE;
  return path.isAbsolute(chosen) ? chosen : path.join(REPO_ROOT, chosen);
}

function loadSeedData({ graphFile } = {}) {
  return {
    graph: readJson(resolveGraphPath(graphFile)),
    aliases: readJson(path.join(SEED_DIR, 'place-aliases.json'))
  };
}

module.exports = { loadSeedData, resolveGraphPath, DEFAULT_GRAPH_FILE };
