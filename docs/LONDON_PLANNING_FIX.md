# Explicit destination handling and London coverage

The reported request named London, but London was missing from the original twelve-destination catalog. When no supported destination was selected, the local fallback ranked destination ideas using interests such as food. The workflow returned that discovery reply even though the traveler had already selected a city. The home form also appended its traveler count to prompts that already specified a party.

London is now in the catalog used by the planner, intake schema, destination pages and hotel search. Its curated highlights reference real museums and parks. These are planning ideas, not verified opening hours, dietary suitability, step-free journeys or current inventory. No fictional London hotel was added; accommodation without a supplier quote is listed as unpriced.

The planner distinguishes explicit destination requests from open discovery. Unsupported explicit requests receive a named coverage explanation; they do not trigger unrelated suggestions. An unsupported switch preserves an existing saved itinerary and protected stops until the destination can be resolved. Intake cannot replace a recognized destination with a model-selected alternative. The home form supplements only missing party/date details.

Regression prompt:

> Plan 4 days in London starting November 18, 2026, for 2 adults. We prefer vegetarian food, step-free access, and quiet places.

Expected: destination `london`, four itinerary days, start date `2026-11-18`, two travelers, and all stated preferences retained. No Bali, Marrakech or Istanbul recommendation should replace this request. Also check an unsupported city with food preferences, an unsupported switch from a saved plan, and an open-ended beach discovery request.

London editorial references checked on 12 September 2026:

- [National Gallery visitor access](https://www.nationalgallery.org.uk/visiting/access).
- [British Museum visitor accessibility](https://www.britishmuseum.org/visit/accessibility-museum).
- [London's Royal Parks](https://www.royalparks.org.uk/visit/parks).
- [Visit London quiet places](https://www.visitlondon.com/things-to-do/sightseeing/london-attraction/peaceful-places-you-wont-believe-are-in-london).

Worldwide destination coverage remains outside this bounded fix; the active curated catalog contains thirteen destinations. The application should explain coverage gaps rather than implying that a different destination satisfies the traveler's request.

## Verification

Railway deployment `beae59c0-cad4-43a4-af6a-f7b0b1668a1c` reached SUCCESS on 12 September 2026. Build, TypeScript and 102 backend tests passed. A browser input regression verified explicit party/date precedence and form defaults.

The real Chrome regression in `tests/london-ui.spec.ts` passed against the public HTTPS site in 20.4 seconds. It submitted the user's exact prompt, including the duplicated `for 2 travelers` suffix. Both AI stages completed without fallback, producing four London days from `2026-11-18` for two travelers and retaining vegetarian, step-free and quiet-place preferences. Reload and trip settings preserved those values.

A subsequent request to switch to unsupported Osaka clearly explained the coverage limit and preserved the London title, dates, brief and complete itinerary across reload. Only the synthetic test trip was deleted afterward. [Verified London itinerary screenshot](screenshots/london-fixed-railway.png).
