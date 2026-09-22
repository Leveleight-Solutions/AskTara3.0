import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';
import { corePaths, coreSchemas } from './core.ts';
import { studioPaths, studioSchemas } from './studio.ts';
import { bookingPaths, bookingSchemas } from './bookings.ts';

const paths: OpenAPIV3_1.PathsObject = { ...corePaths, ...studioPaths, ...bookingPaths };
const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
for (const [path, item] of Object.entries(paths)) {
  for (const method of methods) {
    const operation = item?.[method];
    if (operation && !operation.operationId) {
      operation.operationId = `${method}_${path
        .replace(/^\/api\//, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_$/, '')}`;
    }
  }
}

export const openApiDocument: OpenAPIV3_1.OpenAPIObject = {
  openapi: '3.1.0',
  info: {
    title: 'Asktara API',
    version: '0.1.0',
    description: [
      'Travel planning, Agent Studio, proposals, accounts and sandbox booking APIs.',
      '**Try it out:** this page initializes your browser session automatically. Expand an endpoint, choose Try it out, then Execute. Requests use the current origin and the same session as the application.',
      '**Sessions:** API clients should first call `GET /api/session` and retain the returned session cookie. The sessionCookie security scheme below names the cookie for this server. A guest session can own trips and Studio workspaces; account endpoints require registration or login. The cookie is HttpOnly and managed by the browser, so it does not need to be entered in the Authorize dialog.',
      '**Requests:** use JSON request bodies. Updates that require `revision` must use the latest value returned by the API. Where `requestId` is required, supply a UUID and reuse it only when retrying the same action. Server-side validation also checks cross-field constraints that JSON Schema cannot express.',
      '**Optional integrations:** inspect `GET /api/integrations` for availability. Manual Studio editing and the local planner work without provider keys. AI extraction/research and supplier searches require their configured providers. Executing mutations changes your current session’s data; booking actions retain the existing sandbox and confirmation gates.',
    ].join('\n\n'),
  },
  // Root-relative paths work on the Express port and through the Vite API proxy.
  servers: [{ url: '/', description: 'Current origin' }],
  security: [{}, { sessionCookie: [] }],
  paths,
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'asktara_session',
        description:
          'Browser-managed HttpOnly cookie. Call GET /api/session for a guest session or POST /api/auth/login to sign in. Swagger UI sends the current cookie automatically.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', description: 'Human-readable error message.' },
          code: { type: 'string', description: 'Machine-readable error code, when available.' },
        },
      },
      ...coreSchemas,
      ...studioSchemas,
      ...bookingSchemas,
    },
  },
};

export function createOpenApiDocument(cookieName: string): OpenAPIV3_1.OpenAPIObject {
  return {
    ...openApiDocument,
    components: {
      ...openApiDocument.components,
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: cookieName,
          description:
            'Browser-managed HttpOnly cookie. Call GET /api/session for a guest session or POST /api/auth/login to sign in. Swagger UI sends the current cookie automatically.',
        },
      },
    },
  };
}
