# Asktara product research

**Later inspection:** [Signed-in workflow analysis](AUTHENTICATED_RESEARCH.md) now covers generation, saving, follow-up changes, preferences and account controls. The access limits in this document describe the initial public-page research.

Research date: 11 September 2026. Scope: public pages and official provider documentation, without logging into Odessia or making a purchase. This is a product reference, not a claim to have inspected its private implementation.

## What the reference exposes

[Odessia's homepage](https://odessia.com/) presents an AI travel concierge centered on a conversation. Its four entry points are accommodation, flights, activities, and destination discovery. The homepage includes destination cards, hotel recommendations, experience cards, reusable itineraries, and flight inspiration. It advertises personalized recommendations, calendar export, sharing, and adapting an itinerary to new dates. Navigation links expose trips, wishlist, travel preferences, and profile pages. It is marked as a preview.

The same page advertises airline coverage beyond Google Flights, points opportunities, large savings, and extensive hotel review analysis. These are marketing claims; this research did not independently establish their coverage, savings, data sources, or behavior. Asktara should not repeat them as promises. Some experience images use a GetYourGuide CDN; that alone does not establish a specific API or commercial relationship.

[Trips](https://odessia.com/trips) and [travel preferences](https://odessia.com/account/travel) returned only the preview notice to the web reader. Their authenticated workflows were not observable in this research. Destination and hotel detail fetches failed for sampled Kyoto URLs; they remain unverified.

[Odessia's booking terms](https://odessia.com/terms) describe a supplier intermediary and explicit customer confirmation before a financial or travel commitment. This supports designing a separate, deterministic review step before purchase. Terms describe a wider service scope than the public homepage; their presence does not establish that each service has an operational public UI.

## Asktara's core implementation target

These are proposed requirements derived from the public product concept, not verified descriptions of Odessia's internal behavior:

1. A responsive travel discovery page with a prominent conversational composer and entry points for stays, flights, experiences, and destination ideas.
2. A conversation that captures destination, dates, party size, origin, budget, and preferences, and can refine a proposed trip.
3. Structured travel results with destination information and transparent data provenance: curated inspiration, sandbox response, or live supplier result.
4. Persistent trips with editable day plans, saved places, preferences, sharing, and calendar export.
5. Supplier adapters that can be enabled independently when credentials are supplied. An AI key alone does not provide travel inventory.
6. A booking workflow that only reports confirmation after a supplier confirms an order. Search results, saved items, and payment success must never masquerade as confirmed reservations.

Use Asktara's own copy, mark, content, and illustrations. Aim for the same conversational travel workflow with a simple editorial interface; private algorithms, supplier deals, and exact hidden interactions cannot be reproduced from public pages.

## What requires further work or evidence

- Real supplier checkout, ticket issuance, post-booking changes/refunds, and operational support require additional implementation and approved provider accounts.
- Points comparison needs licensed award-availability data and current transfer-program information.
- Broad hotel/home coverage and price competitiveness depend on contracted inventory; a single provider cannot substantiate every market claim.
- Shared-plan privacy and durable user accounts need production verification in the actual hosting environment.
- No claim of complete Odessia parity should be made before authenticated flows, production supplier access, and the relevant end-to-end tests are available.

See [INTEGRATIONS.md](./INTEGRATIONS.md) for the recommended credentials and their purpose. See the project README for the implemented and tested state; this document records research and scope, not a release certification.
