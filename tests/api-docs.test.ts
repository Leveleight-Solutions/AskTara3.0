import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';
import { createApp } from '../server/app.ts';
import { openApiDocument } from '../server/openapi/index.ts';

const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

test('OpenAPI covers every registered application operation and its path parameters', () => {
  const app = createApp(':memory:');
  try {
    const routes = app.router.stack as {
      route?: { path: string; methods: Record<string, boolean> };
    }[];
    const runtimeOperations: string[] = [];
    for (const { route } of routes) {
      if (
        !route ||
        !route.path.startsWith('/api/') ||
        route.path.startsWith('/api/docs') ||
        route.path === '/api/openapi.json'
      )
        continue;
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      for (const method of methods) {
        if (route.methods[method]) runtimeOperations.push(`${method} ${path}`);
      }
    }
    const documentedOperations: string[] = [];
    const operationIds = new Set<string>();
    for (const [path, item] of Object.entries(openApiDocument.paths ?? {})) {
      for (const method of methods) {
        const operation = item?.[method];
        if (!operation) continue;
        documentedOperations.push(`${method} ${path}`);
        assert(operation.operationId, `${method} ${path} has an operationId`);
        assert(
          !operationIds.has(operation.operationId),
          `Unique operationId: ${operation.operationId}`,
        );
        operationIds.add(operation.operationId);
        const parameters = [...(item?.parameters ?? []), ...(operation.parameters ?? [])].filter(
          (parameter): parameter is OpenAPIV3_1.ParameterObject => !('$ref' in parameter),
        );
        const pathParameters = parameters.filter((parameter) => parameter.in === 'path');
        assert.deepEqual(
          pathParameters.map((parameter) => parameter.name).sort(),
          [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort(),
          `Path parameters for ${method} ${path}`,
        );
        assert(pathParameters.every((parameter) => parameter.required));
        assert(
          Object.keys(operation.responses ?? {}).some((status) => /^2\d\d$/.test(status)),
          `Successful response documented for ${method} ${path}`,
        );
      }
    }
    assert.deepEqual(documentedOperations.sort(), runtimeOperations.sort());
  } finally {
    app.locals.db.close();
  }
});

test('OpenAPI schema references resolve without fetching external documents', () => {
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value) {
      const ref = String(value.$ref);
      assert(ref.startsWith('#/'), `Internal reference: ${ref}`);
      let target: unknown = openApiDocument;
      for (const key of ref.slice(2).split('/')) {
        assert(target && typeof target === 'object', `Unresolved reference: ${ref}`);
        target = (target as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      assert(target, `Unresolved reference: ${ref}`);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(openApiDocument);
});

test('Swagger UI, local assets and JSON spec are served with the existing security policy', async () => {
  const app = createApp(':memory:');
  try {
    const client = request(app);
    const page = await client
      .get('/api/docs')
      .expect(200)
      .expect('Content-Type', /text\/html/);
    assert.match(page.text, /Asktara API documentation/);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    for (const script of page.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.equal(script[1].trim(), '', 'Scripts are external to preserve CSP');
    }
    await client.get('/api/docs/').expect(200);
    await client
      .get('/api/docs/favicon-32x32.png')
      .expect(200)
      .expect('Content-Type', /image\/png/);
    await client
      .get('/api/docs/swagger-ui.css')
      .expect(200)
      .expect('Content-Type', /text\/css/);
    await client
      .get('/api/docs/swagger-ui-bundle.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    await client
      .get('/api/docs/initializer.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    const spec = await client.get('/api/openapi.json').expect(200).expect('Content-Type', /json/);
    assert.equal(spec.body.openapi, '3.1.0');
    assert.deepEqual(spec.body.servers, [{ url: '/', description: 'Current origin' }]);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    await client.get('/api/docs/missing.js').expect(404).expect('Content-Type', /json/);
  } finally {
    app.locals.db.close();
  }
});
