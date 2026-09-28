# WitsPath routing engine

The single source of truth for routes, shared by the Android app and the website. It is the Android app's A* (`PathFinder`) and travel-time estimator, extracted into a plain-Java module with no Android dependencies.

```
routing/
  core/      the engine: CampusGraph, Node, Edge, Floor, PathFinder, TravelTimeEstimator
  service/   tiny HTTP server around the engine (website uses it via the Cloud Function)
  test/      plain-Java tests (includes the Android TravelTimeEstimatorTest cases)
  build.ps1 / build.sh   compile + test + package with plain JDK tools (JDK 11+)
  Dockerfile             container for Google Cloud Run
  cloudbuild.yaml        builds that container with Cloud Build
```

## Build and test

```bash
./routing/build.sh        # macOS / Linux
```

```powershell
./routing/build.ps1       # Windows
```

This produces:
- `routing/build/witspath-routing.jar`: the service (`java -jar routing/build/witspath-routing.jar`, port 8081)
- `routing/build/witspath-routing-core.jar`: the engine only, for the Android app

The website's dev server (`npm --prefix functions run dev`) starts the service automatically when the jar exists.

## API

`POST /v1/route`

```json
{
  "graph": { "floors": [], "nodes": [], "edges": [] },
  "from_node_id": "nd_mu83zm0ga",
  "to_node_id": "nd_mu842ho1e",
  "accessible": true,
  "speed_multiplier": 1.0
}
```

- `200`: `{ path, edge_ids, distance_m, accessible, estimated_seconds, blocked_segments, engine }`
- `422`: `{ error: "no_route", message }`
- `400`: bad request

The service is stateless. The caller (the website's Cloud Function) sends the current graph from Firestore, including live edge statuses, so the service needs no database access or credentials.

`GET /health` returns `{ "status": "ok" }`.

## Behaviour

It is the same algorithm as the Android app:
- Cost is edge distance in metres, with a straight-line heuristic in metres.
- Ties are broken by load order.
- Edges whose status isn't `ok` (e.g. `flagged`, `blocked`) are skipped.
- Accessible mode skips stairs-only edges.
- Travel time is `30 s + distance × slope ÷ (1.4 m/s × speed multiplier) + floor-change penalties`.

Differences from the current Android code, all intentional fixes:

| Android today | Shared engine |
|---|---|
| Nodes and `PathFinder.errorMessage` are static globals | Owned by a `CampusGraph` / `PathFinder` instance, safe for concurrent requests |
| `Edge` has no id, so reports use `"placeholder_edge_id"` | `Edge.edgeId` is kept from the data |
| Travel time: an earlier version's `TravelTimeEstimator` used `edge.uphillFromNodeId`, which `Edge` didn't have (it didn't compile). The latest app (28 Sep 2026) removed the estimator, the uphill data and the walking-speed setting | The estimator lives here, with the uphill field. It is the website's source for travel-time estimates, and the app can adopt it from here |
| `accessibilityCost` ignored | `accessibilityCost >= 999` is impassable in accessible mode, as the graph schema note says |
| Nodes loaded from Firestore keep pixel coordinates (no floor conversion) | A node on an unknown floor is rejected, so pixels are never mistaken for metres |

## Using it from the Android app (follow-up)

1. Add `witspath-routing-core.jar` (or `routing/core` as a Gradle module) to the app.
2. Build a `CampusGraph` from the asset/Firestore JSON: convert `org.json` objects to `Map`/`List`, then call `CampusGraph.fromMap`.
3. Replace `model/PathFinder`, `Node`, `Edge`, `Floor`, `TravelTimeEstimator` usages with the `com.example.witspath.routing` classes, and `Node.getByID(id)` with `graph.node(id)`.
4. Delete the old copies, so there is exactly one engine.

## Deploy to Cloud Run

From the repository root (Firebase project `wavelets-wits-nav`, or yours). First create an Artifact Registry repository named `witspath` in the region, then:

```bash
gcloud builds submit --config routing/cloudbuild.yaml --substitutions _IMAGE=africa-south1-docker.pkg.dev/wavelets-wits-nav/witspath/routing .
```

```bash
gcloud run deploy witspath-routing --image africa-south1-docker.pkg.dev/wavelets-wits-nav/witspath/routing --region africa-south1 --no-allow-unauthenticated
```

Then give the Cloud Function's service account the **Cloud Run Invoker** role on `witspath-routing`, and set these in `functions/.env`:

```
ROUTING_MODE=http
ROUTING_SERVICE_URL=https://witspath-routing-xxxxx.a.run.app/v1/route
ROUTING_SERVICE_AUTH=id-token
```
