import type { Server } from 'node:http';

export function shutdownGraceMs(value = process.env.SHUTDOWN_GRACE_MS): number {
  const configured = Number(value);
  return Number.isInteger(configured) && configured >= 130_000 && configured <= 300_000
    ? configured
    : 200_000;
}

/** Drain both HTTP requests and supplier work whose browser may have disconnected. */
export function gracefulShutdown(
  server: Server,
  dependencies: {
    stopPlanning: () => Promise<unknown>;
    bookingsPending: () => boolean;
    closeDatabase: () => void;
    exit: (status: number) => void;
    graceMs?: number;
  },
) {
  let started = false;
  let finished = false;
  // Requests active when close() is called can become idle keep-alive sockets
  // later. Close those promptly once their response has actually finished.
  server.on('request', (_request, response) => {
    response.once('finish', () => {
      if (started) setImmediate(() => server.closeIdleConnections());
    });
  });
  return () => {
    if (started) return;
    started = true;
    const deadline = setTimeout(() => {
      finished = true;
      // Durable operation records remain pending for restart reconciliation.
      dependencies.exit(1);
    }, dependencies.graceMs ?? shutdownGraceMs());
    const stoppedHttp = new Promise<void>((resolve) => server.close(() => resolve()));
    const stoppedPlanning = Promise.resolve().then(dependencies.stopPlanning);
    const stoppedBookings = (async () => {
      while (!finished && dependencies.bookingsPending())
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
    })();
    void Promise.allSettled([stoppedHttp, stoppedPlanning, stoppedBookings]).then((results) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      let failed = results.some((result) => result.status === 'rejected');
      try {
        dependencies.closeDatabase();
      } catch {
        failed = true;
      }
      dependencies.exit(failed ? 1 : 0);
    });
  };
}
