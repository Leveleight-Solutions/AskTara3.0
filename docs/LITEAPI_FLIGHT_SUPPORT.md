# LiteAPI sandbox flight verification — support brief

Prepared 13 September 2026. Draft only; not sent to LiteAPI. Credentials, opaque offer IDs, and passenger information are intentionally excluded.

## Reproduction observed with the configured sandbox key

Both searches used one adult, economy, USD, and an immediate verification request with the same sandbox key. Base URL: `https://api.liteapi.travel/v3.0`. Request headers: `X-API-Key` (server-side credential), `Content-Type: application/json`, `Accept: application/json`.

| Route           | Outbound   | Return     | Adults | `/flights/rates`                         | `/flights/verify` |
| --------------- | ---------- | ---------- | ------ | ---------------------------------------- | ----------------- |
| LHR → JFK → LHR | 2026-11-18 | 2026-11-22 | 1      | HTTP 200; 30 normalized offers; 11.592 s | HTTP 500; 1.224 s |
| JFK → CDG → JFK | 2026-11-18 | 2026-11-22 | 1      | HTTP 200; 30 normalized offers; 12.271 s | HTTP 500; 0.982 s |

Exact first search body (`POST /flights/rates`):

```json
{
  "legs": [
    { "origin": "LHR", "destination": "JFK", "date": "2026-11-18" },
    { "origin": "JFK", "destination": "LHR", "date": "2026-11-22", "direction": "INBOUND" }
  ],
  "adults": 1,
  "currency": "USD",
  "cabinClass": "ECONOMY"
}
```

The second search used the identical shape, with outbound `JFK` → `CDG` and inbound `CDG` → `JFK`; all other fields were unchanged. Neither request supplied a provider filter or point-of-sale country.

Verification used `POST /flights/verify` with exactly this shape:

```json
{ "offerId": "<selected supplier offerId, redacted>" }
```

The selected fare came from the returned journey's `cheapestOffer` or `offers` array. Its `offerId` was retained unchanged: no decoding, re-encoding, truncation, or replacement with a journey ID. In the alternate-route check, a returned E2E/Nuitee fare was preferred if identifiable; no provider code was present on the selected fare. A different underlying supplier was therefore not established.

Both verification responses contained:

```json
{
  "error": {
    "code": 52099,
    "description": "failed to verify flight offer",
    "message": "unable to process verify request"
  }
}
```

The HTTP failure occurred at LiteAPI before Asktara parsed the expected `data[0].journey`. No flight prebook, final booking, or payment request was submitted. **No flight reservation was created.**

## Requested supplier clarification

1. Please investigate sandbox verification error `52099` on these routes and confirm whether flight search **and verification** are enabled for this account. Please provide a supported sandbox route/provider scenario if needed.
2. The access guide recommends E2E/Nuitee Air, but the examined rates OpenAPI exposes no provider selector. Please confirm the supported way to select that sandbox provider, without undocumented parameters.
3. Please confirm whether this sandbox account supports payment bypass plus an enabled credit line: `POST /flights/prebooks` with `usePaymentSdk:false`, followed by `POST /flights/bookings` with `payment.method:"CREDIT"`. If not, please specify the supported sandbox payment flow and required account setup. Search success alone does not establish this eligibility.

Use the authenticated LiteAPI dashboard to identify the account. Do not paste its API key into this document or a public support thread.

## Contract references and activation boundary

The documented provider path implemented behind Asktara's gate is rates → verify → prebook → book → booking retrieval. Cancellation uses `GET /flights/bookings/{bookingId}/cancellations` for the quote and `POST` to the same path to submit it. Only confirmed zero-fee cancellation quotes are automatically actionable in the current implementation. [Rates](https://docs.liteapi.travel/reference/post_flights-rates), [Verify](https://docs.liteapi.travel/reference/post_flights-verify), [Prebook](https://docs.liteapi.travel/reference/post_flights-prebooks), [Book](https://docs.liteapi.travel/reference/post_flights-bookings), [Retrieve](https://docs.liteapi.travel/reference/get_flights-bookings-bookingid), [Cancel](https://docs.liteapi.travel/reference/post_flights-bookings-bookingid-cancellations), [Flight access](https://docs.liteapi.travel/docs/getting-access-to-flights), [OpenAPI](https://docs.liteapi.travel/openapi/openapiflights.json).

`LITEAPI_FLIGHT_BOOKING_ENABLED` remains disabled by default. Setting it to `true` still requires an actual sandbox-prefixed key; production keys are blocked. The provider path has mocked contract coverage, but real verification and credit booking remain unverified. Before enabling it, resolve the supplier verification failure, confirm account eligibility, and obtain **explicit user authorization for a controlled synthetic sandbox flight reservation and cleanup**. Automatic approval review previously rejected that reservation test because it creates external state and lacked explicit authorization. No retry was made. No live purchase is authorized by this support brief.
