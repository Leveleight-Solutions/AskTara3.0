# Asktara

Asktara is a travel-agent assistant for turning a client brief into an editable route and an agency-branded proposal. The default **Agent Studio** workflow starts at `/studio`: review what is known, shape destinations and nights, accept the structure, then add only the services and recommendations the agent requests. It uses a responsive React interface, an Express API and persistent SQLite storage.

See [Agent Studio workflow and implementation boundaries](docs/AGENT_STUDIO.md), [implementation status](docs/IMPLEMENTATION_STATUS.md), [provider requirements](docs/INTEGRATIONS.md), and [verification results](docs/VERIFICATION.md). The earlier consumer concierge remains available at `/chat` and `/trips`, including daily itineraries, discovery, saved inspiration and calendars. [Odessia research](docs/AUTHENTICATED_RESEARCH.md) records observable reference behaviour, not access to its private systems.

This README describes the current source. The [deployment record](docs/RAILWAY_DEPLOYMENT.md) identifies the release running on Railway; a feature listed here is not by itself a deployment claim.

## Run locally

Use Node.js **22.13 or newer**; Node 24 LTS is the Docker baseline. The server uses the built-in `node:sqlite` module, which may print an experimental-feature warning on some Node versions.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. Vite runs the frontend on port 5173 and forwards `/api` requests to Express on port 3001. Both processes start with `npm run dev`; `npm run dev:server` starts only Express. Keep `PORT=3001` for the included Vite proxy, or update `vite.config.ts` if changing the backend port.

Open **http://localhost:5173/studio** to work on an agent proposal. For a demo, enter: “Plan a 28-day European proposal for a fictional client: 2 adults, no children. Arrive Paris on 2026-11-18. Paris 9 nights, Berlin 9 nights and London 9 nights. Group budget AUD 12000. Prefer 4-star hotels near railway stations and quiet cultural visits. Start with the route only.” Tara reviews the brief; continue to the route, edit it and explicitly accept it before adding services.

The current project has OpenAI configured and retains LiteAPI sandbox credentials as requested. A fresh checkout can use manual Studio route/service editing, proposal generation, accounts and the local catalog without external keys. Simple local intake is available, but flexible AI review, image/PDF/audio extraction and sourced recommendations require OpenAI; supplier searches require the supplier key. Secrets stay on the server.

## Agent Studio

- **Brief first.** Natural text, pasted email/PNR, reviewed screenshot/PDF text, a public tour link or optional dictation can start the workspace. Extraction is previewed before saving. The completeness indicator shows known facts and missing questions; experienced agents can skip qualification while leaving unknown details visible.
- **Editable structure.** Destinations, nights, dates, onward transport and neighbourhood preferences appear beside chat. Drag stops or use accessible up/down controls, adjust nights, and pin explicit arrival dates. Routes support up to 20 stops, 120 nights per stop and 365 total nights. The structure must be accepted before supplier search or recommendation research; material route changes require acceptance again.
- **Quotes and existing arrangements.** Add hotels, flights, tours, cruises, transfers, insurance or placeholders manually. Saved source text stays private; explicit arrangement extraction produces unselected candidates requiring review. Selecting a LiteAPI quote adds a proposal item only—it creates no reservation, ticket, payment or insurance policy.
- **Qualified supplier search.** The same LiteAPI key serves flights and hotels, with sandbox results clearly labelled. Searches require a confirmed adult-only party; family quotes can be entered manually and reviewed. Hotel searches require exact dates, a destination country, hotel preferences and nationality. Flight searches ask for explicit airports, dates and cabin rather than inferring a return journey.
- **Optional recommendations.** Request a small sourced list of things to do or places to eat for selected destinations. New suggestions remain outside the proposal until explicitly selected. There are no automatic morning/lunch/dinner schedules in Studio.
- **Client and agency context.** Client-name history links earlier workspaces and supports deliberate reuse of background context. Each new trip starts with unknown party counts. Agency settings include custom qualifying questions, branding and GDS format hints; a format hint does not connect a reservation system.
- **Client proposals.** Review itemised or package pricing, selected services and selected recommendations in an agency-branded preview. Publish a revocable read-only link or download a PDF. Private chat, source documents, booking references, costs and margins are excluded. Package mode hides component prices. Price-validity notices default to 48 hours, while an aged proposal remains viewable with reconfirmation messaging.
- **Transparent commercial inputs.** Internal costs, margin and payment-cost allowances support the agent's pricing decision. Manual insurance prices remain agent estimates until an insurer quote API is integrated; no premium formula or card-surcharge rule is invented.

## Earlier consumer planner and shared features

- A searchable, filterable featured catalog of 13 destinations, with inspiration stays and experiences. Stay listings are fictional examples; displayed catalog prices are illustrative USD estimates.
- A clearly labeled local planner that recognizes supported destinations, dates, duration, group size, budgets, and common interests. Unknown destinations prompt clarification. Trip duration is 1–21 days, with 1–16 travelers.
- Coordinated planning stages for intake, destinations, places, stays, flights, itinerary composition, and review. GPT-6 Astra handles conversational intake, live web research, current venue-status checks and personalized composition through the OpenAI Responses API. Global destinations are resolved into trusted per-trip records, with source links throughout the itinerary; the featured catalog is not a planning limit. Deterministic curated planning remains available without an OpenAI key.
- Persistent asynchronous planning with real stage progress, cancellation, refresh recovery, duplicate-request protection, and conflict checks against newer trip edits.
- Multi-destination day allocation, pace preferences, explicit transfer-day allowances, stop durations, source-linked place details, missing-information questions, and budget review.
- Persistent trip conversations and daily schedules; editable stops, completion states, trip details, and draft/planned status. Edited stops are protected during replanning and can be unlocked. Version history can restore an earlier itinerary without restoring old share settings. Scheduling changes use the same local scheduling engine.
- Private guest sessions; registration, sign-in, and sign-out; anonymous trips and saves move into an account on registration/sign-in. Passwords use salted scrypt hashes. Session tokens are stored as hashes and use HTTP-only cookies.
- A persistent wishlist for destinations, inspiration stays, and experiences. Add a catalog stay idea or experience to a chosen day of an existing trip; the server checks destination, timing and revision conflicts, protects the new stop and deduplicates retried additions.
- Account-scoped travel preferences for pace, interests, home airport, nationality, dietary needs, accessibility needs and up to 500 characters of planning notes. Preferences seed new plans on the backend; explicit trip requests take precedence. Guest preferences transfer on sign-in when the account has no saved profile. Dietary/accessibility selections become trip briefing notes and review warnings; they are requirements to confirm with providers, not verified venue attributes. Older saved profiles receive empty defaults for the new fields.
- Account name updates, current-password-verified password changes, other-session revocation, own-data JSON export, and password-confirmed account deletion. Password changes rotate the current session, revoke others and cancel active planning requests. Deletion removes owned trips, versions, profile, saves and runs and revokes shared links.
- Revocable public sharing. Shared pages include itinerary, dates, group size, and budget, but omit the conversation, account data, private research brief, and full research report. Anyone with an enabled link can read the shared plan.
- `.ics` calendar download for dated itineraries, with local destination wall-clock times. This is file export, not direct Google/Apple Calendar synchronization.
- Date-specific flight and hotel search through one LiteAPI key, with an optional Duffel flight adapter when configured. Flight detail panels retain outbound and return legs, individual segments, carriers, local airport times and supplier-provided baggage and quote expiry. Missing details stay explicit; search results are not bookings. Sandbox offers are labeled. Missing credentials and provider failures produce explicit errors instead of invented offers.
- Sandbox checkout with owner-scoped offer references, current-price/terms review, explicit guest confirmation, persistent reservation history, status refresh and cancellation. The LiteAPI hotel flow uses its documented no-charge sandbox payment method. The flight verification path is implemented, but the configured sandbox account has not passed supplier verification; flight confirmation remains disabled. See [booking workflow and activation limits](docs/BOOKING_WORKFLOW.md).

Guest sessions expire after 30 days and depend on the browser cookie. Use an account to access saved trips from another browser; signing out starts a new guest session.

## Build and serve

```sh
npm run build
npm start
```

Open **http://localhost:3001** for a local built preview. Express serves the compiled frontend and `/api` from the same port. If you copied `.env.example`, set `APP_ORIGIN=http://localhost:3001` for this preview. Leave `NODE_ENV` unset and `COOKIE_SECURE=false` for local HTTP.

`npm run build` checks TypeScript and builds the Vite frontend. `npm start` executes the TypeScript server with `tsx`, which is a runtime dependency. The Dockerfile builds with development tools, then removes them from the runtime image.

## Railway deployment

The provisioned production target is **[asktara-production-58de.up.railway.app](https://asktara-production-58de.up.railway.app)**, in the `asktara` project/service under Leveleight's Projects. One service serves the frontend and API, with SQLite on a persistent volume mounted at `/app/data`.

See [`docs/RAILWAY_DEPLOYMENT.md`](docs/RAILWAY_DEPLOYMENT.md) for the existing project IDs, link/redeploy commands, runtime variables and volume permissions. Railway uses `RAILWAY_RUN_UID=0` for its root-owned volume; the Docker image otherwise defaults to the `node` user. After deployment, verify the application with:

```sh
npm run smoke -- https://asktara-production-58de.up.railway.app
```

The smoke check creates and removes a temporary trip. Configured AI/Places calls may consume provider quota. Add `--providers` to also probe flight and hotel search. The deployment health endpoint is `/api/health`; configured-credential flags do not prove live provider access, and the currently supplied LiteAPI credential is sandbox/test mode.

## Configuration

Copy `.env.example` to `.env` and restart the server after changes. Local scripts load `.env`; Docker receives runtime variables through `--env-file` or the hosting environment. `.env` files are excluded from Git and the Docker build context.

| Variable                    | Default / local value                            | Purpose                                                                                                                                              |
| --------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3001`                                           | Express listening port.                                                                                                                              |
| `DATABASE_PATH`             | `./data/asktara.sqlite`                          | SQLite file; the directory is created automatically. Use a durable volume in a container.                                                            |
| `APP_ORIGIN`                | `http://localhost:5173` in the example           | Allowed browser origin. In production, use the exact public HTTPS origin, without a trailing slash. Same-origin requests are also accepted.          |
| `NODE_ENV`                  | Unset locally; `production` for HTTPS deployment | Enables secure session cookies and production browser security behavior.                                                                             |
| `COOKIE_SECURE`             | `false` locally                                  | `true` enforces HTTPS cookies outside production too. `NODE_ENV=production` always enables secure cookies; `false` does not override it.             |
| `TRUST_PROXY`               | `0`                                              | Set `1` only behind one trusted reverse proxy that sanitizes forwarding headers. Used for protocol detection and IP rate limiting.                   |
| `OPENAI_API_KEY`            | Empty                                            | Enables Studio brief review, document/audio interpretation and sourced recommendations, plus the earlier concierge; no separate search key required. |
| `OPENAI_MODEL`              | `gpt-6-astra`                                    | Requested reasoning model with Responses structured output and web search. The configured account must have access.                                  |
| `GOOGLE_PLACES_API_KEY`     | Empty                                            | Enables server-side Places API (New) text search for grounded place details.                                                                         |
| `GOOGLE_MAPS_EMBED_API_KEY` | Empty                                            | Separate public browser key; restrict to Maps Embed API and exact website referrers. Enables an interactive itinerary map.                           |
| `DUFFEL_ACCESS_TOKEN`       | Empty                                            | Enables flight-offer search. `duffel_test_` tokens return visibly simulated offers.                                                                  |
| `LITEAPI_API_KEY`           | Empty                                            | One key for LiteAPI flights and hotel-rate search (both). `sand_` values return test-mode results.                                                   |
| `LITEAPI_MODE`              | `provider`                                       | Optional environment label: `provider`, `test`, or `live`. A sandbox response or sandbox key takes precedence and remains `test`.                    |

The integration status endpoint reports whether credentials are configured, not whether an account has been validated. Provider requests send the relevant trip/conversation or search details to that provider. Supplier secrets stay server-side. The optional Embed map uses a separate public, website-restricted key, exposed through the allowlisted `/api/config` endpoint.

**OpenAI** powers Studio brief review, document interpretation, dictation and optional sourced recommendations, as well as the earlier concierge. **LiteAPI** supplies both flight and hotel searches through one key; the current connection stays sandbox. **Google Places**, **Google Maps Embed** and **Duffel** are optional additions for existing place, map or flight features. Real external map links already work without a key. Bookable activities, award inventory, transactional email, and payment services are later integrations; adding an environment variable alone does not implement them. The [integration guide](docs/INTEGRATIONS.md) explains each API, required account access, and the remaining work.

## Docker

Build a single-service image using the committed package lock:

```sh
docker build -t asktara:local .
docker volume create asktara-data
```

For an HTTP preview on your own machine, explicitly use development cookie settings:

```sh
docker run --rm --name asktara \
  -p 127.0.0.1:3001:3001 \
  -v asktara-data:/app/data \
  -e NODE_ENV=development \
  -e COOKIE_SECURE=false \
  -e APP_ORIGIN=http://localhost:3001 \
  asktara:local
```

For a production configuration, create a private `.env.production` using the variable names above, with your actual public HTTPS origin and provider secrets. The following is a configuration example for a host with one trusted HTTPS reverse proxy; it does not configure the proxy, domain, certificates, or deploy the application:

```sh
docker run --detach --name asktara --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -v asktara-data:/app/data \
  --env-file .env.production \
  -e NODE_ENV=production \
  -e DATABASE_PATH=/app/data/asktara.sqlite \
  -e PORT=3001 \
  -e COOKIE_SECURE=true \
  -e TRUST_PROXY=1 \
  asktara:local
```

The app runs as the image's non-root `node` user. Named volumes inherit the prepared data-directory ownership; a bind-mounted directory must be writable by that user. Keep the SQLite database and its WAL/SHM files on the same local persistent volume. Back up the database using SQLite-aware procedures, or stop the service before copying its data directory. Do not share a SQLite database across independent app containers or network filesystems.

## Verification

```sh
npm run check
npm test
npm run build
```

Studio tests cover structure acceptance, revision conflicts, route dates, private imports and proposal output, explicit inclusion, supplier search prerequisites and quote-only selection. The real fictional intake browser check exercises a 28-day route without searching suppliers or creating a booking. Backend tests also cover isolation between owners, account/session behavior, persistence across restart, conversation and itinerary updates, sharing privacy/revocation, calendar formatting, malformed input, origin enforcement, and provider success/failure handling. Planning-run tests additionally cover interruption, idempotency, cancellation, version conflict, and restore behavior. Provider tests use controlled responses; **live end-to-end supplier behavior has not been validated with production accounts**. Search credentials, account eligibility, actual inventories, and final commercial configuration need validation with your accounts.

Run `npm run test:e2e` for browser journeys using installed Google Chrome (`channel: chrome` in `playwright.config.ts`). The suite starts the local servers if needed and includes cases that use configured external APIs. To run Studio UI checks with mocked APIs, select `npx playwright test tests/studio-ui.spec.ts tests/home-prompt.spec.ts`. `tests/studio-live-intake.spec.ts` is a separate real OpenAI check using a newly authored fictional brief; it requires configured model access, disables traces and deletes its own workspace. The Docker image builds the app; it does not run a browser suite as part of startup.

## API overview

All application endpoints start with `/api`. See [the planning architecture](docs/PLANNING_ARCHITECTURE.md) for workflow stages and persistence guarantees. Use JSON request bodies and preserve the session cookie. Begin with `GET /api/session` before parallel requests on a new client. Responses use JSON with an `error` string on failure. Trip/share/wishlist deletion returns `204`; account deletion returns `200` with a JSON result and a new guest-session cookie. Rate limits apply globally, with tighter limits for authentication, chat, and provider search.

Studio uses separate workspace and proposal APIs:

| Endpoint                                                | Purpose / result                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET/POST /studio/workspaces`                           | List owned workspaces or create a blank one.                                                                                   |
| `GET/PATCH/DELETE /studio/workspaces/:id`               | Read, revise or delete an owned workspace. Edits include the current `revision`.                                               |
| `POST /studio/workspaces/:id/review`                    | `{revision, requestId, message}` reviews the brief and extracts a draft route; no supplier or activity research.               |
| `POST /studio/workspaces/:id/structure`                 | `{revision, skipQualification}` continues with the available route and explicit unknowns.                                      |
| `POST /studio/workspaces/:id/accept-structure`          | `{revision}` approves the route structure before enrichment.                                                                   |
| `POST /studio/import/preview`                           | Extract a supplied text/file/link/audio input for private agent review.                                                        |
| `POST /studio/workspaces/:id/import`                    | Save the reviewed text as a private source.                                                                                    |
| `POST /studio/workspaces/:id/imports/:importId/extract` | `{revision, requestId}` creates unselected service candidates requiring review.                                                |
| `POST /studio/workspaces/:id/hotels/search`             | `{revision, stopId, guestNationality}` searches qualified hotel quotes.                                                        |
| `POST /studio/workspaces/:id/flights/search`            | `{revision, origin, destination, departureDate, returnDate?, adults, cabinClass}` searches explicitly requested flight quotes. |
| `POST /studio/workspaces/:id/quotes/:quoteId`           | `{revision}` adds a returned quote to the proposal; does not reserve it.                                                       |
| `POST /studio/workspaces/:id/recommendations`           | `{revision, requestId, category, stopIds, interests}` researches optional suggestions, initially unselected.                   |
| `GET/PATCH /studio/agency`                              | Read or configure owned branding and workflow preferences.                                                                     |
| `GET /studio/clients`                                   | Read private client/context history from owned workspaces.                                                                     |
| `GET /studio/workspaces/:id/proposal/preview`           | Review the client-facing proposal; `/preview/pdf` downloads a draft PDF.                                                       |
| `POST/DELETE /studio/workspaces/:id/proposal`           | `{revision}` publishes a snapshot or revokes its link.                                                                         |
| `GET /studio/proposals/:token`                          | Public read-only snapshot; `/pdf` downloads its PDF.                                                                           |

Core platform and earlier consumer-planner endpoints:

| Endpoint                                        | Purpose / result                                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                   | API/database status.                                                                                                                                                                                        |
| `GET /session`                                  | `{ user: User \| null }`; establishes a guest session.                                                                                                                                                      |
| `POST /auth/register`                           | `{ name, email, password }` → `{ user }`; password length 8–128.                                                                                                                                            |
| `POST /auth/login`                              | `{ email, password }` → `{ user }`.                                                                                                                                                                         |
| `POST /auth/logout`                             | Revokes the current session and establishes a new guest session.                                                                                                                                            |
| `GET /profile`                                  | `{ profile }` for the current guest or account owner.                                                                                                                                                       |
| `PATCH /profile`                                | Partial `{ pace, interests, originAirport, guestNationality, dietaryPreferences, accessibilityPreferences, planningNotes }` → `{ profile }`; values are validated and airport/nationality codes normalized. |
| `GET /account`                                  | Signed-in account details and count of other active sessions.                                                                                                                                               |
| `PATCH /account`                                | `{ name }` → `{ user }`; email changes are not supported.                                                                                                                                                   |
| `POST /account/password`                        | `{ currentPassword, newPassword }` → `{ user, message }`; rotates the current session and revokes other sessions.                                                                                           |
| `POST /account/sessions/revoke`                 | `{ currentPassword }` → `{ revoked }`; signs out other sessions and cancels their active planning work.                                                                                                     |
| `GET /account/export`                           | Download the account's profile, trips/conversations, itinerary revisions and wishlist as JSON. Authentication credentials and public-share tokens are excluded.                                             |
| `DELETE /account`                               | `{ currentPassword, confirmation: 'DELETE' }` → `{ user: null, message }`; permanently deletes owned data and establishes a guest session.                                                                  |
| `GET /catalog`                                  | `{ destinations, stays, experiences }`.                                                                                                                                                                     |
| `GET /integrations`                             | Provider configuration flags and local/live AI mode.                                                                                                                                                        |
| `GET /config`                                   | Public configuration allowlist: the optional website-restricted Maps Embed key only.                                                                                                                        |
| `POST /planning/runs`                           | `{ requestId, message, tripId?, brief? }` → HTTP 202 `{ run }`; persistent asynchronous workflow.                                                                                                           |
| `GET /planning/runs/:id`                        | `{ run }` with progress, state, and terminal result/error.                                                                                                                                                  |
| `POST /planning/runs/:id/cancel`                | Cancels an owned run → `{ run }`.                                                                                                                                                                           |
| `GET /trips/:id/runs`                           | `{ runs }` for progress recovery.                                                                                                                                                                           |
| `GET /trips/:id/places/:placeId`                | Fetch fresh Google details for a place in the owned itinerary; no-store response.                                                                                                                           |
| `POST /shared/:token/clone`                     | Copy the public itinerary into a new private editable trip, without another AI call.                                                                                                                        |
| `GET /trips/:id/revisions`                      | `{ revisions }` for itinerary history.                                                                                                                                                                      |
| `POST /trips/:id/revisions/:revisionId/restore` | `{ revision: currentVersion }` → `{ trip }`; creates a new version.                                                                                                                                         |
| `POST /chat`                                    | `{ message, tripId? }` → `{ trip, message, mode, warning? }`; creates a trip when no ID is supplied.                                                                                                        |
| `GET /trips`                                    | `{ trips }` for the current owner.                                                                                                                                                                          |
| `GET /trips/:id`                                | `{ trip }` for the current owner.                                                                                                                                                                           |
| `PATCH /trips/:id`                              | Change title, startDate, days, travelers, budget, interests, status, brief, or itinerary; include revision for conflict protection → `{ trip }`.                                                            |
| `POST /trips/:id/items`                         | `{ kind: 'stay' \| 'experience', itemId, day, time, revision, requestId }` → `{ trip, item, alreadyAdded }`; add trusted catalog inspiration to an existing day.                                            |
| `DELETE /trips/:id`                             | Deletes an owned trip and disables its share link.                                                                                                                                                          |
| `POST /trips/:id/share`                         | `{ shareToken, url }`; URL is relative to the frontend origin.                                                                                                                                              |
| `DELETE /trips/:id/share`                       | Revokes public access.                                                                                                                                                                                      |
| `GET /shared/:token`                            | `{ trip }` with an empty conversation and no reusable share token.                                                                                                                                          |
| `GET /trips/:id/calendar.ics`                   | Calendar download; requires a start date and itinerary.                                                                                                                                                     |
| `GET /saved`                                    | `{ items }` for the current owner.                                                                                                                                                                          |
| `POST /saved`                                   | `{ type: 'destination' \| 'stay' \| 'experience', itemId }` → `{ item }`.                                                                                                                                   |
| `DELETE /saved/:id`                             | Deletes an owned saved item.                                                                                                                                                                                |
| `POST /flights/search`                          | `{ origin, destination, departureDate, returnDate?, adults?, cabinClass? }` → `{ offers, mode, warning, roundTrip }`. Airport codes are three letters; dates use `YYYY-MM-DD`.                              |
| `POST /hotels/search`                           | `{ destinationId, checkin, checkout, adults?, guestNationality }` → `{ offers, mode, warning }`. Nationality is an ISO two-letter country code.                                                             |

Studio contracts live in `shared/studio.ts` and `shared/studio-proposals.ts`; Studio validation and route rules live in `server/studio-domain.ts`. Studio keeps explicit budget and quote currencies rather than adding mixed-currency prices. Trip types for the earlier planner live in `shared/types.ts`; account/profile types live in `shared/account.ts`. Validation rules live in `server/validation.ts`, `server/account.ts` and `server/trip-items.ts`. A not-yet-selected destination is represented by `destinationId: ''` and an empty itinerary. The earlier planner keeps the stated group-budget currency separately from its USD activity-cost ledger; activity costs are per-person planning estimates. A new unspecified dollar target uses AUD rather than silently comparing it with USD costs. Flight totals cover the requested group and complete requested journey; detail panels show all returned journey slices and segments. Supplier quote expiry and passenger-specific baggage appear only when supplied, and an active quote does not guarantee availability. Hotel totals cover the full requested stay; final taxes and rate rules require provider confirmation.

## Remaining production work

Studio is a proposal assistant; supplier selection never performs booking or payment. Additional supplier inventory, flight servicing, live GDS and insurer quoting integrations need approved provider access and additional implementation. Client commenting, acceptance and payment are outside the current read-only proposal scope. See [Agent Studio workflow and limits](docs/AGENT_STUDIO.md) for the exact boundaries.

Production payments and booking remain disabled in the separate existing checkout feature. The hotel sandbox reservation, retrieval and cancellation flow is implemented and tested with no-charge test payments. Flight confirmation requires explicit activation and verified LiteAPI account payment capability; the code and mocked tests do not establish real ticket issuance. Paid flight cancellation, booking amendments and supplier servicing remain separate work. Award-flight search, direct calendar synchronization, account email verification, password reset and email delivery are not implemented. Monitoring and automated backups remain production operations work.

SQLite and in-process rate limits are designed here for one application instance on a persistent host. Scaling to multiple replicas requires a shared database/session strategy, a shared rate-limit store, concurrency handling, operational migration plans, and deployment testing. Catalog photography is bundled locally; original sources and caching instructions are recorded in `docs/IMAGE_SOURCES.md`. Google Fonts and optional provider imagery require internet access, with system fonts as a fallback. Private Odessia features and production reliability cannot be inferred from its public pages; parity claims should remain limited to the researched and implemented workflows.
