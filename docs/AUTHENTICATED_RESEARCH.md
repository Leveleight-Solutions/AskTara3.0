# Signed-in Odessia inspection and Asktara alignment

Inspected on 11 September 2026 in the Chrome session supplied by the project owner. This follows the earlier [public itinerary inspection](ITINERARY_RESEARCH.md). Sources are the visible [Odessia interface](https://odessia.com/), [travel preferences](https://odessia.com/account/travel), [personal information](https://odessia.com/account/profile), and [settings](https://odessia.com/account/settings). Account pages require sign-in.

Chrome's normal AppleScript page automation became available after enabling **View → Developer → Allow JavaScript from Apple Events**. The in-app browser execution tool was unavailable. Inspection used visible DOM and ordinary UI actions, without reading credentials, browser storage, network authentication, application internals or private backend code.

## Tested itinerary flow

The synthetic request was a five-day Kyoto trip for two adults, 12–16 April 2027, with a US$2,500 group budget excluding flights, food/culture interests and a relaxed pace. The resulting conversation and synthetic draft trip remain in the supplied account. No booking, payment, invitation, email or public share was made, and existing account preferences were not changed.

1. **Conversation creation.** The homepage composer accepted the request and navigated into a persistent conversation. It streamed progress and recommendations, with a stop-response control while work continued.
2. **Research within chat.** A destination guide card appeared, followed by dated hotel results, activity results, individual place recommendations and an interactive Google map. Hotel cards showed trip totals and nightly amounts, review aggregates and availability controls. These are observed displays, not independently verified inventory or prices.
3. **Daily plan proposal.** A structured plan appeared with five dated day selectors. The displayed first day contained named places, scheduled times, contextual descriptions and travel gaps. The plan provided save-to-trip, copy and request-changes actions.
4. **Saving is a separate action.** Selecting the proposal's save action submitted a contextual message and triggered scheduling progress. The conversation reported 19 saved places; a separate trip panel showed the dated itinerary and a 19-item trip control. An activity requiring a specific time slot was explicitly left unsaved. The proposed hotel remained an accommodation choice rather than a reservation.
5. **Saved-trip controls.** The trip panel exposed day selectors, per-place time-edit and detail controls, trip dates, travelers, destination changes, adding a destination stop, daily directions, calendar download, copying, sharing and return to chat. These controls were inspected; calendar output, share behavior and time edits were not executed or fully verified on Odessia.
6. **Contextual follow-up.** Request-changes attached a daily-plan context chip to the composer. A follow-up asked for two main stops on Tuesday, leaving the other four days unchanged and updating the saved trip. The response displayed two removal events, a revised proposal and a 17-item saved-trip control. This verifies that the follow-up affected saved-trip state. It does **not** establish a complete day-by-day diff: the browser inspection did not reliably switch the saved panel to Tuesday, and the statement that all other days were unchanged was the assistant's claim rather than an independently verified comparison.

The saved trip displayed an unpriced trip total while separately researched hotel cards displayed prices. Product design should distinguish recommendations, saved itinerary stops, quoted inventory and confirmed purchases.

## Observed interface contracts

These labels and DOM attributes were observed directly and are recorded as inspection evidence, not as instructions to assume they remain unchanged:

| Surface           | Observed controls or structure                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage and chat | `Message Odessia` textarea; `Send message`; `Stop response`; party/room and date controls                                                          |
| Conversation      | `role=log`, accessible name `Chat messages`; accommodation/activity result regions; map region                                                     |
| Generated plan    | Dated day buttons; `Add this plan to my trip`; `Copy plan`; `Request changes to this plan`                                                         |
| Trip panel        | `data-testid=trips-panel`; `Edit trip dates`; `Edit travelers`; per-place time/details; `Open daily directions`; `Download calendar`; `Share trip` |
| Navigation        | New chat, wishlist, trips, referrals, travel preferences and account                                                                               |

## Account and preference analysis

Travel preferences cover companions, personal interests, travel range, discovery style, surroundings, risk tolerance, cultural interests, hotel styles/priorities/atmosphere, booking habits, loyalty programs, home cities, flight cabin and avoidances, travel frequency, accommodation budget, work travel, dietary restrictions, accessibility requirements and freeform notes.

The personal-information page exposes contact and address fields, birth date and an email verification action. Settings expose theme, connected accounts, sign-out and account deletion with typed confirmation. Only field labels and available actions were needed for the analysis; entered personal values were not used in the implementation.

Asktara implements the planning-relevant subset with actual persistence: pace, interests, home airport, nationality, dietary preferences, accessibility preferences and notes. Account name/password changes, session revocation, data export and confirmed deletion are also implemented. Companion records, loyalty programs, business expense rules, personal address/birth-date forms, theme switching, connected identity providers and email verification are not claimed as complete.

## Implementation alignment

| Reference behavior                          | Asktara implementation                                                                                         | Remaining limit                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Natural-language trip intake and follow-ups | Typed intake, optional structured model calls, persisted brief and conversation                                | Flexible AI behavior needs an OpenAI key; no-key behavior is deterministic and catalog-limited                               |
| Research followed by scheduling             | Separate destination, places, stays, flights, itinerary and review stages; observable run progress             | This is Asktara's own architecture, not a discovery of Odessia's private agents                                              |
| Dated, structured plans                     | Day timelines, duration and travel gaps, route/day allocation, per-stop edits and completion                   | Travel gaps are estimates until a routing data adapter is implemented                                                        |
| Save and edit existing trip                 | Automatic draft persistence; catalog experiences/stay ideas can be added to a selected day in an existing trip | Asktara intentionally saves generated drafts automatically; it does not reproduce the proposal-then-save interaction exactly |
| Reliable follow-up mutation                 | Revision checks, protected stops, cancellation, history restore and atomic plan/run commits                    | Real supplier constraints must still be confirmed                                                                            |
| Map and place details                       | Genuine Google directions links; optional Maps Embed iframe; fresh Google Places details                       | Embed needs its separate browser-restricted key; no custom synchronized hotel-price map layer                                |
| Account travel defaults                     | Owner-scoped profile used in new plans, with guest-to-account migration                                        | Dietary/accessibility requirements are unverified constraints, never suitability guarantees                                  |
| Flight offers                               | All requested journeys and segments, carrier/baggage details, original currency, test labels and expiry        | Search and review only; orders, payments, issuance and servicing remain to be built                                          |
| Hotel offers                                | Optional LiteAPI date/occupancy search and clear sample/live/test distinctions                                 | Rate selection, prebook, checkout, booking webhooks and cancellation remain to be built                                      |
| Activities                                  | Curated ideas, wishlist and existing-itinerary insertion                                                       | Live activity inventory and reservations need an approved provider and an adapter                                            |
| Export and sharing                          | Dated calendar file, revocable read-only sharing and private cloning                                           | Odessia's exported file and share implementation were not compared                                                           |

## Architectural conclusions and boundaries

The visible sequence supports a product requirement for a shared trip brief, tool-backed recommendations, structured schedule state and contextual edits. It does not reveal Odessia's model, prompts, number of agents, provider contracts, database, ranking system or internal implementation. Tool-progress text is not proof of a particular framework.

Asktara therefore uses its existing TypeScript stack, server-side typed stages and a durable SQLite run/revision model. AI-generated proposals are validated against researched places before persistence. A useful response must correspond to an actual saved revision; cancellations and stale runs cannot overwrite later edits.

This delivers a working local planning product and configured provider adapters. It is not an exact reproduction of every commercial Odessia feature or a finished travel booking business. Additional production work includes supplier-approved booking/payment/servicing flows, activity and routing adapters, email account recovery/verification, deployment operations and licensed global destination coverage. See [implementation status](IMPLEMENTATION_STATUS.md), [integration keys and responsibilities](INTEGRATIONS.md) and [verification](VERIFICATION.md).
