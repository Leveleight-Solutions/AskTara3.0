import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { gracefulShutdown } from './shutdown.ts';

const app = createApp();
const dist = resolve('dist');
if (existsSync(resolve(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.json({
      service: 'Asktara API',
      frontend: 'Run npm run dev and open http://localhost:5173, or npm run build then npm start.',
    }),
  );
}
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () =>
  console.log(`Asktara API listening on http://localhost:${port}`),
);
const shutdown = gracefulShutdown(server, {
  stopPlanning: () =>
    Promise.all([app.locals.planningRuns.shutdown(), app.locals.studioActions.shutdown()]),
  bookingsPending: () =>
    Boolean(
      app.locals.db
        .prepare("SELECT id FROM booking_operations WHERE status = 'pending' LIMIT 1")
        .get(),
    ),
  closeDatabase: () => app.locals.db.close(),
  exit: (status) => process.exit(status),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
