# WitsPath-Web

Website for WitsPath, accessible indoor navigation for Wits University, with an embedded **AI Companion**. The companion finds places, gives accessible routes and travel-time estimates, takes reports of path issues, shares routes, and accepts voice input in South African languages.

## Layout

```
index.html, app/, css/, data/   existing route-planner site
companion/                      companion widget (browser): chat UI, voice layer, share page script
share.html                      public /share/{id} route-card page
trip.html, track.html           live trip: sender page, and viewer page (/track/{id})
tracking/                       live trip scripts, styles, map adapter (OpenStreetMap now, Google later)
admin/                          campus places admin page (/admin/)
vendor/leaflet-1.9.4/           map library (BSD-2 licence)
functions/                      Cloud Function "companionMessage" (all /api/** routes)
  src/companion/                tool-use loop, system prompt, numeric grounding guard
  src/tools/                    tool contracts + handlers (find_place, get_route, ...)
  src/routing/                  routing interface - NO pathfinding here (see below)
  src/directions/               Tier 2 phrase templates + deterministic directions
  src/language/                 11 official languages and their honest capability tier
  src/share/                    route-card sharing, transcript export
  src/speech/                   Vulavula speech-to-text proxy
  src/store/                    Firestore store + in-memory store (dev/tests)
  seed/                         place aliases, PLACEHOLDER route fixtures
  scripts/                      seed Firestore, client-bundle key scan, live eval
firebase.json                   hosting + /api/** and /share/** rewrites
firestore.companion.rules       rules to MERGE into the Android app's rules
```

## Getting started (run it on your machine)

### One-time setup

1. Install **Git** and **Node.js 22 or newer** (check with `node --version`).
2. Clone the repo and switch to the branch with the companion and live trips (it isn't in `main` until PR #1 is merged):

   ```bash
   git clone https://github.com/ntobeko-zondi/WitsPath-Web.git
   cd WitsPath-Web
   git checkout feature/ai-companion
   ```

3. Install the server's packages:

   ```bash
   npm --prefix functions install
   ```

4. Create `functions/.secret.local` with your own keys. It is git-ignored and never deployed:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ADMIN_API_TOKEN=any-long-random-text
   # VULAVULA_API_KEY=...   optional
   ```

   Share keys through a password manager, never in the repo or in chat. Never put keys in `functions/.env`: Firebase deploys that file with the function.

### Every time

```bash
npm --prefix functions run dev
```

Open **http://localhost:5173**:

| Page | URL |
|---|---|
| Main site + AI companion | `/` |
| Share a live trip | `/trip.html` |
| Pin campus places | `/admin/` (log in with your `ADMIN_API_TOKEN`) |

Always open the site through this server. Double-clicking `index.html` or using VS Code Live Server won't work, because the pages need the server's `/api` routes.

Before pushing, run the tests (no API key needed):

```bash
npm --prefix functions test
```

### What works without keys

| Missing | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Pages load, but the companion says it's unavailable |
| `ADMIN_API_TOKEN` | The admin page is switched off |
| `VULAVULA_API_KEY` | Voice input uses the browser's built-in recognition (Chrome/Edge) |

### Things to know

- **Data is per computer.** The dev server keeps chats, share links and trips in memory, and they disappear on restart. Pinned campus places are saved to `functions/.dev-data/campus-places.json` on your machine only. To share pins, send that file to teammates (same folder) until the shared Firebase project exists.
- **Routes are placeholders.** Locally the companion can only route 5 hand-picked place pairs (`ROUTING_MODE=fixture`). Anything else answers "can't confirm a route". That's expected until the shared routing service exists.
- **Testing on a phone needs HTTPS.** Browsers only allow GPS and the microphone on `localhost` or HTTPS. On a phone, `http://<laptop-IP>:5173` loads, but live trips and voice won't work. Use an HTTPS tunnel instead, e.g. `cloudflared tunnel --url http://localhost:5173` or ngrok, and open the address it prints.
- **Port already in use?** In PowerShell: `$env:PORT=5174`, then start the server again.

## Deploy

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set VULAVULA_API_KEY      # or the value "disabled"
firebase functions:secrets:set ADMIN_API_TOKEN       # long random string, or "disabled"
cp functions/.env.example functions/.env             # set ROUTING_MODE etc.
node functions/scripts/seed-firestore.js             # places + phrase_templates
firebase deploy --only hosting,functions:companion
node functions/scripts/check-client-bundle.js https://<site>.web.app
```

Merge `firestore.companion.rules` into the Android project's rules. Every companion collection is server-only.

## How the non-negotiables are met

| Constraint | Implementation |
|---|---|
| Model never invents route/distance/time | Routes come only from `get_route`. `get_travel_time` rejects any distance that did not come from `get_route` in this conversation. After each reply, a numeric guard replaces it with a safe message if it contains a number not traceable to a tool result or the user. Directions are rendered from templates on the server; the model never writes them. |
| API key server-side only | The key is read from Firebase Secrets inside the function. The browser only calls `/api/**`. `scripts/check-client-bundle.js` scans every publishable file (and the deployed site, when given a URL) and was checked against a planted fake key. |
| Honest language support | The language menu, notices and per-reply badges show each language's tier *and* whether its directions are verified. Limited languages are flagged on every reply, and voice input is offered only for Tier 1 languages. |
| Don't fork pathfinding | `src/routing` has no search algorithm. The modes are the shared service over HTTP (target), a labelled placeholder fixture lookup (dev), and `unavailable`, which is the production default and fails closed. |
| WCAG AA | Keyboard operable, including Esc to close with focus returned. Labelled controls, `role=log` live region, per-message `lang` attributes, AA contrast in both themes. Every voice action has a typed/visual equivalent. |

## Test cases (brief section 11)

| # | Test | Status |
|---|---|---|
| 1 | No hallucination | Deterministic: passing (`companion.test.js`, `tools.test.js`). Live model: `npm run eval:live`, **not yet run** (no key available when built). |
| 2 | Tone adaptation | Live only: `npm run eval:live` (heuristic check, prints the reply for review). **Not yet run.** |
| 3 | Out-of-scope decline | `find_place("ATM")` returns no matches: passing. Model wording: live eval, **not yet run**. |
| 4 | Voice round trip (EN) | Manual. Speak a query with DevTools open; the widget logs `voice round trip N ms (budget 8000 ms)` and stores timings in `window.witspathCompanionMetrics`. **Not yet run.** |
| 5 | isiZulu tier | Deterministic: passing. Live: eval script. |
| 6 | Xitsonga flagged | Deterministic + UI verified in the browser. Live: eval script. |
| 7 | Share flow | Deterministic + verified in the browser (create, view, revoke). |
| 8 | Key not in bundle | `npm run check:bundle`: passing locally. Re-run against the deployed URL. |

## Live trips (all Wits campuses)

Someone heading to a campus place can share a live link. People following it see a map and status lines such as "Lindiwe is on the way to …", "Lindiwe is near …", "Lindiwe has arrived at …" and "Last update 3 minutes ago".

| Page | Who | What |
|---|---|---|
| `/trip.html` | Sender | Picks a destination, types a display name, shares location. Share by Copy/WhatsApp/Email/SMS. "I've arrived" / "Stop sharing". |
| `/track/{id}` | Anyone with the link | Map plus status lines. Refreshes every 5 seconds (30 while the tab is hidden). |
| `/admin/` | WitsPath team | Pins buildings and accessible entrances per campus. Needs `ADMIN_API_TOKEN`. |

How it behaves:
- **Destinations** are only places the team has pinned (`campus_places`, each recording who pinned it). Campus centres in `functions/seed/campuses.json` set the starting map view only and are never destinations.
- **Status lines** are rendered on the server from `phrase_templates` (the `tracking_*` keys), with the same verified-translation gate as directions. The model never writes them.
- **Arrival** is announced only after 2 consecutive fixes within 20 metres at 30-metre accuracy or better, or when the sender taps "I've arrived".
- **Stale positions:** if no update arrives for 2 minutes, followers see "was last seen…", not "is on the way".
- **Privacy:** only the latest position is stored. It is deleted on arrival or stop, and trips end after 2 hours. The sender controls the trip with a secret token kept in their browser.
- **Maps:** OpenStreetMap tiles via Leaflet (`vendor/leaflet-1.9.4`, BSD-2), accessed only through `tracking/map-adapter.js`.

Dev: set `ADMIN_API_TOKEN` in `functions/.secret.local` to use `/admin/`. Pins are saved to `functions/.dev-data/campus-places.json` (git-ignored). Import them into Firestore with:

```bash
node functions/scripts/seed-firestore.js --campus-places functions/.dev-data/campus-places.json
```

Deploy: `firebase functions:secrets:set ADMIN_API_TOKEN`.

Live-trip follow-ups:
- **Google Maps:** implement `createGoogleMap()` in `tracking/map-adapter.js` with a Maps JavaScript API key restricted to your domains, then set `window.WITSPATH_MAP_PROVIDER = 'google'`.
- **OSM tile usage policy:** fine for development and light use. Production traffic needs a tile provider.
- **Pin every campus:** nothing is pinned yet, so the sender page shows "No destinations" until the team adds places.
- **Admin access:** replace the shared admin token with Firebase Auth plus an admin claim.
- **Sending from the Android app:** browsers stop sharing when the page is closed or the phone is locked. The Android app can share in the background.
- **Walking distance:** distances are straight-line. Showing walking distance and ETA needs the shared routing service to work with GPS positions.

## Blocking follow-ups

1. **Shared routing service.** Extract the Android app's Java A* into a service that implements the HTTP contract in `functions/src/routing/routingService.js`. Then set `ROUTING_MODE=http` and delete the fixture mode. Until then the companion can only route the five placeholder pairs in `functions/seed/route-fixtures.json`, and every such route is labelled as placeholder in the UI. Note: `app/routing.js`, the existing web planner, is already a JavaScript fork of A* and should move to the same service.
2. **Confirm Firestore names.** Check the graph collection names (`nodes`/`edges`/`floors`) and `reports` against the Android app (`functions/.env`).
3. **Native-speaker review of `phrase_templates`.** Fill in `text` + `verifiedBy` + `verifiedAt` per language at `phrase_templates/{lang}/phrases/{key}`. Nothing is shown until `verifiedBy` is set; until then directions fall back to English and the UI says so.
4. **Entrance accessibility data.** The graph has no `accessibleEntrance`, so `find_place` reports entrances as unverified.

## Decisions and deviations

- **Starter files.** `witspath-companion-function.js` and `witspath-companion-widget.html` were not available, so the function and widget were built from scratch following the brief.
- **Phrase template path.** Stored at `phrase_templates/{lang}/phrases/{key}`. The brief's `phrase_templates/{lang}/{key}` is not a valid Firestore document path.
- **`declare_language` tool.** An internal tool through which the model reports its reply language. Precedence: user's explicit choice > model declaration > speech recogniser. If none applies, the UI shows "Language not confirmed".
- **Vulavula.** It documents speech-to-text only (`POST /v1/transcribe/sync`), with no synthesis. Spoken replies therefore use the device's voices, and when a language has no voice the widget says so instead of reading it in the wrong voice. `SpeechProvider.synthesize` returns a playback handle rather than an `AudioBuffer`, and Web Speech captures the microphone itself. Both deviations are documented in `companion/speech.js`.
- **Travel-time speeds.** Deliberately conservative: 0.8 m/s wheelchair, 1.1 m/s ambulatory, rounded up. The default profile is wheelchair.
- **Shared links** expose only `from, to, distanceM, accessible, steps, createdAt, expiresAt`. They expire after 30 days and are revocable with a token kept in the creator's browser.
- **Transcript export** is opt-in. Report content and mobility mentions are removed unless the user ticks the matching boxes. Mobility redaction is keyword-based and best-effort.

The West Campus route planner uses a locally rendered SVG map and loads route data from `data/wits-west-map.json`. Dark mode is saved between visits, and step-by-step directions appear after starting navigation.
