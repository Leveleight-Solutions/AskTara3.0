# Fictional traveller: repeatable end-to-end test

Verified locally on 2026-10-01 at `http://localhost:5174` (API port `3002`). This uses a wholly fictional traveller. The browser replay completed chat, current web research, hotel and flight sandbox quote selection, dining recommendations, itinerary regeneration, reload, private proposal preview and PDF download. It deleted its temporary workspace and profile afterward.

Planning used `gpt-6-astra` with `OPENAI_REASONING_EFFORT=medium`. The official model documentation checked on 1 October 2026 identifies Astra as OpenAI’s most capable flagship. This is a capability choice, not a claim that it has the newest release number. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra).

## Repeat the conversation

Open the home page and start a new trip with message 1. Send each message separately. Replies below are actual observed replies; phrasing and response time can vary. The saved facts and workflow checks are what should remain consistent.

Messages 1–2 show the final isolated intake recheck after fixing a privacy filter that incorrectly redacted “passport noted”. The complete workflow run used the same messages and saved the correct facts; messages 3–11 below are its actual replies.

The conflicting three-night/five-night statement is deliberate: Tara should ask one yes/no confirmation. Replying “yes” should select five nights, with no loop. You can instead use the explicit date-choice buttons.

### Message 1

**You send:**

```text
hi
```

**Tara replied:**

> Hi! Where would your client like to travel?

Observed response time: 4.2 seconds.

### Message 2

**You send:**

```text
My name is Demo Traveller. This is a fictional test traveller. I am from Melbourne and have a New Zealand passport.
```

**Tara replied:**

> Hi Demo Traveller — noted this is a fictional test traveller from Melbourne with a New Zealand passport. Where would you like to travel?

Observed response time: 6.3 seconds.

### Message 3

**You send:**

```text
i wanna go to london for a bussiness trip for 4 days on 3rd of november 2026
```

**Tara replied:**

> London for a four-day business trip — is 3 November 2026 your departure date from Melbourne or your arrival date in London?

Observed response time: 13.5 seconds.

### Message 4

**You send:**

```text
its my departure date
```

**Tara replied:**

> Understood — you depart Melbourne on 3 November 2026. What date will you arrive in London?

Observed response time: 12.6 seconds.

### Message 5

**You send:**

```text
i will arrive on the same date
```

**Tara replied:**

> Understood — you’ll arrive in London on 3 November 2026. How many nights will you stay?

Observed response time: 12.7 seconds.

### Message 6

**You send:**

```text
3 nights stay arrival on 3rd and going back on 8th
```

**Tara replied:**

> 3 November 2026 to 8 November 2026 is 5 nights; you also mentioned 3. Shall I use those dates and 5 nights for London?

Observed response time: 13.6 seconds.

### Message 7

**You send:**

```text
yes
```

**Tara replied:**

> London: 3 November 2026 to 8 November 2026, 5 nights. Would you like me to build the day-by-day itinerary?

Observed response time: 0.2 seconds.

### Message 8

**You send:**

```text
One adult, no children. This is a single-destination trip. My total trip budget is AUD 6000. I prefer a 4-star hotel in central London, vegetarian food, and economy flights both ways. Keep weekday business meetings from 9 am to 5 pm free, with gentle sightseeing in the evenings and on Saturday.
```

**Tara replied:**

> I’ll plan around weekday meetings, with gentle evening and Saturday sightseeing, within the AUD 6,000 total budget. Shall I build the five-night London itinerary using these preferences?

Observed response time: 19.3 seconds.

Before message 9, open **Client profiles → New client profile**. Keep Demo Traveller and the existing background. Set residence **Australia**, nationality and passport **New Zealand**, fictional DOB **1990-02-04**, interests **culture, quiet gardens**, and food **vegetarian**. Add Kyoto / Japan / Visited / **2025-04-05**, interests **quiet gardens, vegetarian food**, feedback **Liked**, notes **Liked quiet gardens and vegetarian dining.** Save, reload and open **View travel history** to verify it. Subsequent recommendations use this linked history.

### Message 9

**You send:**

```text
Check the entry requirements for this business trip using my New Zealand passport. I am only attending meetings, with no employment or paid work in the United Kingdom.
```

**Tara replied:**

> Entry research for London is ready in Brief & route. Review the official sources and any unresolved checks.

Observed response time: 64.2 seconds.

### Message 10

**You send:**

```text
Build my complete day-by-day itinerary for the confirmed London stay, 3–8 November 2026. Keep 9 am to 5 pm on Wednesday, Thursday and Friday available for business meetings. Plan vegetarian dining and a gentle Saturday sightseeing day. Use only sourced places, and do not make bookings.
```

**Tara replied:**

> Your 6-day itinerary is ready, with sources for the suggested activities. Tell me what to change, explore hotel and flight options in Services, or preview the proposal when you’re ready.

Observed response time: 70.4 seconds.

Complete the supplier and dining actions below before sending message 11. Adding selections clears the previous AI plan so it can be rebuilt using the reviewed choices.

### Message 11

**You send:**

```text
Update the complete day-by-day itinerary to include my selected hotel and return flight quotes and my included vegetarian restaurant recommendation. Keep the London stay 3–8 November 2026, Wednesday to Friday 9 am to 5 pm free for business meetings, gentle sightseeing in the evenings and on Saturday, and flexible arrival and departure days. These are sandbox quotes, not bookings; use only sourced places and do not reserve anything.
```

**Tara replied:**

> Your 6-day itinerary is ready, with sources for the suggested activities. Tell me what to change, explore hotel and flight options in Services, or preview the proposal when you’re ready.

Observed response time: 69.5 seconds.

## Supplier and dining actions between messages 10 and 11

1. Open **Accommodation → Find hotel or flight suggestions**. Enter guest nationality `NZ` and choose **Search hotels quotes**. Review the four-star hotels near central London and add a matching quote for **3–8 November 2026**.
2. Change **Search for** to **Flights**, select **Economy**, enter origin `MEL`, destination `LHR`, departure `2026-11-03`, and return `2026-11-08`. Search quotes. Read both journeys: select an outbound that also **arrives in London on 3 November**, and a return departing London on 8 November.
3. Open **Optional ideas**, select **Places to eat**, and enter:

```text
Three vegetarian-friendly restaurants in central London suitable for a solo business traveller. Use official restaurant sources and avoid assuming opening hours for November.
```

4. Choose **Research recommendations**, review the source links, and check **Include … in client proposal** for a suitable restaurant.
5. Send message 11 above. Reload the page; the selected services, included restaurant and six-day itinerary should remain.
6. Open **Proposal → Preview client proposal → Download draft PDF**.

## Results to double-check

| Detail                            | Expected saved value                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Traveller                         | Demo Traveller; Melbourne; New Zealand passport                                                                      |
| Purpose                           | Business                                                                                                             |
| Party                             | One adult, no children                                                                                               |
| Origin departure / London arrival | 3 November 2026 / 3 November 2026                                                                                    |
| London departure / stay           | 8 November 2026 / five nights                                                                                        |
| Day-by-day plan                   | Six dates: 3, 4, 5, 6, 7 and 8 November                                                                              |
| Meetings                          | Wednesday–Friday, 9 am–5 pm kept free of leisure activities                                                          |
| Preferences                       | AUD 6,000 budget; four-star central hotel; vegetarian; economy flights                                               |
| Entry research                    | New Zealand → United Kingdom; business purpose and declared meeting/no-work facts; flights both ways; linked sources |
| Supplier selections               | Clearly labelled sandbox/test quotes, with original currencies                                                       |
| Output                            | Saved itinerary, private preview and downloadable PDF                                                                |

### Observed selections

- Hotel: **The Clermont London, Charing Cross**, supplier rating 4 stars, 0.1 km straight-line from the search centre. Classic Double Room; AUD 2,527.62 sandbox quote.
- Flight: **Nuitée Air · MEL to LHR return**, USD 2,066.82 sandbox quote.

```text
1 adults · economy · price for the complete requested journey.
MEL → LHR: 2026-11-03T11:55:00 – 2026-11-03T22:48:00; 0 connections; PT21H53M
LHR → MEL: 2026-11-08T15:20:00 – 2026-11-10T00:13:00; 0 connections; PT21H53M
Check baggage, terminals, ticketing deadlines and fare conditions with the supplier before booking.
```

Hotel inventory, quotes, restaurant results and wording can change. Keep the actual airport-local dates shown by the supplier; the return arrival in Melbourne can be later than the London departure date. Sandbox quotes are not reservations or confirmed trip costs. Different currencies are preserved; the app does not invent an exchange rate or a combined confirmed total. Entry research remains guidance requiring review of its official sources.

No booking, payment, ticketing or public proposal publication was performed. The successful run recorded zero browser page errors and zero requests to booking/payment/publication endpoints. The private test workspace was removed; the exported PDF is a local test artifact.

## Run the automated replay

With the local app running and OpenAI plus LiteAPI sandbox credentials configured in ignored `.env`:

```sh
STUDIO_FICTIONAL_REPLAY=1 npx playwright test tests/studio-fictional-replay.spec.ts --reporter=list
```

This opt-in test makes real upstream AI/research and sandbox search calls. It creates only fictional data and removes its own workspace and profile. Artifacts default to `/private/tmp/asktara-fictional-replay`; set `STUDIO_REPLAY_ARTIFACT_DIR` to use another location. Do not commit credentials, databases or raw supplier tokens.
