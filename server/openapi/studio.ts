import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';
import { z } from 'zod';
import {
  studioAgencySchema,
  studioBriefSchema,
  studioItemSchema,
  studioPatchSchema,
  studioPricingSchema,
  studioRecommendationSchema,
  studioStopSchema,
} from '../studio-domain.ts';
import { studioImportSchema } from '../studio-imports.ts';
import { flightSearchSchema } from '../validation.ts';
import { studioItinerarySchema } from '../../shared/studio-itinerary.ts';
import { fromZod, jsonBody, jsonResponse, operation } from './helpers.ts';

type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;
const ref = (name: string): OpenAPIV3_1.ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): OpenAPIV3_1.SchemaObject => ({ type: 'object', properties, required });
const array = (items: Schema): OpenAPIV3_1.SchemaObject => ({ type: 'array', items });
const text: OpenAPIV3_1.SchemaObject = { type: 'string' };
const timestamp: OpenAPIV3_1.SchemaObject = { type: 'string', format: 'date-time' };
const positiveRevision = z.number().int().positive();
const revisionBody = fromZod(z.object({ revision: positiveRevision }).strict());
const proposalRevisionBody = fromZod(
  z.object({ revision: z.number().int().nonnegative() }).strict(),
);
const actionSchema = z
  .object({ revision: positiveRevision, requestId: z.string().uuid() })
  .strict();
const revisionDescription =
  'Send the latest workspace.revision. A stale revision returns 409 (STUDIO_REVISION_CONFLICT). Successful workspace edits increment the revision; use the returned workspace for the next request.';
const actionDescription = `${revisionDescription} requestId is a client-generated UUID scoped to the owner. Repeating an identical completed request replays its result with the current workspace and replayed: true; reusing it for different details returns 409. Failed operations may be retried with the same requestId. Research and import actions share a limit of 15 requests per minute.`;
const error = (description: string) => jsonResponse(description, ref('Error'));
const workspaceResponse = object({ workspace: ref('StudioWorkspace') });
const proposalResponse = object({ proposal: ref('StudioClientProposal') });
const workspaceParameters: OpenAPIV3_1.ParameterObject[] = [
  {
    name: 'id',
    in: 'path',
    required: true,
    description: 'Workspace ID returned by POST /api/studio/workspaces.',
    schema: { type: 'string', format: 'uuid' },
  },
];
const importParameters: OpenAPIV3_1.ParameterObject[] = [
  ...workspaceParameters,
  {
    name: 'importId',
    in: 'path',
    required: true,
    description: 'ID of the saved imported source.',
    schema: { type: 'string', format: 'uuid' },
  },
];
const tokenParameters: OpenAPIV3_1.ParameterObject[] = [
  {
    name: 'token',
    in: 'path',
    required: true,
    description: 'Public proposal token returned when a proposal is published.',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
];
const pdfResponse = (filename: string): OpenAPIV3_1.ResponseObject => ({
  description: 'Download the client-facing proposal as a PDF.',
  headers: {
    'Content-Disposition': {
      schema: { type: 'string', example: `attachment; filename="${filename}"` },
    },
  },
  content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
});
const actionResult = (extra: Record<string, Schema>) =>
  object({ workspace: ref('StudioWorkspace'), ...extra, replayed: { type: 'boolean' } }, [
    'workspace',
    ...Object.keys(extra).filter((name) => name !== 'model' && name !== 'nextAction'),
  ]);

export const studioSchemas: Record<string, OpenAPIV3_1.SchemaObject> = {
  StudioAgency: fromZod(studioAgencySchema),
  StudioBrief: fromZod(studioBriefSchema),
  StudioStop: fromZod(studioStopSchema),
  StudioItem: fromZod(studioItemSchema),
  StudioRecommendation: fromZod(studioRecommendationSchema),
  StudioItinerary: fromZod(studioItinerarySchema),
  StudioPricing: fromZod(studioPricingSchema),
  StudioImport: object({
    id: { type: 'string', format: 'uuid' },
    kind: { type: 'string', enum: ['text', 'image', 'pdf', 'url', 'audio'] },
    name: text,
    text: { type: 'string', maxLength: 30000 },
    createdAt: timestamp,
    sourceUrl: text,
    warnings: array(text),
  }),
  StudioWorkspace: object(
    {
      id: { type: 'string', format: 'uuid' },
      revision: { type: 'integer', minimum: 1, description: 'Optimistic concurrency version.' },
      title: text,
      stage: {
        type: 'string',
        enum: ['brief', 'structure', 'itinerary', 'services', 'recommendations', 'proposal'],
      },
      brief: ref('StudioBrief'),
      qualification: object({
        score: { type: 'number', minimum: 0, maximum: 100 },
        known: array(object({ id: text, label: text, value: text })),
        questions: array(
          object({ id: text, label: text, reason: text, required: { type: 'boolean' } }),
        ),
        skipped: { type: 'boolean' },
      }),
      stops: array(ref('StudioStop')),
      structureAccepted: { type: 'boolean' },
      items: array(ref('StudioItem')),
      recommendations: array(ref('StudioRecommendation')),
      itinerary: { anyOf: [ref('StudioItinerary'), { type: 'null' }] },
      imports: array(ref('StudioImport')),
      messages: array(
        object({
          id: { type: 'string', format: 'uuid' },
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: text,
          createdAt: timestamp,
        }),
      ),
      pricing: ref('StudioPricing'),
      proposal: {
        anyOf: [
          object({ token: text, publishedAt: timestamp, revision: { type: 'integer' } }),
          { type: 'null' },
        ],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      pinnedAt: { type: ['string', 'null'], format: 'date-time' },
    },
    [
      'id',
      'revision',
      'title',
      'stage',
      'brief',
      'qualification',
      'stops',
      'structureAccepted',
      'items',
      'recommendations',
      'imports',
      'messages',
      'pricing',
      'proposal',
      'createdAt',
      'updatedAt',
    ],
  ),
  StudioClientProposal: object({
    version: { type: 'integer', enum: [1] },
    title: text,
    clientName: text,
    publishedAt: timestamp,
    validUntil: timestamp,
    revision: { type: 'integer' },
    agency: fromZod(
      studioAgencySchema
        .pick({
          name: true,
          logoDataUrl: true,
          accentColor: true,
          email: true,
          phone: true,
          website: true,
          disclaimer: true,
        })
        .extend({ slug: z.string() }),
    ),
    trip: fromZod(
      studioBriefSchema.pick({ startDate: true, endDate: true, adults: true, children: true }),
    ),
    stops: array(fromZod(studioStopSchema.omit({ arrivalFixed: true, notes: true }))),
    items: array(
      fromZod(
        studioItemSchema.pick({
          id: true,
          kind: true,
          title: true,
          description: true,
          stopId: true,
          startDate: true,
          endDate: true,
          status: true,
          price: true,
          currency: true,
          priceStatus: true,
          quotedAt: true,
        }),
      ),
    ),
    recommendations: array(fromZod(studioRecommendationSchema.omit({ included: true }))),
    itinerary: { anyOf: [ref('StudioItinerary'), { type: 'null' }] },
    pricing: fromZod(
      studioPricingSchema.omit({ marginPercent: true }).extend({
        totals: z.array(
          z.object({
            currency: z.string(),
            amount: z.number(),
            containsEstimates: z.boolean(),
          }),
        ),
        unpricedCount: z.number().int().nonnegative(),
        sandboxCount: z.number().int().nonnegative(),
      }),
    ),
    notice: text,
  }),
  StudioProposalLink: object({
    token: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    slug: text,
    url: { type: 'string', example: '/proposal/my-agency/<token>' },
    pdfUrl: { type: 'string', example: '/api/studio/proposals/<token>/pdf' },
    publishedAt: timestamp,
    validUntil: timestamp,
  }),
};

const previewImportBody: OpenAPIV3_1.SchemaObject = {
  ...fromZod(studioImportSchema),
  description:
    'Provide exactly one of text, data, or url. data is a base64 data URL for image, pdf, or audio imports (maximum decoded file size 5 MB). url requires kind=url and a public HTTPS page. sourceUrl is allowed only with kind=url and reviewed text. Text is limited to 30,000 characters. Supported files: PNG, JPEG, WebP, PDF, MP3, WAV, M4A, and WebM.',
  oneOf: [
    { required: ['text'] },
    { required: ['data'], properties: { kind: { enum: ['image', 'pdf', 'audio'] } } },
    { required: ['url'], properties: { kind: { enum: ['url'] } } },
  ],
};
const studioFlightBody = fromZod(flightSearchSchema);
studioFlightBody.properties = {
  ...studioFlightBody.properties,
  revision: fromZod(positiveRevision),
};
studioFlightBody.required = [
  ...new Set([...(studioFlightBody.required || []), 'revision', 'adults', 'cabinClass']),
];
const quoteResult = object({
  quotes: array(ref('StudioItem')),
  mode: { type: 'string', enum: ['test', 'live', 'provider'] },
  warning: text,
});

export const studioPaths: OpenAPIV3_1.PathsObject = {
  '/api/studio/agency': {
    get: operation('Studio', 'Get agency settings', {
      description: 'Returns the current owner’s settings, or default settings for a new owner.',
      responses: {
        '200': jsonResponse('Agency settings.', object({ agency: ref('StudioAgency') })),
      },
    }),
    patch: operation('Studio', 'Update agency settings', {
      description:
        'Merge the supplied agency fields into the current settings. No workspace revision is required.',
      requestBody: jsonBody(fromZod(z.object({ agency: studioAgencySchema.partial() }).strict()), {
        agency: { name: 'My Travel Agency', accentColor: '#285641', quoteValidityHours: 48 },
      }),
      responses: {
        '200': jsonResponse('Updated settings.', object({ agency: ref('StudioAgency') })),
      },
    }),
  },
  '/api/studio/workspaces': {
    get: operation('Studio', 'List proposal workspaces', {
      description:
        'Returns up to 200 full workspaces owned by the session, pinned first and then most recently updated.',
      responses: {
        '200': jsonResponse(
          'Owned workspaces.',
          object({ workspaces: array(ref('StudioWorkspace')) }),
        ),
      },
    }),
    post: operation('Studio', 'Create an empty proposal workspace', {
      description:
        'Creates a workspace in the brief stage. The response includes the revision needed for later edits.',
      requestBody: { ...jsonBody(fromZod(z.object({}).strict()), {}), required: false },
      responses: { '201': jsonResponse('Workspace created.', workspaceResponse) },
    }),
  },
  '/api/studio/workspaces/{id}': {
    parameters: workspaceParameters,
    get: operation('Studio', 'Get a proposal workspace', {
      responses: {
        '200': jsonResponse('Current workspace.', workspaceResponse),
        '404': error('Workspace does not exist or is not owned by this session.'),
      },
    }),
    patch: operation('Studio', 'Edit a proposal workspace', {
      description: `${revisionDescription} Arrays replace their current contents. Route changes clear structure approval and mark existing items for review. Researched recommendations may only change their included flag. Supplier quote identities, dates, and prices cannot be relabelled. Dates may be empty or real YYYY-MM-DD values.`,
      requestBody: jsonBody(fromZod(studioPatchSchema), {
        revision: 2,
        title: 'Paris proposal',
        brief: { clientName: 'Example Client', adults: 2, children: 0 },
      }),
      responses: {
        '200': jsonResponse('Updated workspace.', workspaceResponse),
        '404': error('Workspace not found.'),
        '409': error('Workspace revision conflict.'),
      },
    }),
    delete: operation('Studio', 'Delete a proposal workspace', {
      description:
        'Deletes the owned workspace and cancels its active research requests. No revision is required.',
      responses: {
        '204': { description: 'Workspace deleted; no response body.' },
        '404': error('Workspace not found.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/pin': {
    parameters: workspaceParameters,
    put: operation('Studio', 'Pin or unpin a workspace', {
      description: 'Updates sidebar ordering without changing the workspace revision or updatedAt.',
      requestBody: jsonBody(fromZod(z.object({ pinned: z.boolean() }).strict()), { pinned: true }),
      responses: {
        '200': jsonResponse('Workspace with updated pinnedAt.', workspaceResponse),
        '404': error('Workspace not found.'),
      },
    }),
  },
  '/api/studio/clients': {
    get: operation('Studio', 'List clients from saved workspaces', {
      description:
        'Groups nonempty client names case-insensitively across the current owner’s latest 200 workspaces.',
      responses: {
        '200': jsonResponse(
          'Client groups.',
          object({
            clients: array(
              object({
                name: text,
                context: text,
                previousWorkspaces: array(object({ id: text, title: text, updatedAt: timestamp })),
              }),
            ),
          }),
        ),
      },
    }),
  },
  '/api/studio/workspaces/{id}/review': {
    parameters: workspaceParameters,
    post: operation('Studio', 'Plan and refine a client trip with Tara', {
      description: `${actionDescription} Uses AI when OPENAI_API_KEY is configured, otherwise a local parser (mode=local). Understands follow-up answers and updates the brief/route. Explicit requests to build or revise a daily itinerary generate and save a sourced plan; generation authorises using the supplied route. Can research requested activity/food ideas or guide the agent to services and proposal preview. No action publishes a proposal or books services. Returns nextAction when the UI should open the appropriate planning tab.`,
      requestBody: jsonBody(
        fromZod(actionSchema.extend({ message: z.string().trim().min(1).max(16000) })),
        {
          revision: 2,
          requestId: 'd2b18a95-1e12-4d36-befa-efcb56382b93',
          message: 'Two adults, no children, visiting Paris for four nights.',
        },
      ),
      responses: {
        '200': jsonResponse(
          'Reviewed brief and updated workspace.',
          actionResult({
            reply: text,
            mode: { type: 'string', enum: ['local', 'live'] },
            model: text,
            nextAction: {
              type: 'string',
              enum: ['structure', 'itinerary', 'services', 'recommendations', 'proposal'],
            },
          }),
        ),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict or requestId reused with different input.'),
        '429': error('Research and import request limit exceeded.'),
        '503': error(
          'Review interrupted or AI provider unavailable; saved workspace is unchanged.',
        ),
      },
    }),
  },
  '/api/studio/workspaces/{id}/structure': {
    parameters: workspaceParameters,
    post: operation('Studio', 'Move the brief to route structure', {
      description: `${revisionDescription} At least one destination is required. Recalculates qualification, records whether it was skipped, and clears structure approval.`,
      requestBody: jsonBody(
        fromZod(z.object({ revision: positiveRevision, skipQualification: z.boolean() }).strict()),
        { revision: 3, skipQualification: false },
      ),
      responses: {
        '200': jsonResponse('Workspace at the structure stage.', workspaceResponse),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/accept-structure': {
    parameters: workspaceParameters,
    post: operation('Studio', 'Approve the route structure', {
      description: `${revisionDescription} Requires at least one destination and a route end consistent with the requested trip end. Sets structureAccepted=true and opens itinerary planning.`,
      requestBody: jsonBody(revisionBody, { revision: 4 }),
      responses: {
        '200': jsonResponse('Approved workspace.', workspaceResponse),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/itinerary': {
    parameters: workspaceParameters,
    post: operation('Studio', 'Build or revise the complete daily itinerary', {
      description: `${actionDescription} Requires an accepted route, known nights at every stop and OPENAI_API_KEY. Saves a complete plan with sourced activity suggestions for up to 35 calendar days, including arrival/departure and transfer days. Flexible dates remain undated. Does not invent prices or reservations, publish a proposal, or change an already published snapshot.`,
      requestBody: jsonBody(
        fromZod(actionSchema.extend({ instructions: z.string().trim().max(4000).default('') })),
      ),
      responses: {
        '200': jsonResponse(
          'Saved daily itinerary.',
          actionResult({
            nextAction: { type: 'string', enum: ['itinerary'] },
            days: { type: 'integer', minimum: 1 },
          }),
        ),
        '400': error('Stay lengths missing or itinerary exceeds the supported duration.'),
        '404': error('Workspace not found.'),
        '409': error('Route unapproved, revision conflict, or requestId conflict.'),
        '429': error('Research request limit exceeded.'),
        '502': error('Itinerary failed source, coverage or privacy validation.'),
        '503': error('AI unavailable or interrupted; saved workspace is unchanged.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/recommendations': {
    parameters: workspaceParameters,
    post: operation('Studio', 'Research optional activities or food', {
      description: `${actionDescription} Requires an approved route and OPENAI_API_KEY. stopIds must belong to the accepted route. Replaces recommendations for the selected stops and category, up to 120 per workspace.`,
      requestBody: jsonBody(
        fromZod(
          actionSchema.extend({
            category: z.enum(['activity', 'food']),
            stopIds: z.array(z.string().min(1).max(80)).min(1).max(20),
            interests: z.string().trim().min(1).max(2000),
          }),
        ),
        {
          revision: 5,
          requestId: '92f78ca3-9ee8-41e8-9786-bf789e5379a9',
          category: 'activity',
          stopIds: ['paris'],
          interests: 'Art museums and walking tours',
        },
      ),
      responses: {
        '200': jsonResponse(
          'Saved recommendations and number researched.',
          actionResult({ count: { type: 'integer', minimum: 0 } }),
        ),
        '404': error('Workspace not found.'),
        '409': error('Route unapproved, revision conflict, or requestId conflict.'),
        '429': error('Research and import request limit exceeded.'),
        '502': error('Research failed source or privacy validation.'),
        '503': error('AI unavailable or interrupted; saved workspace is unchanged.'),
      },
    }),
  },
  '/api/studio/import/preview': {
    post: operation('Studio imports', 'Extract and preview an imported source', {
      description:
        'Returns private, reviewable source text without saving it to a workspace. Image, PDF and audio extraction require OPENAI_API_KEY; pasted text and readable public pages can work without AI. Review the text, then save it with the workspace import endpoint. Limited to 15 research/import requests per minute.',
      requestBody: jsonBody(previewImportBody, {
        kind: 'text',
        name: 'Client brief',
        text: 'Two adults visiting Paris for four nights.',
      }),
      responses: {
        '200': jsonResponse(
          'Extracted source with review warnings.',
          object({ import: ref('StudioImport') }),
        ),
        '413': error('Source file or extracted text exceeds the permitted size.'),
        '429': error('Research and import request limit exceeded.'),
        '502': error('Extraction returned unreadable or incomplete output.'),
        '503': error('AI extraction is unavailable; paste text to continue.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/import': {
    parameters: workspaceParameters,
    post: operation('Studio imports', 'Save reviewed import text to a workspace', {
      description: `${revisionDescription} Accepts reviewed text for any import kind. Maximum 20 source documents and 120,000 total source characters per workspace. sourceUrl is only allowed for reviewed URL text.`,
      requestBody: jsonBody(
        fromZod(
          z
            .object({
              revision: positiveRevision,
              kind: z.enum(['text', 'image', 'pdf', 'url', 'audio']),
              name: z.string().trim().min(1).max(160),
              text: z.string().min(1).max(30000),
              sourceUrl: z.string().max(2048).optional(),
            })
            .strict(),
        ),
        {
          revision: 5,
          kind: 'text',
          name: 'Client brief',
          text: 'Two adults visiting Paris for four nights.',
        },
      ),
      responses: {
        '200': jsonResponse(
          'Workspace with saved source.',
          object({ workspace: ref('StudioWorkspace'), import: ref('StudioImport') }),
        ),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/imports/{importId}': {
    parameters: importParameters,
    delete: operation('Studio imports', 'Remove a saved import', {
      description: `${revisionDescription} Removes the source if present. Existing extracted proposal items remain in the workspace.`,
      requestBody: jsonBody(revisionBody, { revision: 6 }),
      responses: {
        '200': jsonResponse('Workspace after source removal.', workspaceResponse),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/imports/{importId}/extract': {
    parameters: importParameters,
    post: operation('Studio imports', 'Extract arrangements for agent review', {
      description: `${actionDescription} Requires an approved route and OPENAI_API_KEY. Extracts proposal items from a saved source, up to 150 items total. Re-extracting an already processed source with a new requestId returns 409.`,
      requestBody: jsonBody(fromZod(actionSchema), {
        revision: 6,
        requestId: '4d482464-1669-4a9e-9f0e-0ca7f6ce221f',
      }),
      responses: {
        '200': jsonResponse(
          'Workspace and count of extracted items.',
          actionResult({ count: { type: 'integer', minimum: 0 } }),
        ),
        '404': error('Workspace or imported source not found.'),
        '409': error(
          'Route unapproved, source already extracted, revision conflict, or requestId conflict.',
        ),
        '429': error('Research and import request limit exceeded.'),
        '502': error('Extracted arrangements failed grounding validation.'),
        '503': error('AI unavailable or interrupted; saved workspace is unchanged.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/hotels/search': {
    parameters: workspaceParameters,
    post: operation('Studio suppliers', 'Search hotel quotes for an approved stop', {
      description: `${revisionDescription} Search does not change the revision. Requires an approved route, confirmed adults and zero children, hotel standard/location, destination country, and stay dates starting today or later. Uses LiteAPI rates (LITEAPI_API_KEY); destinations outside the built-in catalog also require AI resolution (OPENAI_API_KEY). Returns up to 12 unselected quotes and replaces this workspace’s previous unselected quote list. Quotes expire after at most 30 minutes. Selecting a quote does not reserve a room.`,
      requestBody: jsonBody(
        fromZod(
          z
            .object({
              revision: positiveRevision,
              stopId: z.string().min(1).max(150),
              guestNationality: z.string().regex(/^[A-Za-z]{2}$/),
            })
            .strict(),
        ),
        { revision: 5, stopId: 'paris', guestNationality: 'AU' },
      ),
      responses: {
        '200': jsonResponse('Hotel quote suggestions and provider warning.', quoteResult),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict, including edits made while searching.'),
        '502': error('Provider returned an error or invalid rates.'),
        '503': error('Supplier or AI integration unavailable.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/flights/search': {
    parameters: workspaceParameters,
    post: operation('Studio suppliers', 'Search flight quotes for a workspace', {
      description: `${revisionDescription} Search does not change the revision. Requires an approved route, confirmed adults and zero children. adults and cabinClass must be explicit; adults must match the workspace party. Airports must differ, departure must be today or later, and return cannot precede departure. Requires DUFFEL_ACCESS_TOKEN or LITEAPI_API_KEY. Returns up to 30 unselected quotes, replacing the previous quote list. Quotes expire after at most 30 minutes or the supplier expiry. No reservation or ticket is created.`,
      requestBody: jsonBody(studioFlightBody, {
        revision: 5,
        origin: 'SYD',
        destination: 'CDG',
        departureDate: '2027-06-01',
        returnDate: '2027-06-15',
        adults: 2,
        cabinClass: 'economy',
      }),
      responses: {
        '200': jsonResponse('Flight quote suggestions and provider warning.', quoteResult),
        '404': error('Workspace not found.'),
        '409': error('Revision conflict, including edits made while searching.'),
        '502': error('Flight provider failed or returned invalid offers.'),
        '503': error('No flight provider is configured.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/quotes/{quoteId}': {
    parameters: [
      ...workspaceParameters,
      {
        name: 'quoteId',
        in: 'path',
        required: true,
        description: 'ID of a returned hotel or flight quote.',
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    post: operation('Studio suppliers', 'Add a supplier quote to the proposal', {
      description: `${revisionDescription} Requires an approved adults-only route and a matching, unexpired quote. Adds the item with included=true, up to 100 services. An already selected quote returns the current workspace without duplicating it. This does not book, reserve, hold or ticket the service.`,
      requestBody: jsonBody(revisionBody, { revision: 5 }),
      responses: {
        '200': jsonResponse('Workspace containing the selected quote.', workspaceResponse),
        '404': error('Workspace or quote not found; search again for current quotes.'),
        '409': error(
          'Revision conflict, expired quote, or changed route/party/search preferences.',
        ),
      },
    }),
  },
  '/api/studio/workspaces/{id}/proposal/preview': {
    parameters: workspaceParameters,
    get: operation('Studio proposals', 'Preview the client-facing proposal', {
      description:
        'Builds a current preview without publishing. Includes selected services and recommendations, with private workspace fields and internal costs excluded.',
      responses: {
        '200': jsonResponse('Client-facing preview.', proposalResponse),
        '404': error('Workspace not found.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/proposal/preview/pdf': {
    parameters: workspaceParameters,
    get: operation('Studio proposals', 'Download a proposal preview PDF', {
      responses: {
        '200': pdfResponse('travel-proposal-preview.pdf'),
        '404': error('Workspace not found.'),
      },
    }),
  },
  '/api/studio/workspaces/{id}/proposal': {
    parameters: workspaceParameters,
    post: operation('Studio proposals', 'Publish a client proposal link', {
      description: `${revisionDescription} Requires accepted structure with at least one stop, review of all included imported items, and a package price when package mode is selected. Saves an immutable public snapshot and revokes previous links for this workspace. Anyone with the returned link can read its client-facing JSON and PDF. validUntil describes quote validity; passing that time does not revoke the link.`,
      requestBody: jsonBody(proposalRevisionBody, { revision: 7 }),
      responses: {
        '201': jsonResponse(
          'Published snapshot link and updated workspace.',
          object({ workspace: ref('StudioWorkspace'), proposal: ref('StudioProposalLink') }),
        ),
        '404': error('Workspace not found.'),
        '409': error('Workspace revision conflict.'),
      },
    }),
    delete: operation('Studio proposals', 'Revoke the workspace’s public proposal', {
      description: `${revisionDescription} Revokes all active proposal links for this workspace and clears workspace.proposal.`,
      requestBody: jsonBody(proposalRevisionBody, { revision: 8 }),
      responses: {
        '200': jsonResponse('Workspace with proposal cleared.', workspaceResponse),
        '404': error('Workspace not found.'),
        '409': error('Workspace revision conflict.'),
      },
    }),
  },
  '/api/studio/proposals/{token}': {
    parameters: tokenParameters,
    get: operation('Studio proposals', 'Read a public proposal snapshot', {
      security: [],
      description:
        'Reads an immutable client-facing snapshot using its public token. No owner session is required. Revoked or invalid tokens return 404; an elapsed validUntil does not itself revoke access.',
      responses: {
        '200': jsonResponse('Published client-facing proposal.', proposalResponse),
        '404': error('This proposal link is unavailable or revoked.'),
      },
    }),
  },
  '/api/studio/proposals/{token}/pdf': {
    parameters: tokenParameters,
    get: operation('Studio proposals', 'Download a public proposal PDF', {
      security: [],
      description:
        'Downloads the published snapshot. No owner session is required. Revocation is checked again after PDF rendering.',
      responses: {
        '200': pdfResponse('travel-proposal.pdf'),
        '404': error('This proposal link is unavailable or revoked.'),
      },
    }),
  },
};
