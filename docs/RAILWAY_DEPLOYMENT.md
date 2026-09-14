# Railway deployment (Asktara)

Asktara deploys as one Railway service. The Node 24 Docker image builds the frontend, then Express serves both the compiled site and `/api` on `0.0.0.0:$PORT`. SQLite stores accounts, sessions, trips, profiles, revisions, planning runs and Agent Studio workspaces/quotes/proposal snapshots on the attached persistent volume.

The current code release is **Agent Studio**, deployment `c6d4c1fb-64d4-468a-8644-57eb02bc761c` (**SUCCESS**, 14 September 2026). It implements the staged brief → accepted route → requested services/recommendations → branded proposal workflow. The frontend entry is `/studio`. Existing secrets, sandbox mode, disabled flight confirmation and the persistent volume were preserved. This final backend update fixes recommendation selection when JSON fields arrive in a different order and returns safe diagnostic codes.

The initial Studio deployment `e92cdd17-a7f1-4922-99ca-4697835e5a96` also reached **SUCCESS**; its health/integration endpoints and actual route/proposal browser journeys passed. The first upload attempt (`46bc224d-7e3b-49c9-86e3-fdc61b778295`) failed with an upload HTTP 500 before that successful retry. See [Agent Studio workflow](AGENT_STUDIO.md) and [final release checks](VERIFICATION.md).

## Provisioned target

| Resource      | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| Public origin | `https://asktara-production-58de.up.railway.app`               |
| Workspace     | Leveleight's Projects (`5934bf2f-c2d8-4b93-9f36-21d43fcbccbc`) |
| Project       | `asktara` (`4e0b409f-9e0b-42f7-9e3b-391464e24419`)             |
| Service       | `asktara` (`484b5325-3a4e-4bda-acfa-b43680123ff1`)             |
| Environment   | `production`                                                   |
| Volume        | `acf44f51-57a9-4e5d-aedc-c4d12a3fd7ea`, mounted at `/app/data` |
| Database      | `/app/data/asktara.sqlite`                                     |

This service was successfully deployed and verified on 12 September 2026, including real OpenAI calls, sandbox supplier searches, browser journeys, and persistence across redeployment. See [verification results](VERIFICATION.md). Re-run the checks below for future releases. Creating another project or volume is unnecessary when updating this target.

The global concierge release is deployment `c53abec7-bc55-4201-a9a1-a5a5c49f503e` (**SUCCESS**). Its real Chrome London-to-Osaka journey passed with GPT-6 Astra, web evidence, venue checks and reload persistence. The final-release smoke passed planning and hotel searches but recorded a flight supplier timeout. One isolated repeat of the same flight request succeeded in 3.8 seconds with 30 complete sandbox round-trip offers. Both outcomes remain in the detailed verification record; deployment success does not guarantee supplier availability.

The latest sandbox checkout release is `912924cd-8469-440d-8f7e-04e385b5144c` (**SUCCESS**, 13 September 2026 local time). Health, the current compiled frontend and the bookings API returned HTTP 200 after restart. The hotel browser journey passed against its immediately preceding checkout build, including confirmation, reload, mobile layout, cancellation and synthetic-account cleanup. The final update adds graceful supplier draining and button styling. Flight confirmation is explicitly disabled with `LITEAPI_FLIGHT_BOOKING_ENABLED=false`; supplier verification currently returns HTTP 500/code `52099`. See [booking verification](VERIFICATION.md) and the [supplier support brief](LITEAPI_FLIGHT_SUPPORT.md).

## Link and deploy

The current consultation release is `ccfb4c63-f448-4c3a-a1e4-ebcd08d02037` (**SUCCESS**, 13 September 2026 local time). It adds evidence-backed intake memory, concise replies, explicit service choices, AUD budget targets, separate flight dates, bounded research recovery and a single intake retry for explicit token-limit failures. It retains the checkout release's sandbox and shutdown settings. Health and integration status returned HTTP 200 after activation. See [consultation behaviour](CONSULTATION_WORKFLOW.md) and [verification results](VERIFICATION.md).

The preceding runtime deployment was `9ea7026c-c199-4496-8b09-56134cc497b6` (**SUCCESS**, 14 September 2026), activating the replacement OpenAI credential. The local private `.env` and Railway service variable were updated. Database health and an actual GPT-6 Astra intake request passed after activation; the fictional verification trip was deleted. No credential values are recorded here.

Use the Railway CLI from the repository root. Authenticate with `railway login --browserless` if needed, then select the existing project explicitly:

```sh
railway link \
  --project 4e0b409f-9e0b-42f7-9e3b-391464e24419 \
  --service 484b5325-3a4e-4bda-acfa-b43680123ff1 \
  --environment production
```

Before deploying a new environment, attach its persistent volume and configure its runtime variables. The production target above already has a volume mounted at `/app/data`. `Dockerfile` directory creation does not provision Railway storage: the volume must be attached to the service, and it is mounted only at runtime. Railway mounts volumes as root, so this deployment uses `RAILWAY_RUN_UID=0` to allow writes despite the image's default `node` user. [Railway volume configuration and permissions](https://docs.railway.com/volumes).

Deploy changes and inspect the latest deployment:

```sh
railway up --service asktara --environment production --detach
railway deployment list --service asktara --environment production --limit 5
railway logs --service asktara --environment production --deployment --latest --lines 100
```

`--detach` returns after uploading; it does not prove that the application is healthy. Check the deployment status and run the smoke checks after Railway activates the build. `.railwayignore` and `.dockerignore` exclude local secrets, database files, dependencies and generated test artifacts from the uploaded source/build context. Local accounts and trips are not copied to production automatically. [Railway CLI deployment behavior](https://docs.railway.com/cli/up).

## Runtime variables

This release requires these non-secret settings on the production target:

| Variable                              | Value                                            | Reason                                                                                             |
| ------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                            | `production`                                     | Enables production security behavior and HTTPS-only cookies.                                       |
| `PORT`                                | `3001`                                           | Express port and public-domain target port.                                                        |
| `APP_ORIGIN`                          | `https://asktara-production-58de.up.railway.app` | Exact public HTTPS origin for browser requests, without a trailing slash.                          |
| `COOKIE_SECURE`                       | `true`                                           | Keeps session cookies restricted to HTTPS.                                                         |
| `TRUST_PROXY`                         | `1`                                              | Uses Railway's forwarding headers for HTTPS detection and client IPs.                              |
| `DATABASE_PATH`                       | `/app/data/asktara.sqlite`                       | Keeps SQLite and its WAL/SHM files on the persistent volume.                                       |
| `RAILWAY_RUN_UID`                     | `0`                                              | Allows the app to write the root-owned Railway volume.                                             |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `210`                                            | Allows the application's 200-second supplier-request drain before Railway sends SIGKILL.           |
| `SHUTDOWN_GRACE_MS`                   | `200000` (default)                               | Maximum application shutdown grace; bounded integer values from `130000` to `300000` are accepted. |
| `LITEAPI_MODE`                        | `test`                                           | Matches the currently supplied sandbox credential.                                                 |
| `OPENAI_MODEL`                        | `gpt-6-astra`                                    | Uses the verified model for all four concierge stages.                                             |
| `OPENAI_REASONING_EFFORT`             | `low`                                            | Bounds latency while retaining model reasoning and web tools.                                      |

Railway terminates public HTTPS before forwarding traffic to the service. Keep `APP_ORIGIN` aligned with the public domain when changing it, and keep secure cookies enabled. The proxy setting assumes this Railway deployment; reassess it if the app is moved behind a different proxy chain.

The server starts directly with `node --import tsx server/index.ts`, so it receives termination signals without an npm wrapper. On shutdown it stops accepting connections, cancels planning work, and allows active HTTP requests and dispatched supplier operations to finish before closing SQLite. The default 200-second deadline covers the hotel's 125-second request timeout and the guarded flight confirmation sequence. It exits promptly when work finishes; a forced exit leaves durable pending records for restart reconciliation. Invalid `SHUTDOWN_GRACE_MS` values use the default. Keep Railway's draining time at least ten seconds longer than the application grace (210 seconds for the default); this is Railway's SIGTERM-to-SIGKILL window. [Railway deployment teardown](https://docs.railway.com/deployments/deployment-teardown).

Provide API secrets through Railway service variables, never source files or browser code. The CLI supports `railway variable set KEY_NAME --stdin` for secret input; avoid putting secret values in shell history or deployment documentation. Set variables for the `asktara` service in `production`.

| Optional variable           | Enables / requirement                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`            | Conversational intake, live web research and itinerary composition; requires model access and available account quota.                              |
| `OPENAI_MODEL`              | Defaults to `gpt-6-astra`; use a model supported by the implemented Responses request.                                                              |
| `GOOGLE_PLACES_API_KEY`     | Server-side Places API (New) lookup; requires the API to be enabled and billing/account restrictions to permit these requests.                      |
| `GOOGLE_MAPS_EMBED_API_KEY` | Public browser map key; restrict it to Maps Embed API and `https://asktara-production-58de.up.railway.app/*`. Keep it separate from the server key. |
| `DUFFEL_ACCESS_TOKEN`       | Flight search through Duffel when supplied; test tokens produce simulated offers.                                                                   |
| `LITEAPI_API_KEY`           | Hotel-rate search and the LiteAPI flight-search adapter; provider access and available inventory still need successful request validation.          |

`GET /api/integrations` reports whether credentials are present. Its `true` flags do not validate keys, account permissions, balances or inventory. Its overall `mode: live` indicates AI configuration; individual supplier responses still identify sandbox rates as `mode: test`. Search offers are not bookings. Studio quote selection creates proposal items only. The separate legacy hotel checkout has passed sandbox reservation/cancellation checks; production payments and flight confirmation remain disabled. See [provider requirements](INTEGRATIONS.md).

## Verify a deployment

Confirm the JSON API health endpoint and the compiled frontend:

```sh
curl --fail --silent --show-error https://asktara-production-58de.up.railway.app/api/health
curl --fail --silent --show-error --output /dev/null https://asktara-production-58de.up.railway.app/
npm run smoke -- https://asktara-production-58de.up.railway.app
```

The health response includes `status: "ok"`, `service: "asktara"` and `database: "connected"`. Use `/api/health`: `/health` is not an API endpoint and can return the frontend's HTML fallback.

The smoke script creates a temporary guest trip, checks planning and persistence workflows, and removes its trip afterwards. It preserves cookies for its own requests and checks isolation from another session. It uses configured OpenAI/Places integrations during planning, which may consume provider quota; without them it uses the curated planner. A configured AI integration falling back because of an error is reported separately from successful core persistence checks.

To also request hotel and flight offers from configured providers:

```sh
npm run smoke -- https://asktara-production-58de.up.railway.app --providers
```

Read each provider result independently. An empty valid search, a sandbox response and a failed provider request establish different outcomes; none demonstrates a completed booking. Provider configuration alone is not a passing live integration check.

`railway.toml` pins the Dockerfile builder, direct Node start command, `/api/health` with a 120-second startup timeout, and up to five restarts on failure. Railway's health check controls deployment activation; it is not continuous uptime monitoring. A service with an attached volume can have a brief interruption during redeployment because both deployments cannot mount that volume simultaneously. [Railway health checks](https://docs.railway.com/deployments/healthchecks).

## Persistence and operations

Keep this SQLite deployment at one service instance. Planning execution and rate limits are process-local, and independent replicas must not share this database. Persistent storage preserves saved data across ordinary redeployments; it does not replace backups.

Back up SQLite using a SQLite-aware backup or stop the service before copying the entire data directory, including any WAL/SHM files. Verify restoration before relying on a backup. Do not delete or detach the production volume during routine redeployments. Interrupted planning runs are marked retryable when the server restarts; durable saved trips and sessions remain in the database.

When moving to a custom domain, update the domain routing, `APP_ORIGIN`, and any browser map-key referrer restriction before checking sign-in, planning, saving and sharing over HTTPS. Cookies belong to the original host, so users will need to sign in again on the new host.
