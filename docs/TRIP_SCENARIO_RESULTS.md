# Actual-model travel results — 1 October 2026

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
