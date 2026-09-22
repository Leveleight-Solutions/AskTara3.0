import type { Express } from 'express';
import { join } from 'node:path';
import swaggerUiPath from 'swagger-ui-dist/absolute-path.js';
import { createOpenApiDocument } from './openapi/index.ts';

// Keep scripts and styles on the application's own origin so Helmet's existing
// Content Security Policy also protects the interactive documentation.
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Asktara API documentation</title>
    <link rel="icon" type="image/png" href="/api/docs/favicon-32x32.png">
    <link rel="stylesheet" href="/api/docs/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui">Loading API documentation…</div>
    <script src="/api/docs/swagger-ui-bundle.js" defer></script>
    <script src="/api/docs/initializer.js" defer></script>
  </body>
</html>`;

const initializer = `async function initializeDocs() {
  try {
    // Establish one guest session before any interactive requests. An existing
    // signed-in cookie is retained, including when accessed through Vite.
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Session initialization failed');
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
      deepLinking: true,
      filter: true,
      docExpansion: 'none',
      defaultModelsExpandDepth: -1,
      displayRequestDuration: true,
      withCredentials: true,
      validatorUrl: null
    });
  } catch (error) {
    document.getElementById('swagger-ui').textContent =
      'Unable to load API documentation. Check that the API is running, then reload this page.';
  }
}
initializeDocs();`;

export function installApiDocs(app: Express, cookieName: string) {
  const assets = swaggerUiPath();
  const document = createOpenApiDocument(cookieName);
  app.get('/api/openapi.json', (_req, res) => res.json(document));
  app.get('/api/docs', (_req, res) => res.type('html').send(html));
  app.get('/api/docs/initializer.js', (_req, res) => res.type('js').send(initializer));
  for (const file of ['swagger-ui.css', 'swagger-ui-bundle.js', 'favicon-32x32.png']) {
    app.get(`/api/docs/${file}`, (_req, res) => res.sendFile(join(assets, file)));
  }
}
