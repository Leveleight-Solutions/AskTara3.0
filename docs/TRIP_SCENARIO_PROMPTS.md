# Copyable trip test prompts

Use a fresh proposal for each fictional scenario. Send the numbered messages one at a time. Review and accept the route before sending the final itinerary request. See [the testing guide](TRIP_SCENARIO_TESTING.md) for the scripts, cruise schedules, observed results and limits.

For one-word answers, automatic passport checks on suggestions, passport corrections and short multi-stop conversations, see [automatic entry checks and short prompts](AUTOMATIC_ENTRY_CHECKS.md).

## Bali honeymoon for two adults

Case: `bali_honeymoon`. Expected final route: **Ubud (5 nights, 2026-11-12–2026-11-17)**.

Expected party: 2 adults, 0 children. Total budget: AUD 5,000.

Message 1:

```text
This is a fictional test couple called Demo Bali Couple. We are two adults, no children, travelling from Sydney on Australian passports for a honeymoon holiday. Arrive in Ubud, Bali, Indonesia on 12 November 2026 for four nights, leaving on 16 November. Total budget AUD 5000. We prefer a 4-star hotel, quiet gardens, vegetarian food and a relaxed romantic pace. Start with the brief and route only.
```

Message 2:

```text
Please extend Ubud to five nights and leave on 17 November 2026. Keep it one destination, two adults and no children. We prefer gentle cultural visits and pool downtime, no nightlife. Keep the AUD 5000 budget and vegetarian meals.
```

After reviewing and accepting the route:

```text
Build the complete day-by-day itinerary for our confirmed Ubud honeymoon, 12–17 November 2026, five nights for two adults. Include sourced gentle cultural visits, quiet gardens, vegetarian dining and generous downtime. Keep arrival and departure flexible. Do not book anything, invent prices or promise availability.
```

## Nepal day hikes for five adults

Case: `nepal_hiking`. Expected final route: **Kathmandu (1 nights, 2026-11-10–2026-11-11) → Pokhara (4 nights, 2026-11-11–2026-11-15)**.

Expected party: 5 adults, 0 children. Total budget: AUD 9,000.

Message 1:

```text
Fictional test group Demo Nepal Hikers: five adults, no children, from Melbourne with Australian passports. This is a tourism holiday. Arrive Kathmandu, Nepal on 10 November 2026 for two nights, then Pokhara for three nights, leaving Pokhara on 15 November. Group budget AUD 9000, simple 3-star hotels, vegetarian meals and easy day hikes with scenic views. Start with route planning only.
```

Message 2:

```text
Change the split to one night in Kathmandu and four nights in Pokhara, still arriving 10 November and leaving 15 November 2026. We want day hikes only, no high-altitude expedition or overnight trek. Keep five adults and no children. Leave transfers flexible and explain any guide or permit checks without assuming they are arranged.
```

After reviewing and accepting the route:

```text
Build our complete 10–15 November 2026 itinerary: Kathmandu one night then Pokhara four nights, five adults. Use sourced suggestions for easy day hikes, scenic views and vegetarian meals. Preserve travel time on the transfer day. Avoid high-altitude or overnight treks, unsupported fitness assurances, booked guides or invented permit arrangements. No bookings or invented prices.
```

## New York business trip with corrected arrival

Case: `new_york_business`. Expected final route: **New York (5 nights, 2026-11-10–2026-11-15)**.

Expected party: 1 adults, 0 children. Total budget: AUD 6,500.

Message 1:

```text
Fictional traveller Demo New York Business, one adult with an Australian passport from Sydney, no children. I need a business trip for meetings in New York, United States. Arrive 9 November 2026, stay five nights and depart 14 November. Budget AUD 6500, a 4-star hotel in Midtown, vegetarian meals. Keep Wednesday through Friday 9 am to 5 pm free for business meetings. Start with the route only.
```

Message 2:

```text
Correction: my arrival in New York is 10 November 2026. Keep five nights, so depart on 15 November 2026. I am attending meetings only, no local employment or paid work. Keep one adult, no children, and all weekday 9 am to 5 pm meeting windows free. Any sightseeing should be gentle and after meetings or on Saturday.
```

After reviewing and accepting the route:

```text
Build my complete New York business itinerary for 10–15 November 2026, five nights, one adult. Keep 9 am–5 pm on Wednesday, Thursday and Friday free for meetings. Use sourced vegetarian dining and gentle optional evening sightseeing, with a relaxed Saturday. Arrival and departure times are unconfirmed. Do not make bookings or invent prices.
```

## Orlando family with children aged six and ten

Case: `orlando_family`. Expected final route: **Orlando (5 nights, 2026-12-01–2026-12-06)**.

Expected party: 2 adults, 2 children. Total budget: AUD 14,000.

Message 1:

```text
Fictional Demo Orlando Family from Brisbane with Australian passports: two adults and two children, exactly ages 6 and 10. We want a tourism holiday in Orlando, Florida, United States, arriving 1 December 2026 for five nights and leaving 6 December. Total family budget AUD 14000, a 4-star family hotel, theme parks with pool breaks. Start with the brief and route only.
```

Message 2:

```text
Keep two adults and the two children aged 6 and 10. We want one major park outing every other day with rest or pool days between, vegetarian meal options and early evenings. Do not assume the children meet ride height requirements. Avoid inventing tickets or treating future opening hours as confirmed.
```

After reviewing and accepting the route:

```text
Build the complete Orlando family itinerary for 1–6 December 2026, five nights, two adults and children aged 6 and 10. Use sourced park options, alternating major park outings with rest or pool time, vegetarian meals and early evenings. Keep travel days light; do not assert ride eligibility, tickets, opening hours or bookings. No invented prices.
```

## Tokyo and Kyoto with a corrected night split

Case: `japan_multiple_stops`. Expected final route: **Tokyo (2 nights, 2026-12-07–2026-12-09) → Kyoto (4 nights, 2026-12-09–2026-12-13)**.

Expected party: 2 adults, 0 children. Total budget: AUD 10,000.

Message 1:

```text
Fictional Demo Japan Couple from Perth, two adults with Australian passports, no children. We want a tourism holiday in Japan: arrive Tokyo on 7 December 2026 for three nights, then Kyoto for three nights, leaving Kyoto on 13 December. Budget AUD 10000. Prefer 4-star hotels near train stations, vegetarian food, gardens and traditional culture. Start with the route only.
```

Message 2:

```text
Please change Tokyo to two nights and Kyoto to four nights while keeping arrival 7 December and final departure 13 December 2026. Take a train between Tokyo and Kyoto, with exact train times to be confirmed. Keep two adults, no children and vegetarian meals, and avoid a rushed sightseeing pace.
```

After reviewing and accepting the route:

```text
Build the complete Japan itinerary for two adults, 7–13 December 2026: Tokyo two nights, Kyoto four nights, train transfer on 9 December. Use sourced gardens, cultural visits and vegetarian dining at a relaxed pace. Keep the transfer day manageable, arrival and final departure flexible, and all schedules subject to confirmation. Do not book anything or invent prices.
```

## Paris at a slow pace with explicit step-free requirements

Case: `paris_step_free`. Expected final route: **Paris (4 nights, 2026-12-02–2026-12-06)**.

Expected party: 2 adults, 0 children. Total budget: AUD 7,000.

Message 1:

```text
Fictional Demo Paris Pair, two adults aged 68 and 71 from Adelaide with Australian passports, no children. We want a tourism holiday arriving Paris, France on 2 December 2026 for four nights, leaving 6 December. Total budget AUD 7000, 4-star central hotel, vegetarian food, art and gardens at a slow pace. We explicitly need step-free routes and lifts where stairs would otherwise be required. Start with route planning only.
```

Message 2:

```text
Keep Paris 2–6 December 2026 for two adults, no children. Plan at most one main attraction per day with frequent seated breaks. Neither traveller uses a wheelchair; do not infer a disability from our ages. We still require step-free access and minimal walking, which must be verified with each venue and transport provider instead of guaranteed.
```

After reviewing and accepting the route:

```text
Build the complete Paris itinerary for 2–6 December 2026, four nights, two adults. Keep a slow pace, at most one main attraction daily, seated breaks, minimal walking and sourced vegetarian dining. Research step-free routes and lifts without guaranteeing accessibility or assuming a wheelchair user. Keep arrival and departure flexible. Do not make bookings or invent prices.
```

## Solo one-way Lisbon holiday with a firm budget and no nightlife

Case: `solo-one-way-lisbon`. Expected final route: **Lisbon (4 nights, 2026-11-10–2026-11-14)**.

Expected party: 1 adults, 0 children. Total budget: EUR 1,800.

Message 1:

```text
This is a fictional solo holiday. I am one adult, no children, flying one way from Dublin to Lisbon, Portugal. I arrive in Lisbon on 10 November 2026 and stay four nights, leaving the hotel on 14 November. Do not plan a return flight; I will arrange onward travel myself. My total trip budget is EUR 1800. I want a modest 3-star hotel, vegetarian meals, quiet cafes and gentle walks. No nightlife. Do not book anything.
```

Message 2:

```text
Keep Lisbon as the only destination. Prioritise quiet neighbourhood walks and gardens; leave arrival and departure days flexible. The budget is EUR 1800 for the whole trip, not per day.
```

After reviewing and accepting the route:

```text
Build the complete day-by-day Lisbon itinerary for 10–14 November 2026 using the agreed details. Keep travel days flexible, suggest sourced vegetarian dining, quiet gardens and gentle walks, with no nightlife or return-flight arrangements. Do not book anything or invent prices.
```

## Four-adult Sydney holiday across a year boundary

Case: `new-year-sydney`. Expected final route: **Sydney (6 nights, 2026-12-29–2027-01-04)**.

Expected party: 4 adults, 0 children. Total budget: AUD 8,000.

Message 1:

```text
This is a fictional holiday for four adults and no children. We arrive in Sydney, Australia on 29 December 2026, stay six nights and leave on 4 January 2027. Our total group budget is AUD 8000. We like beaches, harbour views and relaxed cultural visits. Use a 3-star hotel and keep the pace easy; no guaranteed event tickets or fireworks viewing.
```

Message 2:

```text
Yes, keep the exact dates 29 December 2026 to 4 January 2027, six nights for all four adults. Avoid scheduling a paid New Year event unless we explicitly choose one later.
```

After reviewing and accepting the route:

```text
Build the complete seven-calendar-day Sydney holiday itinerary, 29 December 2026 through 4 January 2027, for our four adults. Keep the arrival and departure days flexible, use sourced beach/harbour/cultural suggestions, and clearly flag future holiday opening times and event availability as needing confirmation. Do not invent bookings, ticket availability or prices.
```

## Change the destination and dates without retaining the old route

Case: `replace-destination-and-dates`. Expected final route: **Porto (4 nights, 2026-11-12–2026-11-16)**.

Expected party: 1 adults, 0 children. Total budget: EUR 1,600.

Message 1:

```text
Fictional holiday for one adult, no children: Lisbon, Portugal, arriving 10 November 2026 and staying four nights until 14 November. Total budget EUR 1600. I like museums, architecture and vegetarian food.
```

Message 2:

```text
Change the whole trip: replace Lisbon with Porto, Portugal. Arrive in Porto on 12 November 2026 and leave on 16 November 2026, four nights. Keep one adult, no children, the EUR 1600 total budget, museums, architecture and vegetarian food. Lisbon is no longer part of this trip.
```

After reviewing and accepting the route:

```text
Build the complete day-by-day Porto itinerary for 12–16 November 2026 with the revised route. Do not include Lisbon. Plan sourced museums, architecture and vegetarian dining at a relaxed pace, with flexible travel days and no bookings or invented costs.
```

## Incomplete honeymoon brief completed without invented dates or destination

Case: `incomplete-then-mauritius-honeymoon`. Expected final route: **Mauritius (6 nights, 2026-12-05–2026-12-11)**.

Expected party: 2 adults, 0 children. Total budget: GBP 5,000.

Message 1:

```text
We are two adults planning a fictional honeymoon. We have not chosen a destination or dates, and we do not want you to choose them yet. Please ask for the missing details; do not invent a route.
```

Message 2:

```text
We choose Mauritius. We arrive on 5 December 2026 and leave on 11 December 2026, six nights. Two adults, no children. Our total couple budget is GBP 5000. We want a relaxed beach honeymoon with a 4-star hotel, vegetarian dining and plenty of unscheduled time. Do not book anything.
```

After reviewing and accepting the route:

```text
Build the complete seven-calendar-day Mauritius honeymoon itinerary for 5–11 December 2026. Keep a relaxed pace and plenty of free time, suggest sourced beaches and vegetarian-friendly dining, leave travel days flexible, and avoid guaranteed weather, availability, prices or bookings.
```
