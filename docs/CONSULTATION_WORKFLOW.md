# Tara consultation workflow

The concierge now starts with a conversation, using Australian English and AUD as the default **requested budget currency**. GPT-6 Astra extracts the customer's requirements; a deterministic consultation layer records which facts were actually supplied and chooses the next questions. It does not assume the customer is Australian, lives in Australia, has an Australian passport, or wants to fly.

## From a request to a trip

1. Preserve the named destination, dates, party and preferences. Global destination names can remain pending while intake continues; the featured destination catalogue never replaces them.
2. Ask at most two core questions per reply. Establish dates or flexibility, duration, party, help with flights/accommodation, budget and interests. Earlier answers remain saved, including short contextual replies such as “yes, both”. Explicit “itinerary only” is a valid service scope.
3. Research when the core brief is ready. OpenAI web search supplies destination and place evidence; a separate verification pass checks closure information before itinerary composition. Deep findings, practical preparation, citations, daily details and pricing status stay in the trip panels. Ordinary chat replies remain short; an explicit request for detail can produce a longer answer.
4. Ask supplier-specific questions when needed. Flight departure and return dates are distinct from holiday dates. An itinerary can proceed while an airport, exact flight dates or hotel rate nationality still needs clarification.
5. Build and refine the schedule while retaining protected stops. Informational questions preserve the saved itinerary and consultation facts. Material route, date or duration changes require flight dates and existing arrangements to be rechecked.

## Data and guardrails

- Flights and accommodation each have four explicit states: **not discussed**, **help requested**, **already booked**, and **not needed**. A legacy `false` checkbox does not mean the customer declined. Generated replies and progress events use the saved state.
- Internal numeric placeholders never become confirmed customer choices. Home submits only selected details; editing a draft records only edited values and does not generate a premature itinerary.
- Extracted facts cite a literal excerpt from the current customer message. Model-only claims cannot establish a decline or booking. Saved profile preferences have separate provenance.
- The budget target retains its currency. Existing place and meal estimates remain in USD; AUD targets are labelled separately, with no invented exchange rate or comparison between currencies. Sandbox supplier prices are excluded from live trip totals.
- Supplier adapters currently support adult-only party pricing. Family requirements and child ages can inform the itinerary, but family hotel/flight pricing is withheld instead of treating children as adults. Trip-scoped hotel search enforces this on both client and server.
- One-way/return flight choice and transport dates must be supplied explicitly. No automatic return flight or assumed same-day departure from Australia. Multi-city booking remains unsupported and is explained in trip notes.
- Hotel lead-guest nationality is only a hotel rate field. Entry requirements require actual passport nationality, purpose and route context; preparation research prefers official sources. Passport numbers are not collected during consultation.
- Rejected research gets at most one fresh attempt with the same source, route, privacy and suitability checks. Service authentication failures and supplier mutations are not retried this way. Fixed diagnostic codes identify failures without logging customer content or provider response bodies.
- Intake reserves output space for both reasoning and structured results. An explicit token-limit failure gets one larger attempt; content-filtered or unspecified incomplete responses do not trigger that retry. Cancellation remains effective during either attempt, and the overall planning run remains bounded to six minutes.
- Consultation and research remain private to the trip owner. Public destination metadata cannot contain personal requirements; shared trip endpoints continue stripping private brief, research and chat.

## Connected services

OpenAI powers intake, current web research, verification and composition. LiteAPI remains the single connected supplier for hotel and flight data, using the user's requested sandbox environment. No additional key is needed for this consultation release.

Sandbox hotel checkout, retrieval and cancellation remain available. Flight search is connected; flight reservation confirmation remains disabled while the current LiteAPI sandbox offer-verification failure is unresolved. See [the booking workflow](BOOKING_WORKFLOW.md) and [the LiteAPI flight support packet](LITEAPI_FLIGHT_SUPPORT.md). This release does not claim production booking readiness or complete parity with Odessia's private backend.

## Verification

Regression coverage includes the exact London complaint, missing/default details, natural service replies and changes of mind, global pending routes, currency preservation, past dates, child-party pricing guards, flight/holiday date separation, route and duration changes, informational answers, protected stops, owner isolation and persistence. Browser checks cover desktop/mobile consultation, explicit settings, response chips, concise chat and separate research panels. The live London-to-Osaka browser journey checks actual GPT-6 research, verification, persistence and follow-up edits.

Reference observations and primary Australian travel-preparation sources are documented in [Consultation research](CONSULTATION_RESEARCH.md).
