# Travel scenario testing

These fictional scenarios exercise the same Studio API used by the website. They cover conversational intake, corrections, route acceptance, researched daily plans, persistence and private proposal PDFs. Cruise scenarios additionally cover reviewed source imports, sea days, early disembarkation, manual transfers and regeneration. The supplier matrix independently checks actual sandbox hotel and one-way flight searches. The exact prompts are in [the conversation fixtures](../scripts/fixtures/studio-scenarios.json), [the additional edge fixtures](../tests/fixtures/studio-scenario-edges.json) and [the short-answer fixtures](../tests/fixtures/studio-short-conversations.json).

## Repeat in the website

The [copyable prompts](TRIP_SCENARIO_PROMPTS.md) present ten longer conversations in reading order, with their expected final routes and budgets. [Short-answer prompts](AUTOMATIC_ENTRY_CHECKS.md) add the Kyoto honeymoon and Nepal hiking holiday, including automatic passport checks on destination suggestions.

Open `/studio` in the local app and create a separate new proposal for each scenario. Paste its messages one at a time. Check the destination order, arrival/departure dates, nights, party, budget and preferences against the fixture's `expected` fields. Then continue to the route, review and explicitly accept it, and use the fixture's `itineraryPrompt` to generate the daily plan. Reload, inspect the saved itinerary and download the private proposal PDF.

Do not treat a successful response alone as a pass. Every requested calendar day must appear, corrections must replace the old facts, cited research must have evidence, and unconfirmed timings, prices and arrangements must remain unconfirmed. A five-night trip normally contains six calendar dates including arrival and departure.

## Coverage

See [the actual-model results](TRIP_SCENARIO_RESULTS.md) for the final conversation outcomes and [verification](VERIFICATION.md) for cruise, supplier, browser and backend results, including the defects found before successful replays.

| Scenario                       | Main checks                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Bali honeymoon                 | Two adults; Ubud within Bali; extend four to five nights; vegetarian food, quiet pace and no nightlife.                         |
| Nepal hiking group             | Five adults; Kathmandu/Pokhara; change 2+3 nights to 1+4; day hikes only; guide/permit arrangements remain unconfirmed.         |
| New York business              | Correct arrival date; five nights; Wednesday–Friday meeting hours remain free; leisure stays outside those hours.               |
| Orlando family                 | Two adults and children aged six and ten; alternating parks/rest; no invented ride eligibility or tickets.                      |
| Japan rail holiday             | Tokyo/Kyoto; change 3+3 nights to 2+4; preserve final departure, train intent and vegetarian food.                              |
| Paris with access requirements | Explicit step-free requirements, short walks and seated breaks; access needs verification rather than an unsupported guarantee. |
| Solo Lisbon                    | One-way travel; EUR 1,800 whole-trip budget, not per day; no invented return flight or nightlife.                               |
| Sydney over New Year           | Four adults; six nights spanning December 2026 and January 2027; future holiday events remain unconfirmed.                      |
| Destination replacement        | Replace Lisbon with Porto and new dates; the old route must disappear.                                                          |
| Initially incomplete honeymoon | Do not invent a destination/date; then build the supplied Mauritius trip.                                                       |
| Mediterranean land and cruise  | Barcelona land stay, dated ports and sea day, Rome land stay; preserve flights, manual transfer and full EUR 3,800 cruise fare. |
| Asian cruise with early exit   | Leave at Keelung on day three, then Taiwan land travel; retain source schedule and full USD 4,500 fare.                         |

## Run the actual-provider matrix

The scripts require a local API, configured OpenAI access and explicit opt-in. They create fictional private workspaces and delete those workspaces afterwards. They never reserve, pay or publish. Generated reports, replies, PDFs and browser captures go outside the repository. Do not use saved real-client workspaces as fixtures.

An isolated API can use a separate SQLite file while keeping the usual local app available:

```sh
PORT=3018 WEB_PORT=5175 APP_ORIGIN=http://localhost:5175 \
DATABASE_PATH=/private/tmp/asktara-trip-matrix.sqlite \
node --env-file=.env --import tsx server/index.ts
```

In another terminal, start its frontend if running the cruise browser checks:

```sh
PORT=3018 WEB_PORT=5175 npx vite --host 127.0.0.1
```

Run the six main conversation scenarios and the four additional cases:

```sh
STUDIO_SCENARIO_MATRIX=1 node scripts/studio-scenario-matrix.mjs \
  --base http://localhost:3018 --out /private/tmp/asktara-travel-main

STUDIO_SCENARIO_MATRIX=1 node scripts/studio-scenario-matrix.mjs \
  --base http://localhost:3018 --fixtures tests/fixtures/studio-scenario-edges.json \
  --out /private/tmp/asktara-travel-edges --concurrency 1
```

Use `--case bali_honeymoon,nepal_hiking` to repeat only named scenarios. Each directory contains `matrix.json`, `matrix.md`, and per-scenario `result.json`, `walkthrough.md` and `proposal.pdf` when generation succeeds. Reports retain failed checks even when later steps succeed. A nonzero exit status means at least one scenario failed.

Run the two cruise journeys, including actual AI extraction/regeneration and Chrome proposal checks:

```sh
ASKTARA_RUN_LIVE_CRUISES=1 ASKTARA_CRUISE_BROWSER=1 \
ASKTARA_CRUISE_BASE_URL=http://localhost:3018 \
ASKTARA_CRUISE_FRONTEND_URL=http://localhost:5175 \
ASKTARA_CRUISE_OUTPUT=/private/tmp/asktara-travel-cruises \
node scripts/test-live-cruise-scenarios.mjs
```

The synthetic schedules, land stays and manual actions are defined in [the cruise script](../scripts/test-live-cruise-scenarios.mjs). They are authored test schedules, not real sailings. It checks source-day identity, retained edits, early exit, full fare, all trip dates, land-day research, saved services, private preview, PDF and reload.

Set `ASKTARA_CRUISE_CASE=asia-early-disembarkation` or `mediterranean-honeymoon` to repeat one cruise; omitting it runs both. The browser check opens **Preview proposal** from the compact trip board, then **Preview client proposal** in the details popup. It never publishes or books.

Run the three independent sandbox supplier-party checks:

```sh
STUDIO_SUPPLIER_PARTY_MATRIX=1 \
STUDIO_SUPPLIER_MATRIX_OUT=/private/tmp/asktara-travel-suppliers \
node scripts/studio-supplier-party-matrix.mjs http://localhost:3018
```

This last script starts from an explicitly entered route and party, rather than retesting conversational extraction. It checks Orlando family hotel occupancy, missing child-age validation, a five-adult Kathmandu hotel search and a solo Lisbon hotel plus one-way flight search. Supplier quote counts and availability vary between runs.

## Deterministic regression checks

`npm test` includes leap dates, invalid dates, year rollover, incomplete/mixed passport declarations, unknown traveller counts, child ages, currencies, negated budget bases, destination changes, multiple-stop boundaries, open-jaw routes, one-way corrections, stale transport quotes, cruise reapplication and reviewed cruise regeneration. Controlled model responses test validation and rollback; they do not establish live model reliability.

`npm run check`, `npm run build`, `npm run format:check` and the relevant `tests/studio-*.spec.ts` browser cases complement the actual-provider scenarios. The [verification record](VERIFICATION.md) separates live results from mocked checks.

## Current boundaries

This matrix gives broader evidence than one business-trip example; it cannot prove every possible trip or every future AI response. It also does not establish production deployment or booking capability.

- Family hotel searches include confirmed child ages. Family flight search still requires a reviewed manual quote; the app must not silently quote only the adults.
- Hotel search currently requests one room for the supplied party. Automatic allocation across multiple rooms is not implemented.
- A supplier can return incomplete inventory; the UI/report must retain that status. Sandbox offers are not confirmed rates or reservations.
- One-way search is supported. A rejected return flight remains represented as undecided return transport plus the explicit no-return requirement in the brief.
- AI-generated plans are limited to 35 calendar days; manual plans support up to 366. Unsupported sizes must be rejected explicitly.
- Cruise early exit retains the full source fare. It does not imply a prorated refund, a booked transfer or supplier approval to leave early.
- Current travel conditions, permits, visa eligibility, accessibility, exact transport times, ticket availability and future operating hours require the corresponding current evidence or supplier confirmation.
