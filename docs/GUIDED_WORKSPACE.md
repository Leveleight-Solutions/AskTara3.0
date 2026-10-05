# Guided Agent Studio workspace

Start at `/studio`. A new workspace opens **Client & trip** with a compact customer desk and one missing trip question. On mobile, **Trip workspace** opens first and customer details can be expanded when needed. **Chat with Tara** remains available for natural-language planning and importing notes.

The customer desk contains client, traveller, trip and preference fields. It also retains private client profiles, photos, history and deliberate returning-client selection. Saving changes sends only edited fields; background research does not erase a draft. Selecting a profile does not carry a previous trip's party count into the new trip.

The guide asks for destination, party, child ages when relevant, dates, nights, nationality, purpose, transport, budget and hotel preferences. Direct answers save declared facts through the workspace API. Unknown fields stay unknown when skipped. Detailed route editing, destination inspiration, entry research and cruise imports remain available under **Route**. Accepting the route still unlocks accommodation, activities, ideas and proposal tools; material route changes require acceptance again.

## Automatic travel briefing

Once every chosen stop has a country and actual arrival/departure dates, the interface requests entry and weather guidance automatically when AI is configured. Pending clarification pauses research. Research runs beside editing and covers up to 20 stops with bounded concurrency. It does not select a destination or reserve services.

- Entry research uses the declared passport country, purpose, activities and transport for each stop. Missing nationality, unsupported evidence or conflicting rules remain visible as uncertainty. Source links and detailed conditions are available within the briefing.
- Weather uses verified primary meteorological or government climate sources for usual seasonal patterns and packing advice. It is explicitly a **seasonal outlook**, not a forecast for specific future days. Unsupported daily predictions are rejected. An unavailable result does not prevent the other checks or manual planning.
- Fresh, matching seasonal guidance informs AI itinerary generation, including suitable outings and indoor alternatives. Activity citations still require current research. Unrelated identity, photos, birth dates and private entry information are excluded from weather research and its itinerary context.

Results are stored privately on the workspace and cached for six hours against declared route, dates and entry context. Relevant changes invalidate them; stale results are hidden. Partial results are cached too, avoiding repeated provider requests. The refresh control allows an explicit retry. Background saves preserve unrelated edits; changes to their research inputs reject a stale save. In-progress abandoned requests are cancelled when their last subscriber disconnects.

Hotel quotes remain valid only while their search criteria match. Background briefing metadata does not clear hotel results, an unsaved route or unfinished proposal pricing. Proposal previews still exclude private chat, profile images, nationality, date of birth, source documents and internal pricing fields. Travel checks remain agent guidance rather than an entry guarantee or supplier confirmation.

## API

`POST /api/studio/workspaces/:id/trip-briefing`

```json
{
  "revision": 4,
  "requestId": "a-new-uuid",
  "force": false
}
```

The response includes `workspace`, `briefing`, `reused` and optionally `replayed`. The briefing has an input key, checked time, complete/partial status and per-stop entry/weather results. The route, owner, revision and request identity are checked on the server. A changed research context returns HTTP 409 rather than overwriting it. See `/api/docs` for the schema.

Run with `npm run dev`. With this checkout's configuration, open `http://localhost:5174/studio`; the API is on port 3002. AI research requires the server-side OpenAI key. Basic planning still supports the client desk, direct answers, manual routes and private proposals without that key.

## Try the verified fictional journey

Create a new proposal and save a fictional client name and Australian passport nationality in the customer desk. Send Tara this request:

> This is a fictional honeymoon holiday for two adults, no children. We will fly both ways from Melbourne on Australian passports. Our single destination is London, United Kingdom: arrive 20 November 2026, stay three nights and leave 23 November 2026. Total group budget AUD 5000. Prefer a 4-star central hotel in Soho, vegetarian meals, quiet gardens and relaxed cultural visits, with no nightlife. Start with the brief and route; no bookings.

The route should retain 20–23 November, three nights, two adults and AUD 5000. Entry and seasonal weather checks should start without a separate research click. Review and accept the route, inspect clearly labelled sandbox hotel suggestions, and select a proposal item if desired. In **Daily activities**, request a relaxed four-day plan with vegetarian dining, gardens, cultural visits and indoor alternatives. Preview and download the private proposal; reload to check persistence. Supplier responses can vary, and missing evidence remains explicit.

Inspected views: [desktop intake](screenshots/studio-guided-desktop.png), [mobile intake](screenshots/studio-guided-mobile.png), [automatic briefing](screenshots/studio-automatic-briefing.png), [saved itinerary](screenshots/studio-guided-itinerary.png), and [mobile itinerary](screenshots/studio-guided-itinerary-mobile.png). Itinerary captures replay the recorded live plan in a labelled layout fixture. Dated checks and provider limits are recorded in [verification](VERIFICATION.md).
