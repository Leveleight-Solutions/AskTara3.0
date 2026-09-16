# Sandbox booking workflow

Asktara has a separate checkout and reservation history alongside itinerary planning. Selecting a search result uses an opaque, owner-scoped offer reference issued by the backend. The browser cannot supply its own supplier offer, total, currency or sandbox mode. Reservations are stored outside trip JSON, so shared itineraries and copies do not expose booking references or traveler information.

## Hotel flow

The hotel search supports one room for the requested adults. Checkout revalidates the hotel, dates and occupancy with LiteAPI prebook, then displays the current total, room/meal details, separately payable taxes and cancellation conditions. A changed total requires acceptance of the new quote. The traveler provides a booking contact and one primary guest for the room, then explicitly acknowledges the sandbox and terms before confirmation.

The server books using `ACC_CREDIT_CARD`, LiteAPI's documented no-charge sandbox method. It does not collect a card number. Supplier responses determine confirmation, pending or unknown status. The detail page can refresh status and request cancellation; charges are retained when returned. A sandbox confirmation is not a real hotel reservation. [Prebook](https://docs.liteapi.travel/reference/post_rates-prebook), [book and sandbox payment](https://docs.liteapi.travel/reference/post_rates-book), [retrieval](https://docs.liteapi.travel/reference/get_bookings-bookingid), [cancellation](https://docs.liteapi.travel/reference/put_bookings-bookingid).

## Flight flow

Flight checkout first calls the non-reserving verify endpoint and checks that segments, dates, party and fare still match the selection. Changed prices appear in the reviewed quote. Supplier flight prebooking requires passenger documents and can create a reservation before final booking. It therefore belongs after explicit confirmation, not in page loading or price review. [Verification](https://docs.liteapi.travel/reference/post_flights-verify), [flight booking architecture](https://docs.liteapi.travel/docs/flight-booking-architecture).

Flight confirmation is disabled by default. The documented sandbox credit path is implemented behind `LITEAPI_FLIGHT_BOOKING_ENABLED=true`, but must not be enabled until the account's payment-bypass/credit capability is verified. Hotel `ACC_CREDIT_CARD` support is not assumed for flights. The existing public LiteAPI key is not a Stripe publishable key. The adapter never falls back to wallet, account-card or production credentials. See [flight research](FLIGHT_BOOKING_RESEARCH.md) for supplier contracts and remaining verification.

A flight prebook reference is checkpointed before final booking dispatch. Pending confirmation remains pending; a reservation reference is not presented as an issued ticket. Cancellation checks the supplier's quote and currently accepts only explicitly zero-fee quotes. Paid or unclear cancellation requires a separate reviewed-fee flow. HTTP 202 means cancellation is pending.

## Persistence and recovery

- `booking_offers` stores expiring supplier selections with their owner and optional private trip association.
- `bookings` stores reviewed quotes and supplier state independently of itinerary edits and trip deletion.
- `booking_operations` binds request IDs to request fingerprints and records dispatch before supplier calls. Reusing an ID with different details is rejected.
- Refreshes, duplicate clicks and connection loss cannot submit the same confirmation again. Interrupted confirmations become unknown and require reconciliation.
- Guest records migrate on sign-in. All reads and mutations require the owner. Supplier outcomes are persisted even if the initiating session is revoked during a request.
- Account deletion is blocked while supplier operations remain unresolved. Deleting local data does not cancel a supplier reservation.

The local quote review window is at most ten minutes, shortened by an earlier supplier expiry. This is an application limit, not an inventory guarantee. Missing cancellation schedules remain unverified, never interpreted as free cancellation.

## Configuration and limits

All checkout endpoints use the existing secure owner session and return `{ booking }` unless noted:

| Endpoint                         | Purpose                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/bookings/offers/:id`   | Retrieve the owner's selected offer as `{ offer }`.                                                                                  |
| `POST /api/bookings/prebook`     | `{ offerId, requestId }` prepares a reviewed quote; flight uses non-reserving verification.                                          |
| `POST /api/bookings/:id/confirm` | Accept the exact quote version, price, currency, guest details and sandbox terms; see `ConfirmBookingInput` in `shared/bookings.ts`. |
| `GET /api/bookings`              | List `{ bookings }`; optional `tripId` is owner-checked.                                                                             |
| `GET /api/bookings/:id`          | Read saved state without a new supplier mutation.                                                                                    |
| `POST /api/bookings/:id/refresh` | `{}` retrieves current supplier status.                                                                                              |
| `POST /api/bookings/:id/cancel`  | `{ requestId, acceptCancellation: true }` requests cancellation under the reviewed terms.                                            |

Hotel sandbox checkout uses the existing server-side `LITEAPI_API_KEY`; no new payment key is needed. The actual key must begin `sand_` or `sandbox_`. Setting `LITEAPI_MODE=test` cannot make a production key eligible. Flight confirmation additionally requires its feature flag and verified payment-bypass/credit access. Search and flight verification work independently of that flag.

Production payments, flight payment SDK integration, paid flight cancellation, booking amendments, transactional email and supplier servicing remain separate work. Production checkout is blocked. Sandbox tests do not certify supplier production activation, real inventory or refunds.

## Verification

On 13 September 2026, the real LiteAPI hotel sandbox sequence passed: search, prebook, `ACC_CREDIT_CARD` confirmation, retrieval and cancellation of that same synthetic booking. The supplier returned confirmed and cancelled states; only fictional guest data was used and no real card was charged. Automated tests cover changed totals, excluded taxes, policy deadlines, invalid identity/date/occupancy, production-key blocking and ambiguous outcomes. Browser and deployment results are in [verification](VERIFICATION.md).

Automatic approval review rejected the flight reservation probe because it could create an external reservation with a possible reversal cost and required explicit user authorization. No flight prebook, payment or booking was dispatched by that probe. Confirmation remains disabled pending authorization and supplier capability verification; mocked tests do not establish that capability.

Two read-only flight checks returned 30 search offers each, but the subsequent LiteAPI verification request failed with HTTP 500/code `52099` on both LHR–JFK and JFK–CDG. The `{offerId}` request matches the official contract; the error occurred before local response validation. Actual flight quote success is therefore still unverified. A [sanitized supplier support brief](LITEAPI_FLIGHT_SUPPORT.md) records the reproduction and required account checks.
