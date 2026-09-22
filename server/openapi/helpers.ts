import { z } from 'zod';
import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';

export type Schema = OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject;

// Document the accepted input, before normalizers such as uppercase transforms run.
// Cross-field refinements remain enforced by the server and described per operation.
export function fromZod(schema: z.ZodType): OpenAPIV3_1.SchemaObject {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  });
  return jsonSchema as OpenAPIV3_1.SchemaObject;
}

export function jsonResponse(description: string, schema?: Schema): OpenAPIV3_1.ResponseObject {
  return {
    description,
    ...(schema ? { content: { 'application/json': { schema } } } : {}),
  };
}

export function jsonBody(schema: Schema, example?: unknown): OpenAPIV3_1.RequestBodyObject {
  return {
    required: true,
    content: {
      'application/json': { schema, ...(example === undefined ? {} : { example }) },
    },
  };
}

export function operation(
  tag: string,
  summary: string,
  options: OpenAPIV3_1.OperationObject = { responses: {} },
): OpenAPIV3_1.OperationObject {
  return {
    tags: [tag],
    summary,
    ...options,
    responses: {
      '400': jsonResponse('Invalid request.', { $ref: '#/components/schemas/Error' }),
      '403': jsonResponse('Origin or operation is not allowed.', {
        $ref: '#/components/schemas/Error',
      }),
      '429': jsonResponse('Rate limit exceeded. Retry after the indicated delay.', {
        $ref: '#/components/schemas/Error',
      }),
      '500': jsonResponse('Unexpected server error.', { $ref: '#/components/schemas/Error' }),
      ...options.responses,
    },
  };
}
