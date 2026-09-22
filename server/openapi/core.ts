import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';
import { z } from 'zod';
import { accessibilityPreferenceOptions, dietaryPreferenceOptions } from '../../shared/account.ts';
import {
  flightSearchSchema,
  hotelSearchSchema,
  itineraryItemSchema,
  itinerarySchema,
  planningRequestSchema,
  travelBriefSchema,
  tripPatchSchema,
} from '../validation.ts';
import { fromZod, jsonBody, jsonResponse, operation } from './helpers.ts';

type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const string: OpenAPIV3_1.SchemaObject = { type: 'string' };
const number: OpenAPIV3_1.SchemaObject = { type: 'number' };
const boolean: OpenAPIV3_1.SchemaObject = { type: 'boolean' };
const uuid: OpenAPIV3_1.SchemaObject = { type: 'string', format: 'uuid' };
const timestamp: OpenAPIV3_1.SchemaObject = { type: 'string', format: 'date-time' };
const array = (items: Schema): OpenAPIV3_1.SchemaObject => ({ type: 'array', items });
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): OpenAPIV3_1.SchemaObject => ({ type: 'object', properties, required });
const envelope = (name: string, schema: Schema) => object({ [name]: schema });
const pathId = (name = 'id', description = 'Resource ID'): OpenAPIV3_1.ParameterObject => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: string,
});
const tripParameter = pathId('id', 'ID of a trip owned by the current browser session or account.');
const tokenParameter: OpenAPIV3_1.ParameterObject = {
  name: 'token',
  in: 'path',
  required: true,
  description: 'Public sharing token returned when sharing a trip.',
  schema: { type: 'string', pattern: '^[a-f0-9]{48}$' },
};
const noContent = { description: 'Completed successfully; no response body.' };
const notFound = jsonResponse(
  'The resource was not found or is not available to this session.',
  ref('Error'),
);
const conflict = jsonResponse(
  'The resource or session changed, a limit was reached, or another operation is in progress.',
  ref('Error'),
);
const unauthorized = jsonResponse(
  'Sign in is required or the supplied credentials are incorrect.',
  ref('Error'),
);
const accountErrors = { '401': unauthorized, '409': conflict };
const tripResponse = jsonResponse('The saved trip.', envelope('trip', ref('Trip')));
const userResponse = jsonResponse(
  'The signed-in user; the session cookie is updated when signing in.',
  envelope('user', ref('User')),
);
const runResponse = jsonResponse(
  'The planning run, including progress events and a result when complete.',
  envelope('run', ref('PlanningRun')),
);
const accountRequired =
  'Requires a signed-in account, obtained through /api/auth/register or /api/auth/login. ';
const credentials = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128),
  })
  .strict();
const password = z.object({ currentPassword: z.string().min(1).max(128) }).strict();
const profilePatch = z
  .object({
    pace: z.enum(['relaxed', 'balanced', 'active']),
    interests: z.array(z.string().trim().min(1).max(60)).max(15),
    originAirport: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/),
    guestNationality: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/),
    dietaryPreferences: z
      .array(z.enum(dietaryPreferenceOptions))
      .max(dietaryPreferenceOptions.length),
    accessibilityPreferences: z
      .array(z.enum(accessibilityPreferenceOptions))
      .max(accessibilityPreferenceOptions.length),
    planningNotes: z.string().trim().max(500),
  })
  .partial()
  .strict();
const savedSelection = z
  .object({
    type: z.enum(['destination', 'stay', 'experience']),
    itemId: z.string().min(1).max(100),
  })
  .strict();
const chatResult = object(
  {
    trip: ref('Trip'),
    message: ref('Message'),
    mode: { type: 'string', enum: ['local', 'live'] },
    warning: string,
  },
  ['trip', 'message', 'mode'],
);

export const coreSchemas: Record<string, OpenAPIV3_1.SchemaObject> = {
  User: object({ id: uuid, name: string, email: { type: 'string', format: 'email' } }),
  Message: object({
    id: string,
    role: { type: 'string', enum: ['user', 'assistant'] },
    content: string,
    createdAt: timestamp,
  }),
  Destination: object({
    id: string,
    name: string,
    country: string,
    region: string,
    description: string,
    longDescription: string,
    image: string,
    tags: array(string),
    vibe: {
      type: 'string',
      enum: ['All places', 'By the water', 'City escapes', 'Into the wild', 'Culture & charm'],
    },
    bestTime: string,
    dailyBudget: number,
    coordinates: {
      type: 'array',
      items: number,
      minItems: 2,
      maxItems: 2,
      description: '[latitude, longitude]',
    },
    highlights: array(string),
  }),
  Stay: object({
    id: string,
    destinationId: string,
    name: string,
    description: string,
    image: string,
    style: string,
    price: number,
    rating: number,
    amenities: array(string),
  }),
  Experience: object({
    id: string,
    destinationId: string,
    name: string,
    description: string,
    image: string,
    duration: string,
    price: number,
    category: string,
  }),
  Trip: object(
    {
      id: uuid,
      title: string,
      destinationId: string,
      startDate: {
        type: 'string',
        description: 'YYYY-MM-DD, or an empty string when dates are not selected.',
      },
      destinations: array(ref('Destination')),
      days: { type: 'integer' },
      travelers: { type: 'integer' },
      budget: number,
      interests: array(string),
      status: { type: 'string', enum: ['draft', 'planned'] },
      revision: { type: 'integer', minimum: 0 },
      brief: fromZod(travelBriefSchema),
      planning: {
        type: 'object',
        description:
          'Planning report with research, sources, issues, questions, supplier offers, and budget estimates.',
      },
      itinerary: fromZod(itinerarySchema),
      messages: array(ref('Message')),
      shareToken: { type: ['string', 'null'] },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    [
      'id',
      'title',
      'destinationId',
      'startDate',
      'days',
      'travelers',
      'budget',
      'interests',
      'status',
      'itinerary',
      'messages',
      'shareToken',
      'createdAt',
      'updatedAt',
    ],
  ),
  PlanningRun: object(
    {
      id: uuid,
      tripId: uuid,
      requestId: uuid,
      status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] },
      events: array(
        object({
          id: string,
          agent: {
            type: 'string',
            enum: [
              'intake',
              'destinations',
              'places',
              'verification',
              'stays',
              'flights',
              'itinerary',
              'review',
            ],
          },
          status: { type: 'string', enum: ['running', 'completed', 'skipped', 'failed'] },
          label: string,
          detail: string,
          at: timestamp,
        }),
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
      error: string,
      result: chatResult,
    },
    ['id', 'tripId', 'requestId', 'status', 'events', 'createdAt', 'updatedAt'],
  ),
  PlanningPlace: object(
    {
      id: string,
      name: string,
      destinationId: string,
      address: string,
      coordinates: { type: 'array', items: number, minItems: 2, maxItems: 2 },
      category: { type: 'string', enum: ['sight', 'food', 'experience', 'leisure'] },
      durationMinutes: { type: 'integer' },
      estimatedCost: number,
      sourceId: string,
      description: string,
      evidenceUrls: array(string),
      suitability: array(string),
      mapsUrl: string,
      openingHours: array(string),
      attributions: array(object({ provider: string, providerUri: string }, ['provider'])),
    },
    [
      'id',
      'name',
      'destinationId',
      'address',
      'category',
      'durationMinutes',
      'estimatedCost',
      'sourceId',
    ],
  ),
  TripRevision: object({
    id: uuid,
    tripId: uuid,
    version: { type: 'integer' },
    reason: string,
    createdAt: timestamp,
  }),
  TravelProfile: object({
    ...fromZod(profilePatch).properties,
    updatedAt: {
      type: 'string',
      description: 'ISO timestamp, or an empty string before preferences have been saved.',
    },
  }),
  SavedItem: object({
    id: string,
    type: { type: 'string', enum: ['destination', 'stay', 'experience'] },
    itemId: string,
  }),
  FlightOffer: object(
    {
      id: string,
      bookingOfferId: string,
      airline: string,
      origin: string,
      destination: string,
      departure: string,
      arrival: string,
      duration: string,
      stops: { type: 'integer' },
      price: number,
      currency: string,
      journeys: array({
        type: 'object',
        description:
          'Complete journey with airports, times, connections, stops, and flight segments.',
      }),
      requestedJourneyCount: { type: 'integer' },
      passengerCount: { type: 'integer' },
      priceScope: { type: 'string', enum: ['all_passengers_complete_journey'] },
      expiresAt: string,
      liveMode: boolean,
    },
    [
      'id',
      'airline',
      'origin',
      'destination',
      'departure',
      'arrival',
      'duration',
      'stops',
      'price',
      'currency',
    ],
  ),
  HotelOffer: object(
    {
      id: string,
      offerId: string,
      bookingOfferId: string,
      hotelId: string,
      name: string,
      image: string,
      address: string,
      room: string,
      board: string,
      price: number,
      currency: string,
      checkin: { type: 'string', format: 'date' },
      checkout: { type: 'string', format: 'date' },
    },
    [
      'id',
      'hotelId',
      'name',
      'image',
      'address',
      'room',
      'board',
      'price',
      'currency',
      'checkin',
      'checkout',
    ],
  ),
};

export const corePaths: OpenAPIV3_1.PathsObject = {
  '/api/health': {
    get: operation('System', 'Check backend and database health', {
      security: [],
      responses: {
        '200': jsonResponse(
          'Backend is running.',
          object({
            status: { type: 'string', enum: ['ok'] },
            service: { type: 'string', enum: ['asktara'] },
            database: { type: 'string', enum: ['connected'] },
          }),
        ),
      },
    }),
  },
  '/api/session': {
    get: operation('Authentication', 'Get the current browser session', {
      description:
        'Returns the signed-in user or null for a guest. The server creates a guest session cookie automatically when needed.',
      responses: {
        '200': jsonResponse(
          'Current session.',
          envelope('user', { anyOf: [ref('User'), { type: 'null' }] }),
        ),
      },
    }),
  },
  '/api/catalog': {
    get: operation('Catalog', 'List inspiration destinations, stays, and experiences', {
      security: [],
      description:
        'Editorial inspiration content. Catalog stays are fictional concepts and prices are illustrative estimates.',
      responses: {
        '200': jsonResponse(
          'Full inspiration catalog.',
          object({
            destinations: array(ref('Destination')),
            stays: array(ref('Stay')),
            experiences: array(ref('Experience')),
          }),
        ),
      },
    }),
  },
  '/api/integrations': {
    get: operation('System', 'Get integration availability', {
      security: [],
      responses: {
        '200': jsonResponse(
          'Configured integration capabilities.',
          object({
            ai: boolean,
            flights: boolean,
            hotels: boolean,
            activities: boolean,
            mode: { type: 'string', enum: ['local', 'live'] },
          }),
        ),
      },
    }),
  },
  '/api/config': {
    get: operation('System', 'Get public browser configuration', {
      security: [],
      responses: {
        '200': jsonResponse(
          'Public configuration; the Maps Embed key is present only if configured.',
          object({ mapsEmbedApiKey: string }, []),
        ),
      },
    }),
  },
  '/api/auth/register': {
    post: operation('Authentication', 'Create an account and sign in', {
      description:
        'Creates an account, migrates guest data, and rotates the session cookie. Limited to 20 authentication attempts per 15 minutes. Email addresses are normalized to lowercase.',
      requestBody: jsonBody(
        fromZod(credentials.extend({ name: z.string().trim().min(1).max(80) })),
        {
          name: 'Example Traveler',
          email: 'traveler@example.com',
          password: 'ChangeThisPassword123!',
        },
      ),
      responses: { '201': userResponse, '409': conflict },
    }),
  },
  '/api/auth/login': {
    post: operation('Authentication', 'Sign in with email and password', {
      description:
        'Migrates guest data into the account and rotates the session cookie. Sign out before switching between accounts. Limited to 20 authentication attempts per 15 minutes.',
      requestBody: jsonBody(fromZod(credentials), {
        email: 'traveler@example.com',
        password: 'ChangeThisPassword123!',
      }),
      responses: { '200': userResponse, '401': unauthorized, '409': conflict },
    }),
  },
  '/api/auth/logout': {
    post: operation('Authentication', 'Sign out and start a fresh guest session', {
      description:
        'Cancels work associated with this session and replaces its cookie with a new guest session.',
      responses: { '200': jsonResponse('Signed out.', envelope('user', { type: 'null' })) },
    }),
  },
  '/api/profile': {
    get: operation('Account', 'Get travel preferences', {
      description:
        'Available to guest sessions and signed-in accounts. Unset preferences use application defaults.',
      responses: {
        '200': jsonResponse('Travel profile.', envelope('profile', ref('TravelProfile'))),
      },
    }),
    patch: operation('Account', 'Update travel preferences', {
      description:
        'Provide at least one preference. Preferences apply to new trips. Airport and nationality codes are normalized to uppercase, and duplicate list values are removed.',
      requestBody: jsonBody(
        { ...fromZod(profilePatch), minProperties: 1 },
        { pace: 'relaxed', originAirport: 'KHI', interests: ['Food', 'Culture'] },
      ),
      responses: {
        '200': jsonResponse('Updated travel profile.', envelope('profile', ref('TravelProfile'))),
      },
    }),
  },
  '/api/account': {
    get: operation('Account', 'Get account details and active session count', {
      security: [{ sessionCookie: [] }],
      description: accountRequired,
      responses: {
        '200': jsonResponse(
          'Account details.',
          envelope(
            'account',
            object({
              id: uuid,
              name: string,
              email: { type: 'string', format: 'email' },
              createdAt: timestamp,
              otherSessions: { type: 'integer', minimum: 0 },
            }),
          ),
        ),
        ...accountErrors,
      },
    }),
    patch: operation('Account', 'Change the account display name', {
      security: [{ sessionCookie: [] }],
      description: accountRequired,
      requestBody: jsonBody(
        fromZod(z.object({ name: z.string().trim().min(1).max(80) }).strict()),
        { name: 'Example Traveler' },
      ),
      responses: { '200': userResponse, ...accountErrors },
    }),
    delete: operation('Account', 'Permanently delete the account and saved travel data', {
      security: [{ sessionCookie: [] }],
      description: `${accountRequired}Requires the current password and the literal confirmation DELETE. Deletion can be rejected when bookings cannot yet be deleted. Signs out all sessions and starts a new guest session.`,
      requestBody: jsonBody(fromZod(password.extend({ confirmation: z.literal('DELETE') }))),
      responses: {
        '200': jsonResponse(
          'Account deleted.',
          object({ user: { type: 'null' }, message: string }),
        ),
        ...accountErrors,
      },
    }),
  },
  '/api/account/password': {
    post: operation('Account', 'Change the account password', {
      security: [{ sessionCookie: [] }],
      description: `${accountRequired}The new password must differ from the current password. Rotates the current session and signs out other sessions. Authentication rate limits apply.`,
      requestBody: jsonBody(fromZod(password.extend({ newPassword: z.string().min(8).max(128) }))),
      responses: {
        '200': jsonResponse('Password updated.', object({ user: ref('User'), message: string })),
        ...accountErrors,
      },
    }),
  },
  '/api/account/sessions/revoke': {
    post: operation('Account', 'Sign out other account sessions', {
      security: [{ sessionCookie: [] }],
      description: `${accountRequired}Verifies the current password, retains this session, and cancels work associated with revoked sessions.`,
      requestBody: jsonBody(fromZod(password)),
      responses: {
        '200': jsonResponse(
          'Number of other sessions revoked.',
          envelope('revoked', { type: 'integer', minimum: 0 }),
        ),
        ...accountErrors,
      },
    }),
  },
  '/api/account/export': {
    get: operation('Account', 'Download account data as JSON', {
      security: [{ sessionCookie: [] }],
      description: `${accountRequired}Downloads as asktara-account.json. Includes preferences, trips, revisions, saved items, bookings, and Studio data. Trip sharing tokens are replaced with sharingEnabled.`,
      responses: {
        '200': {
          ...jsonResponse(
            'Account data export.',
            object({
              schemaVersion: { type: 'integer', enum: [1] },
              exportedAt: timestamp,
              account: object({ id: uuid, name: string, email: string, createdAt: timestamp }),
              profile: ref('TravelProfile'),
              trips: array({
                type: 'object',
                description: 'Trip snapshot with sharingEnabled instead of shareToken.',
              }),
              revisions: array({
                type: 'object',
                description:
                  'Revision metadata and trip snapshot with sharingEnabled instead of shareToken.',
              }),
              saved: array(
                object({
                  type: { type: 'string', enum: ['destination', 'stay', 'experience'] },
                  itemId: string,
                }),
              ),
              bookings: array({ type: 'object' }),
              studio: object({ agency: { type: 'object' }, workspaces: array({ type: 'object' }) }),
            }),
          ),
          headers: {
            'Content-Disposition': {
              schema: string,
              description: 'attachment; filename="asktara-account.json"',
            },
          },
        },
        ...accountErrors,
      },
    }),
  },
  '/api/trips': {
    get: operation('Trips', 'List trips for the current session or account', {
      description:
        'Returns trips ordered by most recently updated. Create a trip through chat or a planning run.',
      responses: { '200': jsonResponse('Owned trips.', envelope('trips', array(ref('Trip')))) },
    }),
  },
  '/api/trips/{id}': {
    parameters: [tripParameter],
    get: operation('Trips', 'Get a trip', { responses: { '200': tripResponse, '404': notFound } }),
    patch: operation('Trips', 'Update trip details or itinerary', {
      description:
        'Provide at least one change other than revision. Include the current revision to detect concurrent edits. Itinerary days must match trip duration, be numbered in order, and have globally unique activity IDs. Destination stops must use researched destinations and total the trip duration. Trip-detail changes invalidate supplier research. Edited activities are locked unless explicitly unlocked.',
      requestBody: jsonBody(fromZod(tripPatchSchema), { title: 'My Kyoto itinerary', revision: 1 }),
      responses: { '200': tripResponse, '404': notFound, '409': conflict },
    }),
    delete: operation('Trips', 'Delete a trip and cancel its planning runs', {
      responses: { '204': noContent, '404': notFound },
    }),
  },
  '/api/trips/{id}/items': {
    parameters: [tripParameter],
    post: operation('Trips', 'Add a catalog stay or experience to an itinerary day', {
      description:
        'Requires the current trip revision and a unique requestId. Repeating the same request returns the existing item with alreadyAdded=true. The day must be in the catalog item’s destination, with fewer than 16 stops and enough time for the item and a 15-minute travel buffer.',
      requestBody: jsonBody(
        fromZod(
          z
            .object({
              kind: z.enum(['experience', 'stay']),
              itemId: z.string().min(1).max(100),
              day: z.number().int().min(1).max(21),
              time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              revision: z.number().int().min(0),
              requestId: z.string().uuid(),
            })
            .strict(),
        ),
      ),
      responses: {
        '201': jsonResponse(
          'Catalog item added, or returned from an identical prior request.',
          object({
            trip: ref('Trip'),
            item: fromZod(itineraryItemSchema),
            alreadyAdded: boolean,
          }),
        ),
        '404': notFound,
        '409': conflict,
      },
    }),
  },
  '/api/planning/runs': {
    post: operation('Planning', 'Start an asynchronous planning run', {
      description:
        'Creates a new trip when tripId is omitted. Supply a new UUID requestId for each distinct request; repeating it returns the existing owner-scoped run. Poll GET /api/planning/runs/{id} for progress. Limited to 20 planning/chat requests per minute; at most 100 trips and 200 conversation messages per trip.',
      requestBody: jsonBody(fromZod(planningRequestSchema), {
        message: 'Plan a relaxed three-day trip to Kyoto for two adults.',
        requestId: 'de82126f-99eb-43e5-b6da-f3c6a8a37678',
      }),
      responses: { '202': runResponse, '404': notFound, '409': conflict },
    }),
  },
  '/api/planning/runs/{id}': {
    parameters: [pathId('id', 'Planning run ID.')],
    get: operation('Planning', 'Get a planning run and progress events', {
      responses: { '200': runResponse, '404': notFound },
    }),
  },
  '/api/planning/runs/{id}/cancel': {
    parameters: [pathId('id', 'Planning run ID.')],
    post: operation('Planning', 'Cancel a planning run', {
      description:
        'Returns the current run unchanged if it has already completed, failed, or been cancelled.',
      responses: { '200': runResponse, '404': notFound },
    }),
  },
  '/api/trips/{id}/runs': {
    parameters: [tripParameter],
    get: operation('Planning', 'List planning runs for a trip', {
      responses: {
        '200': jsonResponse('Planning runs.', envelope('runs', array(ref('PlanningRun')))),
        '404': notFound,
      },
    }),
  },
  '/api/chat': {
    post: operation('Planning', 'Send Tara a message and wait for the result', {
      description:
        'Creates a new trip when tripId is omitted. Waits for planning to finish and returns the updated trip and assistant message. This endpoint creates its own request ID. Limited to 20 planning/chat requests per minute.',
      requestBody: jsonBody(fromZod(planningRequestSchema.omit({ requestId: true })), {
        message: 'Plan a relaxed three-day trip to Kyoto for two adults.',
      }),
      responses: {
        '200': jsonResponse('Completed chat and planning result.', {
          ...chatResult,
          properties: { ...chatResult.properties, runId: uuid },
          required: [...(chatResult.required ?? []), 'runId'],
        }),
        '404': notFound,
        '409': conflict,
      },
    }),
  },
  '/api/trips/{id}/places/{placeId}': {
    parameters: [
      tripParameter,
      pathId(
        'placeId',
        'Google place ID prefixed with google-, already present in this trip’s saved itinerary.',
      ),
    ],
    get: operation('Trips', 'Refresh details of a Google place in an itinerary', {
      description:
        'Requires a configured Google Places integration. Limited to 60 detail refreshes per minute. Returns a conflict if the itinerary changes during the request.',
      responses: {
        '200': jsonResponse('Refreshed place details.', envelope('place', ref('PlanningPlace'))),
        '404': notFound,
        '409': conflict,
        '502': jsonResponse(
          'Fresh place details could not be loaded from the provider.',
          ref('Error'),
        ),
        '503': jsonResponse('Google Places is not configured.', ref('Error')),
      },
    }),
  },
  '/api/trips/{id}/revisions': {
    parameters: [tripParameter],
    get: operation('Trips', 'List saved trip revisions', {
      description: 'Returns revision metadata ordered by descending version.',
      responses: {
        '200': jsonResponse(
          'Trip revision history.',
          envelope('revisions', array(ref('TripRevision'))),
        ),
        '404': notFound,
      },
    }),
  },
  '/api/trips/{id}/revisions/{revisionId}/restore': {
    parameters: [
      tripParameter,
      pathId('revisionId', 'ID of a saved revision belonging to this trip.'),
    ],
    post: operation('Trips', 'Restore an earlier trip revision', {
      description:
        'Requires the current trip revision number for concurrency protection. Restores the saved plan while preserving the current messages, trip identity, and sharing token.',
      requestBody: jsonBody(fromZod(z.object({ revision: z.number().int().min(0) }).strict()), {
        revision: 2,
      }),
      responses: { '200': tripResponse, '404': notFound, '409': conflict },
    }),
  },
  '/api/trips/{id}/share': {
    parameters: [tripParameter],
    post: operation('Sharing', 'Create or retrieve a public trip link', {
      description:
        'Reuses the existing token if the trip is already shared. The returned url is a frontend route.',
      responses: {
        '200': jsonResponse(
          'Public sharing token and frontend path.',
          object({ shareToken: string, url: string }),
        ),
        '404': notFound,
      },
    }),
    delete: operation('Sharing', 'Disable public trip sharing', {
      responses: { '204': noContent, '404': notFound },
    }),
  },
  '/api/shared/{token}': {
    parameters: [tokenParameter],
    get: operation('Sharing', 'Get a publicly shared trip', {
      security: [],
      description:
        'The public trip omits private briefing and planning reports, empties messages, and sets shareToken to null.',
      responses: { '200': tripResponse, '404': notFound },
    }),
  },
  '/api/shared/{token}/clone': {
    parameters: [tokenParameter],
    post: operation('Sharing', 'Copy a shared trip into the current session', {
      description:
        'Creates a draft copy with fresh identity, no messages or sharing token, and all activities marked incomplete. Private briefing and planning reports are omitted. The owner may have at most 100 trips.',
      requestBody: { ...jsonBody(fromZod(z.object({}).strict()), {}), required: false },
      responses: { '201': tripResponse, '404': notFound, '409': conflict },
    }),
  },
  '/api/trips/{id}/calendar.ics': {
    parameters: [tripParameter],
    get: operation('Trips', 'Download the itinerary as an iCalendar file', {
      description: 'The trip must have a start date and a nonempty itinerary.',
      responses: {
        '200': {
          description: 'iCalendar download.',
          headers: {
            'Content-Disposition': {
              schema: string,
              description: 'Attachment named asktara-{tripId}.ics.',
            },
          },
          content: {
            'text/calendar': {
              schema: {
                type: 'string',
                example: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
              },
            },
          },
        },
        '404': notFound,
      },
    }),
  },
  '/api/saved': {
    get: operation('Saved items', 'List saved inspiration items', {
      responses: {
        '200': jsonResponse(
          'Saved items, most recently added first.',
          envelope('items', array(ref('SavedItem'))),
        ),
      },
    }),
    post: operation('Saved items', 'Save a catalog destination, stay, or experience', {
      description:
        'The item must exist in the selected catalog category. Saving the same item again returns the existing saved item.',
      requestBody: jsonBody(fromZod(savedSelection), { type: 'destination', itemId: 'kyoto' }),
      responses: {
        '201': jsonResponse('Saved item.', envelope('item', ref('SavedItem'))),
        '404': notFound,
      },
    }),
  },
  '/api/saved/{id}': {
    parameters: [pathId('id', 'Saved-item ID, rather than the catalog itemId.')],
    delete: operation('Saved items', 'Remove a saved inspiration item', {
      responses: { '204': noContent, '404': notFound },
    }),
  },
  '/api/flights/search': {
    post: operation('Search', 'Search flight offers', {
      description:
        'Requires Duffel or LiteAPI credentials on the server. Departure must be today or later, return cannot precede departure, and airport codes must differ. Prices cover all requested passengers and the full journey. Limited to 12 flight/hotel searches per minute. This search does not book a flight.',
      requestBody: jsonBody(fromZod(flightSearchSchema), {
        origin: 'KHI',
        destination: 'LHR',
        departureDate: '2027-06-01',
        returnDate: '2027-06-08',
        adults: 1,
        cabinClass: 'economy',
      }),
      responses: {
        '200': jsonResponse(
          'Flight offers and provider environment.',
          object({
            offers: array(ref('FlightOffer')),
            mode: { type: 'string', enum: ['test', 'live', 'provider'] },
            warning: string,
            roundTrip: boolean,
            source: { type: 'string', enum: ['duffel', 'liteapi'] },
          }),
        ),
        '409': conflict,
        '502': jsonResponse('Provider request failed.', ref('Error')),
        '503': jsonResponse('Flight provider is not configured.', ref('Error')),
      },
    }),
  },
  '/api/hotels/search': {
    post: operation('Search', 'Search hotel rates', {
      description:
        'Requires LiteAPI credentials on the server. Check-in must be today or later and checkout must be later than check-in. The destination must be in the catalog or researched within the optional owned tripId. Family room pricing is not supported. Prices cover the full stay. Limited to 12 flight/hotel searches per minute. This search does not make a reservation.',
      requestBody: jsonBody(
        fromZod(hotelSearchSchema.safeExtend({ tripId: z.string().uuid().optional() })),
        {
          destinationId: 'kyoto',
          checkin: '2027-06-01',
          checkout: '2027-06-04',
          adults: 2,
          guestNationality: 'PK',
        },
      ),
      responses: {
        '200': jsonResponse(
          'Hotel rates and provider environment.',
          object({
            offers: array(ref('HotelOffer')),
            mode: { type: 'string', enum: ['test', 'live', 'provider'] },
            warning: string,
          }),
        ),
        '404': notFound,
        '409': conflict,
        '502': jsonResponse('Provider request failed.', ref('Error')),
        '503': jsonResponse('Hotel provider is not configured.', ref('Error')),
      },
    }),
  },
};
