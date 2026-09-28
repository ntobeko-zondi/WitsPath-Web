'use strict';

// Cross-checks the real routing engine (routing/build/witspath-routing.jar)
// against the responses the other tests replay (ENGINE_ROUTES), and runs the
// website's HTTP client against it. Skipped when the engine hasn't been built
// (routing/build.ps1 or routing/build.sh) or Java isn't installed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { ENGINE_ROUTES, NODES, makeStore } = require('./helpers');
const { HttpRoutingService } = require('../src/routing/routingService');

const JAR = path.resolve(__dirname, '..', '..', 'routing', 'build', 'witspath-routing.jar');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startEngine() {
  const port = await freePort();
  const child = spawn('java', ['-jar', JAR], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { child, url };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('routing engine did not start');
}

test('real routing engine matches the recorded routes', { skip: !fs.existsSync(JAR) && 'engine not built' }, async (t) => {
  let engine;
  try {
    engine = await startEngine();
  } catch (error) {
    t.skip(`could not start the engine: ${error.message}`);
    return;
  }
  try {
    const graph = await makeStore().getGraph();
    for (const route of ENGINE_ROUTES) {
      const from = route.path[0];
      const to = route.path[route.path.length - 1];
      const response = await fetch(`${engine.url}/v1/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph, from_node_id: from, to_node_id: to, accessible: true })
      });
      const body = await response.json();
      assert.deepEqual(
        { path: body.path, edge_ids: body.edge_ids, distance_m: body.distance_m, estimated_seconds: body.estimated_seconds },
        { path: route.path, edge_ids: route.edge_ids, distance_m: route.distance_m, estimated_seconds: route.estimated_seconds },
        `${from} -> ${to}`
      );
    }

    // The website's client end-to-end against the real engine.
    const client = new HttpRoutingService({ url: `${engine.url}/v1/route`, timeoutMs: 5000 });
    const ok = await client.getRoute({ fromNodeId: NODES.msbLabs, toNodeId: NODES.genmin, accessible: true, graph });
    assert.equal(ok.distance_m, 82);
    assert.equal(ok.source, 'shared-routing-engine');

    // Block the only edge out of Genmin's side and the engine must refuse.
    const blocked = structuredClone(graph);
    for (const edge of blocked.edges) {
      if (edge.fromNodeId === NODES.genmin || edge.toNodeId === NODES.genmin) edge.status = 'flagged';
    }
    const none = await client.getRoute({ fromNodeId: NODES.msbLabs, toNodeId: NODES.genmin, accessible: true, graph: blocked });
    assert.equal(none.error, 'no_route');
  } finally {
    engine.child.kill();
  }
});
