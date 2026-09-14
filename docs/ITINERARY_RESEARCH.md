# Itinerary workflow research

**Follow-up:** the later [signed-in inspection](AUTHENTICATED_RESEARCH.md) verified generation, saving and contextual follow-up behavior. The anonymous access limits below describe the earlier inspection, not the final research status.

Research date: 11 September 2026. Sources: [Odessia homepage](https://odessia.com/) and its publicly linked [Kyoto guide](https://odessia.com/destinations/japan/kyoto). Inspection used an isolated Chrome browser with no signed-in account. The in-app browser execution tool was unavailable, so the installed Playwright runner provided the fallback. No account, real traveler data, or purchase was used.

## What was directly observed

Capture filenames below identify local inspection artifacts under `docs/screenshots/odessia-itinerary/`. These images and DOM snapshots are not included in the public repository. Public source links remain available, and the reproduction commands below generate new local artifacts.

| Public observation                                                                                                                                                                                                                     | Evidence                                                                                                                                                  | Implication for Asktara                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage conversation composer has text, party/room and date controls; accommodation, flights, activities and discovery provide alternate entry points.                                                                                | Homepage screenshot: `01-home.png` (local), DOM: `01-home.yml` (local)                                                                                    | Capture a shared trip brief across planning and supplier searches.                                                                                                                                |
| Attempting to use the composer with a synthetic five-day Kyoto request opened an account modal at `/?auth=open`. No assistant response or generated plan was accessible. The party control also opened this modal.                     | Access boundary screenshot: `02-prompt-readiness.png` (local), DOM: `02-prompt-readiness.yml` (local), party-control DOM: `05-party-controls.yml` (local) | Exact authenticated generation, follow-up editing, and saved-trip behavior remain unverified. Asktara can provide a guest planning experience independently.                                      |
| The Kyoto guide exposes three named itinerary accordions with a short description. Opening one displays an ordered timeline, with times, contextual advice and linked places. The sampled sequence uses 08:00, 11:00, 14:00 and 17:00. | Expanded itinerary screenshot: `03-guide-itinerary.png` (local), DOM: `03-guide-itinerary.yml` (local)                                                    | Present structured stop times and relevant explanations; provide useful templates as well as personalized plans. This was an editorial sample, not observed generated output.                     |
| Clicking a place in the sample itinerary opens an overlay with photos, category, rating, reviews, website, opening hours, facilities and a Google Maps link. Save and share controls are visible.                                      | Place overlay screenshot: `04-place-link.png` (local), DOM: `04-place-link.yml` (local)                                                                   | Attach a stable place identity and provenance to each stop; enrich details through licensed place data. Presence of Google Maps links does not prove a specific private architecture or contract. |
| The guide has contextual transport, neighborhoods, dining, budgets and seasonal guidance, plus a trip-planning action and composer.                                                                                                    | [Kyoto guide](https://odessia.com/destinations/japan/kyoto), captured guide DOM: `03-guide-itinerary.yml` (local)                                         | Planning should include logistics and constraints, supported by maintained data. Individual guide facts were not independently fact-checked for reuse.                                            |
| Calendar export, sharing and broader transport planning are advertised on the homepage.                                                                                                                                                | [Homepage](https://odessia.com/)                                                                                                                          | These are public product claims. Export/share functionality behind the account boundary was not tested on Odessia.                                                                                |

Only the workflow and structure are product references. Do not copy the guide's prose, reviews, photographs or named sample descriptions into Asktara's catalog. The captures are research evidence, separate from shipped product assets.

## What cannot be inferred

The public UI does not disclose model choice, prompts, agent count, agent framework, retrieval method, database schema, provider coverage or ranking algorithms. It also does not establish how the generated itinerary handles conflicting requests, item locks, budget reconciliation or multi-city changes. We did not authenticate or attempt to bypass the account boundary. An exact replication claim would exceed the evidence.

## Baseline gaps identified in Asktara

These observations describe the code **before this itinerary upgrade**, not the eventual release status. See [implementation status](IMPLEMENTATION_STATUS.md) for the current feature inventory.

The initial `server/planner.ts` generated a fixed daily pattern from 12 curated destinations. Highlights and experiences cycled by array index, so long trips could repeat the same places. The optional AI path returned one complete plan against that catalog. Existing itinerary persistence, editing, sharing and calendar export already supplied a useful foundation, but the baseline lacked an explicit orchestration record, structured stop durations, route-aware feasibility checks, a protected-stop contract and clear separation between trip intake, evidence gathering, scheduling and validation. Multiple destinations were not represented in the original trip model.

The principal reliability gap was maintaining consistency through edits: dates, party size, budget, route and manual changes must refer to the same saved trip revision. A chat reply should not say an edit happened unless the structured itinerary was actually updated and persisted.

## Proposed implementation contract

This is Asktara's design, derived from the observed product concept; it is not a description of Odessia's backend.

1. **Trip intake:** persist destination/route, dates or duration, party size, total budget, pace, interests and exclusions. Ask for genuinely missing information or expose assumptions.
2. **Grounding:** select identifiable places and activities from a maintained catalog or provider. Record the source and distinguish estimates from live data.
3. **Scheduling:** allocate stops to destination days, apply a consistent timezone/date model, allow durations and travel gaps, and preserve protected or completed activities when adapting a trip.
4. **Validation:** check IDs, date/day coverage, ordering, overlaps, destination assignments and budget scope before publishing the plan. Report unresolved real-world checks honestly.
5. **Persistence and progress:** record each planning run and its stages, then commit the itinerary and assistant response together against the latest trip revision. Recover from provider failures without inventing success.
6. **User loop:** generate, inspect, edit, regenerate a selected part, save, share and export. Test a follow-up change that preserves unaffected days and protected activities.

For the existing TypeScript/Express/React application, typed server-side stages with shared schemas fit the current stack. A framework is optional; demonstrable responsibilities, validation and error recovery matter more than labeling a single prompt as several agents.

## API roles

| API/data capability                       | Purpose                                                                         | What it does not supply                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| OpenAI Responses API                      | Flexible language understanding and structured personalized proposals           | Verified inventory, venue hours or travel schedules by itself |
| Google Places or a licensed equivalent    | Stable place IDs, addresses, coordinates, current place details and attribution | Proof of availability on the intended visit date              |
| Google Routes or another routing provider | Travel durations and distances between stops                                    | Complete global rail, ferry and flight inventory              |
| LiteAPI                                   | Hotel search availability and prices through an approved account                | A booking merely because search succeeds                      |
| Duffel                                    | Flight offers through an approved account                                       | Ticket issuance without an implemented order/payment flow     |
| Approved activities provider              | Real bookable experiences, options, availability and prices                     | Permission to copy third-party editorial content              |

The first two existing supplier adapters and AI configuration are described in [integrations](INTEGRATIONS.md). Additional place/route/activity credentials should only be called active after an adapter is implemented and verified. Curated planning must continue to label unverified hours, costs and travel times explicitly.

## Reproducing this inspection

`node scripts/inspect-odessia.mjs --home` opens the public homepage without entering a request; `--guide` opens the observed Kyoto guide. Without either flag, the script attempts the same synthetic trip request and captures the resulting access state. It starts a JSON command loop on standard input for narrowly scoped `snapshot`, `click`, `prompt` and `stop` actions. Click names must come from the latest accessibility snapshot and must match uniquely. It never authenticates, extracts credentials, purchases or bypasses an access control.

Example capture command: `{"type":"snapshot","name":"inspection-state"}`. End the isolated browser with `{"type":"stop"}`. Generated images and accessibility snapshots are written under `docs/screenshots/odessia-itinerary/`, which is excluded from public Git history.
