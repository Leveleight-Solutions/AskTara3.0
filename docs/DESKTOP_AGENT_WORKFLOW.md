# Desktop itinerary workflow

Agent Studio is a desktop workspace with a client address book, an actionable conversation and a compact itinerary canvas. The saved trip remains the source of truth; choosing an option does not reserve travel.

## Start with the client

Open **Existing clients** in the left sidebar. Save or edit identity, a private photo, residence, nationality, passport country, date of birth, travel preferences and previous-trip feedback. Residence, nationality and the passport used for a trip are independent fields.

**Create a proposal** first opens a client picker. Select a saved client or create one, then start the proposal. The server creates the proposal and links the owned client atomically. It copies the client’s preferences and relevant context, while leaving dates and the travelling party undecided. Photos and DOB stay out of recommendation-model inputs and client-facing proposals.

The selected client appears above the conversation. With an undecided destination, Tara automatically researches ideas around their preferences and travel feedback. Eligible suggestions can become a draft route with one click; suggested stay lengths are clearly drafts to confirm. Changes to relevant saved preferences/history invalidate old inspiration without overwriting the current trip.

## Work in the conversation

Describe the trip normally, or use Tara’s next-step buttons. Missing details open a small answer popup; explicit answers save directly without another interpretation call. **Trip details** opens all editable brief fields, including the origin departure date separately from arrival.

Review the route in the canvas and choose **Use this route**. Approval unlocks service searches and itinerary generation. Stay/date contradictions retain explicit date-range choices beside the composer.

- **Hotels** opens the stay and nationality selector, asking only for missing party/room-search inputs. Supplier cards show property photos, photos mapped to the quoted room, full-stay prices, occupancy, cancellation/tax terms and recommendation reasons when supplied. **Add to proposal** saves that quote into the trip.
- **Flights** asks for explicitly selected airports, departure date, cabin and one-way/return intent. Cards show supplier carrier logos, flight segments, party-total fares, connections and reported overnight or airport-change warnings. Transit eligibility and hotel check-in/out times require carrier/hotel/authority verification; they are never invented from a city name. Automatic flight fares currently support adults only; family, open-jaw and other unsupported arrangements can be entered as reviewed supplier services.
- **Cruises** shows saved reviewed sailings and opens a schedule import/review popup. Actual pasted/imported schedules supply ship, dates, ports, sea days and fare; there is no live cruise inventory search. Early exit preserves the recorded full fare and stable source-day identities.
- **Things to do** and **Food ideas** research sourced suggestions around the current route and preferences. Choose **Add to a day**, pick a compatible destination day and period, and the server inserts the stored recommendation with its verified source links. The browser cannot introduce its own citations through this action.

Supplier photos/logos come from provider data. Missing or failed media has an honest fallback. Rich selections persist after reload. Sandbox rates remain labelled, expired prices cannot be newly selected, and changes to the trip flag affected saved services for review. Manual inclusion is a separate proposal action; booking, payment and publication are separate workflows.

## Use the itinerary canvas

The right side shows the route, concise travel-check status, one day at a time, selected services and budget. Select a day with the buttons or arrow keys. **Edit day** opens a focused editor for its title, date, notes and activities. It supports adding, deleting and reordering activities while retaining other days and cruise source identities. Background travel metadata can finish without clearing a typed draft; a concurrent change to the actual daily plan blocks overwriting it.

**Edit trip**, **Edit route**, **Manage days** and service **Edit** open the complete advanced tools on demand. Those retain imports, manual services, route editing, full itinerary editing, pricing, private preview, PDF export and the existing explicit publication/revocation controls. Save or discard a route draft before closing its editor or asking Tara for another route.

Visa/entry and seasonal-weather research runs automatically when the declared passport, purpose, countries and route dates are ready. The canvas keeps the overview short; **Details** opens the sourced briefing and any uncertainty. Seasonal guidance is labelled as an outlook, not a weather forecast.

The budget uses selected service amounts. Unpriced items remain identified, sandbox amounts are excluded and different currencies are listed separately without an invented exchange rate. Rates still need reconfirmation before booking.

## Repeat the checks

Run `npx playwright test tests/studio-clients-addressbook.spec.ts tests/studio-desktop-agent.spec.ts tests/studio-chat-offers.spec.ts` for synthetic desktop interaction checks. These tests inspect data persistence, price scope, stale-response handling and publication/booking boundaries; they do not establish live supplier availability.

With the local app and configured providers running, `node scripts/studio-desktop-smoke.mjs http://localhost:5174` creates a disposable fictional family client and exercises client selection, actual-model intake, route approval, automatic travel guidance, sourced days, actual sandbox hotel selection, manual editing, reload, private preview and PDF export. It deletes its own workspace/profile, makes no booking/payment/publication calls and writes evidence under a private temporary directory. `STUDIO_SMOKE_OUTPUT` optionally chooses that output directory. It can also target the deployed app.

A copyable initial request is:

> We want a relaxed family holiday in London, United Kingdom. Arrive on 1 May 2027 and leave on 4 May 2027: exactly 3 nights. There are 2 adults and 1 child aged 7, travelling on Australian passports. Total group budget AUD 8000. We prefer central 4 star hotels, vegetarian food, gardens and museums, with a daily rest break. Flights will be arranged separately.

Previous broad trip scenarios remain in [TRIP_SCENARIO_PROMPTS.md](TRIP_SCENARIO_PROMPTS.md). Release-specific results belong in [VERIFICATION.md](VERIFICATION.md).
