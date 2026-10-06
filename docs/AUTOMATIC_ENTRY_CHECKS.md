# Automatic entry checks and short conversations

Destination suggestions previously checked general travel advice, while passport-specific entry research waited for a selected route. This left a suggested destination such as Kyoto without visa guidance even when the client had a declared passport.

Suggestions now receive an automatic second check for the **passport declared in the active trip**. Cards show pending, conditional, conflicting, unverified or unavailable guidance. Open the small entry-guidance row for conditions, separately stated electronic authorisation, missing facts and searched sources. A suggestion is still preliminary: a suggested number of days is not a confirmed stay, and unknown dates, purpose, transit or transport remain unresolved. The selected route receives its own full travel briefing.

Residence and nationality do not establish which passport a traveller will use. Different passports in one party need separate checks; the lead client's passport does not cover everyone. Changing the active trip's passport, purpose, activities or transport invalidates candidate entry advice without discarding the destination shortlist. Editing a saved profile does not silently overwrite an explicit passport in an existing proposal. Both research caches expire after six hours. A failed candidate check stays visible as unavailable and does not discard successful checks for other suggestions.

## Selected destinations before exact dates

A known route stop and country now start the travel briefing before arrival, stay length or route approval. With a declared passport, Tara researches conditional preliminary entry guidance in a separate `preliminaryEntryRequirements` result. Unknown dates, purpose, transit or transport remain listed as unresolved. It is never copied into the full `entryRequirements` array or treated as confirmed eligibility. If no passport is known, only entry is skipped; destination climate research still runs.

Undated or flexible-date stops use `climate_overview`, not a dated forecast. Ordered confirmed dates and a declared purpose invalidate the preliminary key and trigger a new full entry check and seasonal weather outlook. A pending date contradiction keeps the checks preliminary. Changes to passport, purpose, declared activities, date flexibility, explicit trip duration, return departure or route invalidate the relevant saved evidence. An unknown country is reported per stop without blocking other known stops.

The conversation offers Flight/Cruise route research before requesting hotel arrival. A chosen supplier schedule can supply the arrival; the existing route editor remains available. **Entry & weather** shows the automatic checks and their sources without requiring a separate visa/weather action.

## Repeat the short honeymoon conversation

Start a new fictional proposal. Send each line as a separate message:

```text
hi
Kyoto
honeymoon
3 nights
2 adults
no children
arrive 18 November 2026
leave 21 November 2026
Australian passport
AUD 5000 total
vegetarian and quiet gardens
flights arranged separately
```

The route should be Kyoto, Japan, **18–21 November 2026 / three nights**, for two adults and no children. Honeymoon is tourism, vegetarian dining and gardens remain preferences, and separately arranged flights should not be the next automated fare-search action. Review and accept the route, then send:

```text
Build our complete Kyoto honeymoon itinerary for 18–21 November 2026, using the agreed details. Keep it relaxed with sourced quiet gardens, cultural visits, vegetarian meals and downtime. Flights are arranged separately. Keep travel days flexible; no bookings, invented prices or guaranteed opening times.
```

Check four calendar days, sourced suggestions, saved edits after reload, and the private preview/PDF. A missing hotel choice or transport schedule must stay unresolved rather than become a booking.

## Repeat the short Nepal conversation

Use a separate fictional proposal:

```text
five friends hiking in Nepal
holiday
5 adults, no children
Kathmandu then Pokhara
Kathmandu 1 night
Pokhara 4 nights
arrive 10 November 2026
leave 15 November 2026
Australian passports
AUD 9000 total
day hikes only, no overnight treks
vegetarian
```

Expected route: Kathmandu **10–11 November**, then Pokhara **11–15 November 2026**; five adults, no children. Review and accept the route, then ask for the complete day-by-day itinerary. Hiking suggestions must preserve the day-hike limit and disclose guide, permit, route and weather checks. They must not imply permits or guides have been arranged.

When Tara asks about one named stop's nights, `3`, `three` or `three nights` can answer that question. An ambiguous reply affecting several stops should trigger clarification. In a conflicting-date question, `three nights` selects that stored alternative; a vague `yes` is not permission to invent a choice. Single-stop changes such as `one more night` retain the destination and update the calculated departure.

## Repeatable verification

The existing [trip prompts](TRIP_SCENARIO_PROMPTS.md) cover honeymoon, hiking, business, family, rail, accessibility, solo one-way, year-boundary and destination replacement. Cruise, supplier-party and environment checks are described in the [testing guide](TRIP_SCENARIO_TESTING.md). The new short-answer fixtures are `tests/fixtures/studio-short-conversations.json`.

On an isolated local API with configured AI:

```sh
STUDIO_SCENARIO_MATRIX=1 node scripts/studio-scenario-matrix.mjs \
  --base http://localhost:3018 \
  --fixtures tests/fixtures/studio-short-conversations.json \
  --out /private/tmp/asktara-short-conversations

STUDIO_CANDIDATE_ENTRY_SMOKE=1 node scripts/studio-candidate-entry-smoke.mjs \
  http://localhost:3018
```

The Chrome runner creates a fictional saved client, requests Kyoto suggestions, verifies automatic passport checks **before route selection**, preserves an unsent chat draft, corrects the active passport and checks cached reload behaviour. It deletes its own client and workspace and makes no supplier-search, booking, payment or publication request. Exact provider replies and screenshots stay outside version control in its report directory.

Final measured results and environment checks are recorded in [verification](VERIFICATION.md). These are a finite regression matrix, not a guarantee of every future itinerary, supplier result or immigration decision.
