# LiteAPI flight booking: verified contracts and implementation limits

Reviewed 13 September 2026 against official LiteAPI documentation. All flight endpoints below use `https://api.liteapi.travel/v3.0` and the server-side `X-API-Key` header.

## Access and sandbox

LiteAPI documents a shared hotel/flight API key and sandbox flight access by default. Sandbox inventory can be incomplete or inconsistent; LiteAPI recommends E2E (Nuitee Air) for integration testing. Production flights require separate approval from the Nuitee team. A successful sandbox search does not prove credit-line, payment-bypass, or production eligibility. [Flight access](https://docs.liteapi.travel/docs/getting-access-to-flights)

The supplied sandbox key has returned flight offers. No real flight reservation or payment has been created during this booking implementation. Automatic approval review blocked a proposed synthetic sandbox prebook because it creates an external reservation and found no explicit user authorization for that test. The attempt before that rejection performed search only.

Read-only checks during implementation returned 30 sandbox offers each for LHR–JFK and JFK–CDG round trips, but both corresponding `/flights/verify` calls returned HTTP 500, provider code `52099` (`failed to verify flight offer`). The failure occurred at LiteAPI before local quote parsing. Provider identifiers were absent on the alternate selected fare, so a different underlying supplier was not established. Actual quote success and this account's booking/payment capability therefore remain unverified; no reservation/payment endpoints were called by these checks.

## Verified endpoint sequence

| Stage     | Method and path                     | Contract                                                                                                    |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Search    | `POST /flights/rates`               | Ordered legs, dates, adult count, currency, optional cabin/point of sale; retain opaque offer IDs verbatim. |
| Reprice   | `POST /flights/verify`              | Body `{offerId}`; current quote, fare rules, baggage and change indicators.                                 |
| Reserve   | `POST /flights/prebooks`            | Offer, contact and passenger documents; creates a provider reservation.                                     |
| Finalize  | `POST /flights/bookings`            | Provider prebook ID and an eligible payment method.                                                         |
| Reconcile | `GET /flights/bookings/{bookingId}` | Actual supplier lifecycle, reference and payment status.                                                    |

Search returns grouped journeys containing fares. Verification returns `data[0].journey` and optional `changes`; it does **not** return a replacement offer ID. Keep the submitted ID for prebooking. Repricing can fail because inventory or the search session expired. Changed flights/fare conditions must be reviewed, and an increased total requires new consent. [Search reference](https://docs.liteapi.travel/reference/post_flights-rates), [Verify reference](https://docs.liteapi.travel/reference/post_flights-verify)

## Passenger and payment contracts

Prebook requires `contact` and `passengers` matching the searched passenger counts. It is an external reservation operation, so do not run it on page load. The default `usePaymentSdk:true` creates Stripe payment fields. `usePaymentSdk:false` requires payment bypass plus an eligible credit line or whitelabel/CMI setup; sandbox alone is not documented as sufficient. [Prebook reference](https://docs.liteapi.travel/reference/post_flights-prebooks)

The current OpenAPI schema uses contact `firstName`, `lastName`, `email`, `phoneNumber` (national number), and separate `phoneCountryCode` (digits without `+`). Passenger fields are flat: `firstName`, `lastName`, `birthday`, `gender`, `nationality`, `documentType`, `documentNumber`, `documentIssueCountry`, `documentExpiry`, `passengerType` (`0` adult). Middle name is optional. Dates use `YYYY-MM-DD`; country values use ISO codes. Do not infer document issuer from nationality. [Official flight OpenAPI](https://docs.liteapi.travel/openapi/openapiflights.json)

Documented final payment choices are `TRANSACTION_ID` after Stripe confirmation, `CREDIT` for an eligible credit line, `THIRD_PARTY` with a signed whitelabel payment token, or enabled direct-card processing through the separate PCI endpoint. **Do not copy the hotel `ACC_CREDIT_CARD` request into flights:** the flight prebook response description mentions that method, but the final-booking request enum omits it. Book creation uses the prebook ID for idempotency; HTTP 201 creates a booking, HTTP 200 can return an existing booking, and HTTP 409 can indicate an operation already running. [Complete booking](https://docs.liteapi.travel/reference/post_flights-bookings)

The Stripe recipe initializes the SDK with the prebook's `publishableKey`, uses its `secretKey` as the PaymentIntent client secret, then submits the returned `transactionId` after successful payment. `LITEAPI_PUBLIC_KEY` is not a Stripe publishable key. No hosted flight checkout URL is documented in the examined prebook schema. Adding services can replace the payment intent; use the newest payment fields. This SDK route is researched but not implemented here. [Booking recipes](https://docs.liteapi.travel/docs/booking-flow-recipes), [Attach services](https://docs.liteapi.travel/reference/post_flights-prebooks-prebookid-services)

## Confirmation, recovery and cancellation

Booking details distinguish a pending reservation from supplier confirmation. Use actual airline locator fields; the general `bookingRef` may be a FlightHub reference. Ticket issuance metadata is not a passenger ticket number. Prebook retrieval returns checkout state and intentionally omits final lifecycle status, so it cannot prove that a timed-out book call succeeded. Persist the prebook reference **before** final dispatch. Never automatically create a replacement prebook after an ambiguous outcome. [Booking details](https://docs.liteapi.travel/reference/get_flights-bookings-bookingid), [Prebook details](https://docs.liteapi.travel/reference/get_flights-prebooks-prebookid)

`GET /flights/bookings/{bookingId}/cancellations` previews penalties and potential refunds without cancelling. Its refund is an estimate, not guaranteed money. `POST` to the same path submits cancellation with no body. HTTP 202 means the airline has not finalized cancellation; the booking can still report `CONFIRMED`. Only final `CANCELLED`/`CANCELLED_WITH_CHARGES` responses establish cancellation. Missing fees do not mean zero. [Cancellation quote](https://docs.liteapi.travel/reference/get_flights-bookings-bookingid-cancellations), [Cancel booking](https://docs.liteapi.travel/reference/post_flights-bookings-bookingid-cancellations)

LiteAPI supports asynchronous flight booking webhooks. Authentication uses the configured shared authorization token; the examined guide does not document an HMAC signature. Verify the token, deduplicate events, and reconcile an owner-scoped booking before displaying updates. Webhook deployment is separate work. [Webhooks](https://docs.liteapi.travel/docs/using-liteapi-webhooks)

## Asktara implementation boundary

`server/flight-booking.ts` provides real nonreserving verification, a documented credit booking path protected by both `LITEAPI_FLIGHT_BOOKING_ENABLED=true` and an actual sandbox-prefixed key, durable prebook checkpointing, retrieval, and cancellation restricted to confirmed zero-fee quotes. The flag defaults off. Mocked contract tests exercise the full flow and ambiguous failures; they do not establish account eligibility.

Before enabling the flag: obtain explicit authorization for synthetic sandbox reservations, verify payment-bypass/credit eligibility with LiteAPI, run a controlled test, and reconcile/cancel its reservation. Production keys remain blocked regardless of the flag. Stripe checkout, paid cancellation consent, ticket-document delivery and webhook reconciliation are not completed by this adapter.
