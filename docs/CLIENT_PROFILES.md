# Client profiles and recommendations

Open **Client profiles · new or returning** in the planning conversation. Create a profile or select an existing client. Each client has a stable private ID, so people with identical names remain separate.

Profiles store a name, optional profile photo, country of residence, nationality, date of birth, passport nationality, background, interests, food preferences and recorded trip history. Country of residence, nationality and the passport used for travel are separate choices. Birth dates must be real dates no later than today. Existing profiles remain compatible with the new optional fields.

## Record history and feedback

1. Choose **New client profile** or **Edit profile**.
2. Add each recorded trip with its destination, country, date, interests, visited/planned status, liked/neutral/disliked feedback and notes.
3. Save the profile. The selected client's combined history also shows older dated itineraries linked to that profile. These are labelled **Planned itinerary**, because an old proposal does not prove that a trip was taken.
4. Start another workspace and select the same saved client. Preferences and passport nationality populate the brief; dates, party size and budget remain specific to the new trip.
5. With no destination selected, Tara can research destination ideas from that history. After selecting a route, the same history also informs hotel shortlisting, dining/activity suggestions and daily-itinerary generation.

Explicit recorded feedback takes precedence over a linked plan for the same destination/country/date. Current instructions take precedence over earlier preferences. Suggestions should explain the relevant preference, avoid repeating disliked experiences without a new request, and keep claims supported by current sources or supplier quotes. History informs recommendations; it does not train a separate model or establish that a traveller will enjoy a destination.

## Data handling

Photos are for the agent to recognise the client; they are not analysed by AI. Birth dates and photos are excluded from AI requests and client proposals. Recommendation history is reduced to destination, country, travel date, interests, experience status, feedback and notes. Extra profile identity, photo, passport and birth-date fields cannot pass through that allowlist. Nationality, residence and appearance are not used to infer interests, and an earlier travelling party is never reused as the current party.

The profile name becomes the selected client's brief name and can appear in their proposal. Passport nationality is used only as explicitly declared for entry research. Names, residence, citizenship and photos do not establish passport eligibility. Profile notes and trip notes remain private input; public suggestions should not expose private history or identity details.

Profiles and history are scoped to the current owner/session. Another owner's client ID returns 404. Deleting a profile deletes its saved profile details and unlinks its workspaces; it retains those workspaces' existing brief and itinerary text. Edit or delete those workspaces separately when removing their copied information. Choosing a different profile applies its saved defaults. Editing an already-linked profile preserves the current trip's context, passport choice, interests and food preferences; the updated history is available for subsequent recommendations.

## API

Swagger is available at `/api/docs` on the running app/API.

| Method and path                                                   | Purpose                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/studio/client-profiles`                                 | List owned profiles                                      |
| `POST /api/studio/client-profiles`                                | Create a profile                                         |
| `PATCH /api/studio/client-profiles/:clientId`                     | Replace editable profile fields, retaining the client ID |
| `DELETE /api/studio/client-profiles/:clientId`                    | Delete the profile and unlink its workspaces             |
| `GET /api/studio/client-profiles/:clientId/history?workspaceId=…` | Combined history, excluding the current workspace        |

The editable fields are `name`, `country`, `nationality`, `dateOfBirth`, `passportNationality`, `photoDataUrl`, `context`, `interests`, `foodPreferences` and `history`. Countries normalise to ISO two-letter codes. Photos support PNG/JPEG/WebP; the browser limit is 140 KB and the server validates the data URL and image signature. History has at most 100 records; AI requests use at most 20 stored history records. Supplier searches remain separate from booking or payment.

## Live fictional check — 1 October 2026

The returning-client test used **History Demo Client**, interests **quiet gardens, culture**, vegetarian food, a liked Kyoto visit (12 May 2024: quiet gardens, traditional streets and small museums), and a disliked Dubai visit (10 June 2025: intense heat, busy nightlife and crowded late-night areas). The new trip was 10–16 November 2026, one adult and AUD 6,000, with no destination selected.

Actual OpenAI research used that history and returned **Kanazawa** and **Coimbra**, with reasons tied to the stated preferences. The research persisted after reload and left the route unselected. Both options remained **unverified** because recent local-condition evidence was incomplete; official travel advice was checked, but the test did not establish either option as fully verified or affordable. The temporary client and workspace were deleted.

To repeat: create that profile and history, start a new trip with those dates/preferences, select the saved profile, and use the destination-research action in **Brief & route**. Results and current evidence can change. The separate [London walkthrough](FICTIONAL_TRAVELLER_WALKTHROUGH.md) covers profile linking followed by hotels, flights, dining and a complete proposal.
