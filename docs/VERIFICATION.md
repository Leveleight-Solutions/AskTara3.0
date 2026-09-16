# Asktara verification

The Agent Studio workflow covers private brief review, an explicitly accepted route, requested services/recommendations and branded proposals. Results are recorded by release below. The earlier consumer planner and checkout checks remain historical evidence for those separate flows. See [Agent Studio workflow and limits](AGENT_STUDIO.md).

## 14 September 2026 — Agent Studio

- **305 backend/unit/API tests passed** in 12.0 seconds with test-file concurrency one; all six existing smoke-driver tests also pass. The production build, TypeScript and repository formatting pass. Tests cover ownership, saved revision conflicts, concurrent request deduplication, route/date/party grounding, approval gates, private imports, SSRF controls, supplier-quote integrity, recommendation evidence/privacy and immutable proposal publication. The new inclusion regression reverses top-level and nested JSON property order, verifies both selection states, and still rejects changed names or citations.
- **26 mocked Chrome cases passed** across Studio, the updated home entry, legacy consultation and booking views. The changed recommendation case was repeated against the final compiled assets: new results start unchecked and require explicit inclusion. Three import browser cases passed, covering editable extraction and microphone fallback. These intercepted tests do not verify provider availability.
- A real browser proposal journey passed private preview, PDF download, anonymous public viewing, package pricing, immutable snapshots, republishing, revocation and a 390-pixel mobile layout. Public output excluded private references, costs and source material. Desktop/mobile and Japanese PDF output were visually inspected.
- A real OpenAI intake browser check preserved a fictional 28-day Paris → Berlin → London route with nine nights each, 18 November–15 December 2026, two adults, no children and AUD 12,000. It made no supplier or recommendation calls and waited for explicit route approval. The workspace was deleted after the test.
- Real OpenAI PDF, screenshot and audio extraction passed with newly authored fictional fixtures; public HTTPS text extraction passed using `example.com`. Previewing did not persist sources or create workspaces. This does not establish access to login-protected or script-only tour websites.
- The first combined real-provider Studio check passed imported-service extraction and **12 LiteAPI sandbox hotel quotes plus selection**. Its SYD–CDG sandbox flight search returned HTTP 502. That failed run is retained here; it cleaned up its fictional workspace and made no reservation or payment request. Subsequent checks are recorded below.
- A fresh repeat passed imported-service extraction, **12 hotel quotes and 30 flight quotes with selection**. Recommendations then failed HTTP 503. Review identified unsupported `format: uri` in the two new model-facing source URL schemas; these now use bounded strings with the same runtime URL/evidence validation. A separate fresh fictional OpenAI research request subsequently passed with two sourced, unselected food suggestions. The original 503's precise provider error was not retained, so schema incompatibility is a confirmed defect rather than a proven diagnosis of that individual response. Fixed diagnostic codes now distinguish model, evidence and service failures without logging private payloads.
- The corrected global hotel-location research also passed an actual OpenAI web request for **Kotor, Montenegro**, outside the built-in destination list. It preserved the requested name/country and returned sourced coordinates. This was location resolution only, not a hotel availability or reservation check.
- Railway deployment `e92cdd17-a7f1-4922-99ca-4697835e5a96` reached **SUCCESS**. Health/database and integration-status endpoints returned HTTP 200. Its real Chrome intake and proposal journeys both passed in **44.2 seconds**: actual `gpt-6-astra` 28-day route, acceptance/reload, branded public snapshots, PDF, package pricing, republishing, mobile and revocation. Both created and removed only fictional workspaces.
- The first complete API check on that deployment passed actual import extraction, 12 sandbox hotel quotes, 30 sandbox flight quotes and two sourced recommendations. Inclusion then returned HTTP 400. The recommendation integrity comparison was sensitive to JSON property order after schema parsing; it now compares object values independent of property order while still rejecting changed titles or evidence. Fixed Studio error codes are also returned to support diagnostics. The failed check cleaned up its own workspace; final-release results follow below.

**Final release:** deployment `c6d4c1fb-64d4-468a-8644-57eb02bc761c` reached **SUCCESS** and returned HTTP 200 with the database connected. The complete `studio-smoke.mjs` flow then **passed end to end on Railway**: route acceptance, actual OpenAI extraction into an excluded/review-required service, 12 LiteAPI sandbox hotel quotes and selection, 30 sandbox flight quotes and selection, two real sourced food recommendations initially excluded, explicit service/recommendation inclusion, private preview, anonymous public snapshot, an actual 14,727-byte PDF, revocation and workspace cleanup. The proposal omitted private context, references, source material and acquisition costs. No reservation, ticket, payment or insurer issuance endpoint was called. This final backend fix keeps the same frontend assets (`index-CAzPzu6H.js`, `index-CQuDlBIv.css`) used by the passing production Chrome checks above.

Inspected deployed captures: [28-day route](screenshots/studio-28-day-route-railway.png), [client proposal desktop](screenshots/studio-proposal-desktop-railway.png), [client proposal mobile](screenshots/studio-proposal-mobile-railway.png). These are fictional fixtures from the first Studio deployment; the subsequent inclusion fix changes backend comparison only and keeps the same compiled frontend.

Reproducible provider check: `node scripts/studio-smoke.mjs https://asktara-production-58de.up.railway.app`. It uses a new fictional guest workspace, actual configured OpenAI calls, sandbox supplier searches, an anonymous proposal/PDF view and cleanup. It records a failed flight search separately while continuing independent proposal checks. Do not substitute real saved client data for its fixtures.

Studio itself does not reserve rooms, issue tickets or charge cards. LiteAPI remains sandbox; family supplier pricing requires a reviewed manual quote. Flight booking stays disabled due the previously recorded provider verification failure. Insurance is an explicitly entered estimate; additional supplier inventory, insurer quoting and live GDS/NDC access require provider-approved APIs and further implementation. The UI's manual and parsing features do not represent those services as connected.

## Railway verification — 12 September 2026

The frontend and backend are deployed to [Asktara](https://asktara-production-58de.up.railway.app) in Leveleight's Projects. Railway reports a successful deployment, and `/api/health` returns HTTP 200 with the SQLite database connected. Production uses Node 24, HTTPS session cookies, and the `/app/data` Railway volume. Infrastructure and update commands are in [the deployment guide](RAILWAY_DEPLOYMENT.md).

- Production build and TypeScript pass; **86 backend tests** and **6 smoke-script regression tests** pass.
- The deployed API smoke recorded **10 passed, 0 failed**. Both OpenAI specialist stages completed without local fallback. It also checked compiled assets, secure guest sessions, deduplicated planning, itinerary persistence, protected edits, revision history, calendar export, and owner isolation.
- The supplied LiteAPI key successfully returned **30 round-trip flight offers** and **11 hotel offers** through the deployed API. These are sandbox/test results. Offer counts vary by search; they are not reservations or production pricing.
- The real Chrome itinerary journey passed generation, editing, reload persistence, completion status, calendar download, sharing, private cloning and share revocation against the HTTPS deployment.
- Real browser supplier searches returned 30 sandbox flight offers and 12 hotel rates. Round-trip details, full-party prices, hotel names/photos/rooms, mobile flight layout and dialog keyboard behavior passed with no page, console or network errors. Captures: [flight results](screenshots/railway-flight-results.png) and [hotel results](screenshots/railway-hotel-results.png).
- Separate desktop/mobile Chrome checks passed discovery, wishlist changes, saved preferences, registration migration, account export, password change, sign-in, other-session revocation and deletion of the synthetic test account. All checked routes rendered, with **zero JavaScript/console errors and no horizontal overflow**.
- Final Railway deployment `f110023b-0e4a-417c-9f87-ac8c2be72623` reached **SUCCESS**. After container replacement, the same private guest session retrieved its original saved trip, edited stop, revision number and revision history. The synthetic persistence trip and private local cookie fixture were then deleted. Final HTTPS frontend and database checks passed.
- Visual captures: [desktop home](screenshots/railway-home-desktop.png) and [mobile home](screenshots/railway-home-mobile.png).

Google Places and the embedded Google map are not configured; the itinerary uses curated place references and external map links. Supplier booking, payments and ticketing remain unimplemented. Verification did not perform bookings or payments. The LiteAPI public key is stored as a service variable but is not used by the current server adapters.

## Earlier local verification

Verified locally on 11 September 2026 using Node 25.4 and installed Google Chrome. No real supplier credentials were used.

## Automated checks

- `npm test`: **81 passing tests** across accounts, preferences, planning agents, supplier adapters, itinerary additions, maps, HTTP integration, and persistent run lifecycle.
- `PLAYWRIGHT_BASE_URL=http://localhost:3012 CAPTURE_SCREENSHOTS=1 npm run test:e2e`: **14 passing browser scenarios** against the compiled application with an isolated temporary SQLite database (44.5 seconds).
- The expanded `tests/account-ui.spec.ts` assertions were then run separately against that compiled app: **2 passing scenarios**, including dietary/accessibility/freeform preferences, migration and export (5.5 seconds). These are the same account journeys with additional assertions, not two extra unique journeys.
- `npm run build`: TypeScript and the production Vite build pass.
- `npm run format:check`: repository formatting passes.
- Browser journeys cover discovery, accounts, sharing, calendar export, protected edits, revision restore, multi-destination allocation, recovery from an interrupted browser connection, full return-flight details, and adding catalog inspiration to an existing trip. Executable journeys are in `tests/*.spec.ts`.

The backend tests include two distinct structured model calls, invalid model outputs, provider failures, test/live price separation, family passenger restrictions, Google content sanitization, fresh place lookup, cancellation during requests, owner isolation, logout races, concurrent edits, restart recovery, duplicate-request handling, and rollback when the final trip/run transaction fails. New coverage includes password/login races, session revocation, transactional account deletion, profile defaults and requirement preservation, itinerary insertion/time conflicts, five-hour activity duration, every flight journey/segment, and map URLs/public-key isolation.

An initial browser run caught missing focus restoration after dismissing the flight dialog with Escape. The shared modal lifecycle was fixed; the targeted flight check and the final full browser suite pass. Native-dialog keyboard focus is returned to the opener when it remains on the page.

Supplier responses are controlled test fixtures. Passing tests establish the application contract, not production account eligibility, inventory quality, live pricing, or booking capability.

## Browser and visual inspection

`node scripts/inspect-planner.mjs` creates a real local trip and inspects itinerary, working map links and transport selection, budget review, sources, place details, and a 390px mobile viewport. It passed against the compiled application with **zero JavaScript errors and no horizontal overflow**:

```sh
ASKTARA_PREVIEW_URL=http://localhost:3012 node scripts/inspect-planner.mjs
```

Inspected captures:

- [Desktop itinerary](screenshots/planner-agents-desktop.png)
- [Desktop budget review](screenshots/planner-review-desktop.png)
- [Source details](screenshots/planner-sources-desktop.png)
- [Place dialog](screenshots/planner-place-desktop.png)
- [Mobile itinerary](screenshots/planner-agents-mobile.png)
- [Mobile review](screenshots/planner-review-mobile.png)
- [Map and directions controls](screenshots/planner-map-desktop.png)
- [Account preferences](screenshots/account-preferences.png)
- [Mobile account management](screenshots/account-mobile.png)
- [Desktop flight details](screenshots/flight-details-desktop.png)
- [Mobile flight details](screenshots/flight-details-mobile.png)

The temporary verification server uses the compiled frontend over local HTTP with development-compatible cookies; this is not an HTTPS deployment certification. The normal development app remains on port 5173. The temporary verification database is separate from application data.

Live OpenAI/supplier requests and live Google Embed rendering still require configured accounts and keys. No reservations, payment or ticketing flows were tested because they are not implemented. Docker execution, deployment, backup recovery and operational monitoring remain outside this verification.

The reference inspection is separate: [signed-in Odessia analysis](AUTHENTICATED_RESEARCH.md) and the earlier [public research](ITINERARY_RESEARCH.md). Generation, saving and a contextual follow-up were observed in the provided Chrome account; detailed parity limits are recorded there. Asktara's agent architecture is its own implementation.

## 12 September 2026 — global GPT-6 concierge

The final local release checks pass: **144 backend/unit tests**, **6 deployment-smoke regression tests**, TypeScript/production build and Prettier. Added coverage includes global trip snapshots, route ownership, source URL provenance, actual tool-opened pages, closure exclusion, uncertain status, protected appointments, editable long research descriptions, and public-sharing privacy.

A mocked Chrome journey verifies non-catalog Osaka/Nara across chat citations, maps, route settings, hotel search with an owned trip ID, sharing/copying, trip cards and mobile layout. This validates rendering and request wiring, not supplier availability.

Actual GPT-6 Astra API tests exercised Osaka and Reykjavík research/composition, a saved-Osaka informational follow-up, and independent operating-status verification. Osaka supplier research returned three hotel options and five complete flight options, all labelled LiteAPI sandbox data and excluded from the live budget. The follow-up preserved the saved schedule/dates/party/budget and identified the actual scheduled café. A subsequent real status check excluded that café using its official dated closure announcement.

Cartagena exposed long-text, city-name variant and source-reference edge cases. Captured real research and verification responses now pass the corrected validation; the castle's unsupported status assertion becomes explicit uncertainty. The captured replay is not presented as a fresh end-to-end live search. See [global concierge implementation and limits](GLOBAL_CONCIERGE.md).

Railway deployment `c53abec7-bc55-4201-a9a1-a5a5c49f503e` reached **SUCCESS** with `OPENAI_MODEL=gpt-6-astra`, `OPENAI_REASONING_EFFORT=low` and `LITEAPI_MODE=test`. The real Chrome journey against the HTTPS deployment passed in 4.4 minutes: the exact four-day London request, saved dates/party/preferences, web citations and completed venue verification, followed by a six-day Osaka change with the same requirements, then reload persistence. Its synthetic trip was deleted. Visual inspection of the final Osaka capture confirmed the researched route, six day tabs, linked map and saved state rendered correctly. Captures: [London](screenshots/london-fixed-railway.png) and [Osaka](screenshots/global-osaka-railway.png).

The final deployment smoke recorded **9 passed, 1 failed, 1 skipped**. GPT-6 intake/research/verification/composition, health/database, compiled assets, secure guest sessions, duplicate-request handling, persisted edits, protected stops, revisions, calendar export and owner isolation passed. The hotel API returned **11 sandbox offers**. The flight API returned HTTP 502 after 45.008 seconds, matching the supplier adapter's timeout; this is recorded as a failed search, not empty availability or a rejected key. Google Places enrichment was skipped because that optional provider is not configured. The smoke trip was removed successfully.

One isolated repeat of the identical flight search then **passed** in 3.821 seconds: LHR to JFK on 27 October 2026, returning 30 October, two adults in economy. The deployed API returned HTTP 200 and **30 LiteAPI sandbox offers**; all retained complete outbound/return journeys and total-party price scope. This supports a transient supplier timeout, rather than a persistent key or response-contract failure. The initial smoke result above remains recorded unchanged. No booking or payment was attempted.

## 13 September 2026 — sandbox checkout and reservations

The release passes **186 backend/unit tests**, **6 smoke-script regression tests**, TypeScript/production build and formatting. New tests cover owner-scoped offer references, accepted quote/version/amount, request fingerprints, concurrent confirmation, unknown supplier outcomes, restart recovery, private prebook checkpointing, guest migration, account deletion, revoked sessions, cancellation states and graceful shutdown. Nine mocked Chrome booking scenarios passed, covering desktop/mobile, changed prices, expired offers, unavailable flight confirmation, pending-state recovery and safe explicit retries.

The real hotel adapter check completed LiteAPI search → prebook → `ACC_CREDIT_CARD` sandbox confirmation → retrieve → cancellation. A separate real Chrome journey against Railway deployment `09bdb4b4-1530-4102-b8cc-d865b839a6ef` then passed in **18.1 seconds**. It searched Lisbon for two adults, 18–20 November 2026, reviewed the current quote, submitted fictional guest details, confirmed the sandbox reservation, reloaded its saved state, checked mobile overflow, cancelled through the confirmation dialog, and verified booking history. No page errors occurred. The synthetic booking was cancelled and its synthetic account deleted. No real payment or accommodation reservation was created.

Inspected captures: [hotel confirmation desktop](screenshots/sandbox-hotel-confirmed-railway-desktop.png), [hotel confirmation mobile](screenshots/sandbox-hotel-confirmed-railway-mobile.png). Captures precede the final cosmetic cancellation-button alignment and shutdown-only update; the booking flow is unchanged.

Flight searches returned 30 sandbox offers on each of two routes, but subsequent verification failed inside LiteAPI with HTTP 500/code `52099`. The adapter sends the documented `{offerId}` unchanged; no reservation/payment endpoint was called by those read-only checks. Automatic approval review separately rejected a synthetic flight prebook test because it could create an external reservation with a possible reversal cost and required explicit user authorization. Flight confirmation therefore remains disabled. The guarded adapter's mocked tests do not establish working payment capability or ticket issuance. See [the support reproduction](LITEAPI_FLIGHT_SUPPORT.md).

Shutdown now drains HTTP and durable pending supplier operations, even if their browser disconnected, up to a bounded 200-second deadline. Three tests verify completion, prompt idle exit and forced-deadline recovery; Railway's drain is configured for 210 seconds. These local checks do not simulate a provider reservation during an actual Railway platform failure. See [booking scope and limits](BOOKING_WORKFLOW.md).

Final deployment `912924cd-8469-440d-8f7e-04e385b5144c` reached **SUCCESS**. After activation, `/api/health` returned HTTP 200 with the database connected, `/bookings` returned the final compiled frontend asset, and `/api/bookings` returned HTTP 200 with an empty list for a new isolated guest. Runtime settings are `LITEAPI_FLIGHT_BOOKING_ENABLED=false`, `SHUTDOWN_GRACE_MS=200000` and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=210`.

All **9 mocked booking browser scenarios** also passed against the final deployed frontend in 26.3 seconds. These exercised the published assets with intercepted API fixtures and did not create additional supplier reservations.

## 13 September 2026 — concise consultation and global follow-up planning

The consultation release asks for missing requirements before building a new itinerary, keeps explicit service choices and budget currencies, separates flight dates from holiday dates, and retains detailed research outside the concise chat. See [workflow and limits](CONSULTATION_WORKFLOW.md).

- **235 backend/unit tests passed** in 8.7 seconds with test-file concurrency set to one, including bounded intake retries and cancellation. The preceding concurrent run passed 232 and failed three local HTTP checks with socket/response errors; no assertions were removed. All **6 smoke-script regression tests**, TypeScript, the production build and repository formatting also pass.
- **18 mocked Chrome scenarios passed** against the deployed consultation frontend: eight consultation, nine booking and one home-prompt regression. They cover desktop/mobile intake, service states, edited-only settings, concise chat, separate research, and existing checkout protections. APIs were intercepted; this is browser contract coverage, not supplier verification. The frontend asset is `index-XI-eAJCD.js` with `index-BS-3S9bH.css`; subsequent recovery changes affect the backend only.
- Real-provider QA caught a research-stage failure on `9df7ca92-d66a-466b-be92-c2a5197339a3`; the exact cause was not retained. Fixed diagnostic codes and a single validated research retry were added. A fresh, fictional diagnostic request then completed actual intake, researched sources, venue verification and four-day London composition without saving provider response bodies or making supplier requests.
- On `807929c7-3add-4e07-9c42-3d3c47c3e9f7`, the real Chrome London consultation and four-day itinerary passed, including dates, preferences, AUD 3000 and reload persistence. The Osaka follow-up failed during intake with `model_incomplete`; the existing London itinerary stayed intact. The provider's specific incomplete reason was not retained, so token exhaustion was not proven for that attempt. Intake now has a larger reasoning/output allowance and one bounded retry only when the provider explicitly reports a token limit.

Final deployment `ccfb4c63-f448-4c3a-a1e4-ebcd08d02037` reached **SUCCESS**. Health and integration status returned HTTP 200 after activation with the database connected and OpenAI, flights and hotels configured. These flags describe configuration, not provider success.

The **real Chrome London-to-Osaka journey passed in 5.9 minutes** on this final deployment. The exact original London request produced a short consultation reply, no premature itinerary, unknown flight/hotel states and two relevant questions. After the fictional customer chose itinerary-only and an AUD 3000 group budget, actual GPT-6 research, venue verification and composition produced four London days starting 18 November 2026 for two adults. The first research attempt rejected an unsupported citation; its single fresh retry passed the same checks. Dates, vegetarian/step-free/quiet requirements, service choices and the currency survived reload. Changing the same trip to Osaka produced six days starting 1 December 2026 with fresh web sources, venue checks and persisted itinerary edits. The test deleted its own synthetic trip in cleanup; it did not search suppliers or create reservations.

Inspected final captures: [initial consultation](screenshots/london-consultation-railway.png), [London after reload](screenshots/london-fixed-railway.png), [Osaka after reload](screenshots/global-osaka-railway.png).

Final read-only supplier probes also passed on this deployment: the flight endpoint returned **30 sandbox round-trip offers** for two adults, LHR–JFK, 18–22 November 2026, with both journeys and complete-party price scope; the hotel endpoint returned **12 sandbox offers** for two adults in Lisbon, 18–20 November 2026. Both returned HTTP 200 and `mode: test`. These used a new anonymous session and hardcoded fictional criteria, read no saved trip/profile, and called no reservation or payment endpoint.

The sandbox hotel checkout evidence above remains applicable; flight confirmation remains disabled because of the unresolved LiteAPI verification failure. This release does not establish production payments, family supplier pricing or universal venue accessibility.
