# Actual-model travel results

## 6 October 2026

All twelve final conversations passed intake, explicit route approval, sourced itinerary generation, reload, private preview/PDF and fictional-workspace cleanup: **834 assertions across 70 calendar days**. These use the configured `gpt-6-astra`. [Short-query and automatic-entry prompts](AUTOMATIC_ENTRY_CHECKS.md) complement the longer [scenario prompts](TRIP_SCENARIO_PROMPTS.md).

| Conversation                             | Result | Seconds | Assertions | PDF bytes |
| ---------------------------------------- | ------ | ------: | ---------: | --------: |
| Bali honeymoon                           | Pass   |   105.0 |         65 |    18,022 |
| Nepal five-adult day hiking              | Pass   |   110.0 |         89 |    18,859 |
| New York business                        | Pass   |   102.5 |         68 |    18,734 |
| Orlando family                           | Pass   |   106.4 |         65 |    18,236 |
| Tokyo/Kyoto rail                         | Pass   |   116.3 |         92 |    19,360 |
| Paris step-free requirements             | Pass   |   126.6 |         68 |    19,959 |
| Solo one-way Lisbon                      | Pass   |   108.0 |         56 |    17,797 |
| New Year Sydney                          | Pass   |   149.2 |         56 |    19,702 |
| Lisbon replaced by Porto                 | Pass   |    93.8 |         56 |    18,367 |
| Initially incomplete Mauritius honeymoon | Pass   |   115.7 |         60 |    18,543 |
| Short-answer Kyoto honeymoon             | Pass   |   156.7 |         75 |    17,452 |
| Short-answer Nepal holiday               | Pass   |   183.2 |         84 |    20,181 |

Final short Nepal explicitly declares “holiday”; the earlier fixture incorrectly expected a legal tourism purpose from hiking alone. Initial parallel runs were blocked by the shared rate limiter; chat and research now use separate owner budgets. The actual short replay also found and fixed rejection of an unconfirmed country placeholder being refined into named cities. [Verification](VERIFICATION.md) records earlier failures, environment fixes, the two cruise journeys and separate supplier results. These plans do not establish live availability or reservations.

## 1 October 2026

All ten conversations completed intake/corrections, route approval, researched itinerary generation, reload, private preview, PDF export and workspace cleanup. The two cruise and three supplier-party journeys are recorded separately in [verification](VERIFICATION.md).

| Conversation                                                               | Result | Seconds | Assertions | PDF bytes |
| -------------------------------------------------------------------------- | ------ | ------: | ---------: | --------: |
| Change the destination and dates without retaining the old route           | Pass   |    89.3 |         56 |    17,440 |
| Four-adult Sydney holiday across a year boundary                           | Pass   |   136.8 |         56 |    18,810 |
| Solo one-way Lisbon holiday with a firm budget and no nightlife            | Pass   |   108.3 |         56 |    17,834 |
| Incomplete honeymoon brief completed without invented dates or destination | Pass   |    99.6 |         60 |    18,577 |
| Paris at a slow pace with explicit step-free requirements                  | Pass   |   146.6 |         68 |    19,897 |
| New York business trip with corrected arrival                              | Pass   |   151.1 |         68 |    18,598 |
| Orlando family with children aged six and ten                              | Pass   |   102.7 |         65 |    18,291 |
| Tokyo and Kyoto with a corrected night split                               | Pass   |   178.4 |         92 |    19,955 |
| Nepal day hikes for five adults                                            | Pass   |   135.6 |         89 |    19,846 |
| Bali honeymoon for two adults                                              | Pass   |    90.5 |         65 |    16,864 |

These are the successful post-fix runs. Earlier failures and their fixes are recorded in the verification notes; the first attempt did not pass every scenario. Each AI conversation used `gpt-6-astra`. Supplier search is tested separately and these planning results do not establish bookings or production availability.

[Copyable test messages](TRIP_SCENARIO_PROMPTS.md) · [Commands and limits](TRIP_SCENARIO_TESTING.md)
