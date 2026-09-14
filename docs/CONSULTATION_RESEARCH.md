# Consultation behaviour and Australian travel preparation

Research date: 13 September 2026. This document describes implementation requirements, not a claim of legal, immigration, insurance or professional certification.

## Evidence and access boundary

The current [Odessia homepage](https://odessia.com/) presents a conversational concierge spanning destinations, accommodation, flights and activities. It advertises tailored recommendations, hotel tradeoffs, copied itineraries adapted to new dates, and a wider flight search. These are public claims; they do not establish research coverage or private implementation. Its public notice identifies USD as the default currency.

The earlier owner-authorized [signed-in inspection](AUTHENTICATED_RESEARCH.md) actually observed destination and supplier cards, place recommendations, a map, a dated proposal, a separate save action, and contextual changes to a saved trip. Preferences included hotel atmosphere, interests, travel companions, home cities, booking habits, dietary/accessibility needs and freeform notes. A time-slot-dependent activity was left unsaved rather than presented as completed. These findings support richer consultation and explicit readiness states.

Today's read-only Chrome inspection filtered only existing `odessia.com` tabs and found none. No new chat, booking, message, account edit or provider request was made. The recorded Kyoto prompt already supplied dates, party, budget and interests: **adaptive clarification from a sparse brief has not been directly observed on Odessia**. No exact model, hidden agent architecture or complete parity should be inferred.

## Product requirements supported by the evidence

| Requirement                          | Behaviour to implement                                                                                            | Evidence or gap                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Understand before recommending       | Reflect the known brief, then ask only the next useful missing questions. Accept partial or uncertain answers.    | Rich saved preferences and contextual chat were observed; sparse-prompt handling remains a proposed Asktara design. |
| Show the reasoning for choices       | Explain why an area, hotel style, route or activity fits the traveller, its drawbacks, and unresolved questions.  | Public hotel-tradeoff claim plus observed research cards; universal review coverage is not verified.                |
| Separate exploration from scheduling | Offer researched destination/route choices, let the traveller choose, then create the requested schedule.         | Observed proposal/save separation; Asktara's automatic draft persistence is a different interaction.                |
| Make revisions precise               | Preserve chosen cities, dates, constraints and protected stops; name the changes and leave unrelated days intact. | Contextual follow-up was observed, but a full independent day-by-day Odessia diff was not established.              |
| Keep readiness truthful              | Distinguish ideas, saved stops, current supplier quotes, unresolved time slots and confirmed reservations.        | Observed unsaved timed activity and unpriced itinerary beside priced hotel recommendations.                         |

Before the concurrent consultation work, Asktara already had structured intent handling, sourced research, venue closure checks and protected itinerary revisions. Gaps in the inspected code were a narrowly typed follow-up question set; no dedicated preparation profile; a USD-only budget report; and venue-focused research that intentionally deferred visa work to explicit questions. Sources: [planning contracts](../shared/planning.ts), [intake](../server/agents/models.ts), [research instructions](../server/agents/research.ts), [workflow](../server/agents/index.ts). This is a research snapshot, not an assertion that the concurrent implementation remains unchanged.

## A practical consultation flow

Ask at most three focused questions per turn, each tied to a decision. Retain answers, declined topics and stated uncertainty across reloads; do not restart a questionnaire. For example, a request mentioning Sydney already answers departure city. Ask about timing/duration, party, and budget scope before asking for finer hotel preferences.

Keep these distinctions explicit:

- Dates versus flexible travel windows; nights versus full sightseeing days; arrival/departure travel days.
- Total group budget versus per-person budget, its currency, and whether flights, accommodation and paid activities are included. Australian context may suggest AUD, but an ambiguous dollar amount needs confirmation. Never relabel existing USD estimates or supplier amounts as AUD; conversion requires an actual sourced rate and timestamp.
- Required constraints versus preferences: dietary restrictions, step-free needs, quiet rooms, pace, walking tolerance, must-sees and avoidances. Ask operational questions only where they help; avoid collecting medical diagnoses.
- Planning versus booking readiness. An undecided passport or insurer does not block a city itinerary. A price quote or travel-entry answer may require additional details. A complete planning prompt should proceed without needless re-interviewing.

An Australian travel-consultant style means clear, locally relevant service; it does not mean every user is an Australian citizen, departs Australia, spends AUD, or needs an Australian visa.

## Preparation questions grounded in official guidance

| Topic             | Trigger and useful question                                                                                                                                 | Research and output rule                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passport          | Before personalised entry guidance: “Which country's passport will each traveller use, and are any dual nationals?” Ask expiry only when checking validity. | Departure airport, residence, hotel lead-guest nationality and passport nationality are different facts. Keep preparation information private; no passport number or document upload is needed for consultation.                            |
| Entry and transit | Once a route exists: “Is this tourism only, how long will you stay, and where will you transit?”                                                            | Check the destination's official immigration/embassy sources for the actual nationality, purpose, duration and transit conditions; link the checked page and date. Missing details produce a targeted question, not an eligibility verdict. |
| Passport timing   | When travel is soon or renewal is mentioned: “Is the passport current, and when does it expire?”                                                            | Surface renewal lead time and destination-specific validity checks; do not turn a general six-month precaution into a universal entry rule.                                                                                                 |
| Insurance         | When dates or booking commitments become known: “Have you arranged cover for the full trip, including stopovers and planned activities?”                    | Offer a timely preparation reminder and official guidance. Ask whether the traveller wants help understanding what to check; never claim a policy covers them without its terms.                                                            |

Smartraveller says visa requirements depend on the nationalities held and intended activities, and directs travellers to official destination authorities. Transit can require its own visa; visa-on-arrival is distinct from visa-free entry. Its guidance for overseas travel is aimed at Australians, so users travelling on another passport need nationality-appropriate official sources. [Getting a foreign visa](https://www.smartraveller.gov.au/travel-essentials/getting-foreign-visa)

Smartraveller currently advises allowing at least six weeks for an Australian passport and checking validity before committing to flights. Some destinations and airlines require additional validity, including for transit; the exact requirement must be checked for the route. Dual nationality may change which passport is used and consular arrangements. Do not infer citizenship from an Australian home address. [Passport services](https://www.smartraveller.gov.au/passports)

The Smartraveller-hosted CHOICE guide recommends arranging insurance when travel dates are known and travel is booked/paid, rather than waiting until departure. If dates change, prompt the traveller to check the policy period with their insurer. Coverage is subject to the actual policy, not guaranteed by the act of buying insurance. [When to buy insurance](https://www.smartraveller.gov.au/choice-travel-insurance-buying-guide/buying-travel-insurance)

Smartraveller recommends reading the PDS, checking every destination and transit point, planned activities and relevant exclusions. Credit-card insurance may require activation; pre-existing health conditions should be discussed with the insurer, not stored as a detailed medical history in this planner. Cite current destination advice where relevant and distinguish a risk advisory from a legal prohibition. [Travel insurance](https://www.smartraveller.gov.au/travel-essentials/travel-insurance)

## Research depth and regression requirements

1. A sparse “Japan from Sydney” message gathers the missing timing, party and budget details without guessing Australian nationality or immediately scheduling a random city.
2. Supplied answers survive follow-ups and reloads; “not sure yet” remains unknown. Rejected destinations are not repeatedly proposed.
3. An explicit AUD per-person budget retains currency and scope. Supplier USD prices stay USD; missing conversion data cannot produce a fabricated AUD total.
4. A full dated itinerary request proceeds; an unrelated entry or insurance question preserves the saved route and protected items.
5. Each researched recommendation explains fit and a material tradeoff, cites its evidence, and distinguishes verified facts from unverified suitability. No unsupported claim of an exhaustive search or guaranteed access.
6. Entry guidance with missing passport nationality asks for it. Changing nationality, route, transit, purpose or dates invalidates dependent entry advice and triggers fresh official research.
7. Changing dates or adding skiing, cruising or another activity triggers a relevant insurance review reminder, without asserting coverage or requiring policy documents.
8. Consultation/profile details remain owner-scoped and absent from public destination snapshots, share links and clones. Research failure preserves the brief and current itinerary, reports the gap, and never fabricates completed preparation checks.

These requirements describe a consultant that helps the traveller make the next decision. They do not add authority to grant entry, approve insurance, certify accessibility, or confirm supplier reservations.
