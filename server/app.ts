import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { destinations, stays, experiences } from '../shared/catalog.ts';
import { findDestination } from '../shared/destinations.ts';
import type { Trip, User, SavedItem } from '../shared/types.ts';
import {
  openDatabase,
  ownedTrip,
  persistTrip,
  persistTripRevision,
  tripRevisions,
} from './database.ts';
import type { WorkflowInput, WorkflowResult } from '../shared/planning.ts';
import { PlanningRunManager, PlanningRunError } from './run-manager.ts';
import {
  buildLocalItinerary,
  preserveLockedStops,
  PlanningConstraintError,
  readGooglePlaceDetails,
  refreshPlanningReport,
  defaultBrief,
} from './agents/index.ts';
import {
  updateConsultation,
  getConsultationQuestions,
  hasUnsupportedParty,
} from './agents/consultation.ts';
import { newTrip } from './planner.ts';
import {
  flightSearchSchema,
  hotelSearchSchema,
  tripPatchSchema,
  planningRequestSchema,
} from './validation.ts';
import { integrationStatus, ProviderError, searchFlights, searchHotels } from './integrations.ts';
import { tripCalendar } from './calendar.ts';
import { publicConfig } from './config.ts';
import { addCatalogItem, TripItemError } from './trip-items.ts';
import {
  AccountError,
  applyProfileDefaults,
  installAccountRoutes,
  migrateProfile,
} from './account.ts';
import { BookingError, migrateBookings, sandboxBookingsEnabled } from './booking-store.ts';
import { installBookingRoutes } from './booking-routes.ts';
import type { BookingProvider } from './booking-provider-types.ts';
import { StudioStore, StudioError, migrateStudio } from './studio-store.ts';
import { installStudioRoutes } from './studio-routes.ts';
import { StudioImportError } from './studio-imports.ts';
import { installStudioProposalRoutes } from './studio-proposals.ts';
import { installStudioSupplierRoutes } from './studio-suppliers.ts';

const deriveKey = promisify(scrypt);
const COOKIE = 'asktara_session';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
interface SessionRecord {
  id: string;
  owner_id: string;
  user_id: string | null;
  expires_at: number;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const credentials = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(8, 'Use at least 8 characters').max(128),
  })
  .strict();

export function createApp(
  dbPath = process.env.DATABASE_PATH || resolve('data/asktara.sqlite'),
  options: {
    workflow?: (input: WorkflowInput) => Promise<WorkflowResult>;
    bookingProviders?: Partial<Record<'hotel' | 'flight', BookingProvider>>;
  } = {},
) {
  const app = express();
  const db = openDatabase(dbPath);
  app.locals.db = db;
  const planningRuns = new PlanningRunManager(db, options.workflow);
  app.locals.planningRuns = planningRuns;
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'https:'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'frame-src': ["'self'", 'https://www.google.com'],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 200 : 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please wait a minute.' },
    }),
  );
  app.use('/api/studio/import/preview', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site')
        return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
      if (origin) {
        const allowed = new Set([`${req.protocol}://${req.get('host')}`, process.env.APP_ORIGIN]);
        if (process.env.NODE_ENV !== 'production') {
          allowed.add('http://localhost:5173');
          allowed.add('http://127.0.0.1:5173');
        }
        if (!allowed.has(origin))
          return res.status(403).json({ error: 'This origin is not allowed.' });
      }
      if (
        ['POST', 'PATCH', 'PUT'].includes(req.method) &&
        req.headers['content-length'] !== '0' &&
        req.headers['content-length'] &&
        !req.is('application/json')
      )
        return res.status(415).json({ error: 'Send request bodies as application/json.' });
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_AGE,
  };
  function createSession(res: Response, userId: string | null = null): SessionRecord {
    const token = randomBytes(32).toString('hex');
    const session = {
      id: hash(token),
      owner_id: userId || randomUUID(),
      user_id: userId,
      expires_at: Date.now() + SESSION_AGE,
    };
    db.prepare('INSERT INTO sessions (id, owner_id, user_id, expires_at) VALUES (?, ?, ?, ?)').run(
      session.id,
      session.owner_id,
      userId,
      session.expires_at,
    );
    res.cookie(COOKIE, token, cookieOptions);
    return session;
  }
  app.use('/api', (req, res, next) => {
    const cookie = req.cookies[COOKIE];
    let session: SessionRecord | undefined;
    if (typeof cookie === 'string' && /^[a-f0-9]{64}$/.test(cookie))
      session = db
        .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
        .get(hash(cookie), Date.now()) as unknown as SessionRecord | undefined;
    res.locals.session = session || createSession(res);
    next();
  });
  const session = (res: Response) => res.locals.session as SessionRecord;
  function requireActiveSession(res: Response) {
    const current = session(res);
    if (
      !db
        .prepare('SELECT id FROM sessions WHERE id = ? AND owner_id = ? AND expires_at > ?')
        .get(current.id, current.owner_id, Date.now())
    ) {
      throw new HttpError(
        409,
        'Your session changed while this request was running. Please try again.',
      );
    }
  }
  const getUser = (id: string | null) =>
    id
      ? (db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id) as unknown as User)
      : null;
  const requireTrip = (req: Request, res: Response) => {
    const trip = ownedTrip(db, session(res).owner_id, String(req.params.id));
    if (!trip) throw new HttpError(404, 'Trip not found.');
    return trip;
  };
  function signIn(res: Response, user: User) {
    requireActiveSession(res);
    const previous = session(res);
    if (previous.user_id && previous.user_id !== user.id)
      throw new HttpError(409, 'Sign out before switching accounts.');
    planningRuns.cancelSession(previous.id);
    app.locals.studioActions?.cancelSession(previous.id);
    db.exec('BEGIN');
    try {
      if (!previous.user_id) {
        migrateProfile(db, previous.owner_id, user.id);
        migrateBookings(db, previous.owner_id, user.id);
        migrateStudio(db, previous.owner_id, user.id);
        db.prepare('UPDATE trips SET owner_id = ? WHERE owner_id = ?').run(
          user.id,
          previous.owner_id,
        );
        // Idempotency keys are owner-scoped. A guest may legitimately use a key
        // already present in the account they subsequently sign into.
        const collisions = db
          .prepare(
            'SELECT guest.id, guest.data FROM planning_runs guest JOIN planning_runs account ON account.request_id = guest.request_id WHERE guest.owner_id = ? AND account.owner_id = ?',
          )
          .all(previous.owner_id, user.id);
        for (const row of collisions) {
          const run = JSON.parse(String(row.data));
          run.requestId = randomUUID();
          db.prepare('UPDATE planning_runs SET request_id = ?, data = ? WHERE id = ?').run(
            run.requestId,
            JSON.stringify(run),
            row.id,
          );
        }
        db.prepare('UPDATE planning_runs SET owner_id = ? WHERE owner_id = ?').run(
          user.id,
          previous.owner_id,
        );
        db.prepare(
          'INSERT OR IGNORE INTO saved (id, owner_id, type, item_id) SELECT id || ?, ?, type, item_id FROM saved WHERE owner_id = ?',
        ).run('-m', user.id, previous.owner_id);
        db.prepare('DELETE FROM saved WHERE owner_id = ?').run(previous.owner_id);
      }
      db.prepare('DELETE FROM sessions WHERE id = ?').run(previous.id);
      res.locals.session = createSession(res, user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', service: 'asktara', database: 'connected' }),
  );
  app.get('/api/session', (_req, res) => res.json({ user: getUser(session(res).user_id) }));
  app.get('/api/catalog', (_req, res) => res.json({ destinations, stays, experiences }));
  app.get('/api/integrations', (_req, res) => res.json(integrationStatus()));
  app.get('/api/config', (_req, res) => res.json(publicConfig()));

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again in 15 minutes.' },
  });
  installAccountRoutes(app, {
    db,
    planningRuns,
    session,
    requireActiveSession,
    createSession,
    authLimiter,
    cancelStudioSession: (id: string) => app.locals.studioActions?.cancelSession(id),
  });
  const bookingStore = installBookingRoutes(app, db, {
    session,
    requireActiveSession,
    providers: options.bookingProviders,
  });
  app.locals.bookingStore = bookingStore;
  const studioStore = new StudioStore(db);
  app.locals.studioStore = studioStore;
  const studioDependencies = { db, store: studioStore, session, requireActiveSession };
  app.locals.studioActions = installStudioRoutes(app, studioDependencies);
  installStudioProposalRoutes(app, studioDependencies);
  installStudioSupplierRoutes(app, studioDependencies);
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    if (session(res).user_id) throw new HttpError(409, 'You are already signed in.');
    const body = credentials.extend({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(body.email))
      throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    const salt = randomBytes(16).toString('hex');
    const derived = (await deriveKey(body.password, salt, 64)) as Buffer;
    requireActiveSession(res);
    const user: User = { id: randomUUID(), name: body.name, email: body.email };
    try {
      db.prepare(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
        user.id,
        user.name,
        user.email,
        `${salt}:${derived.toString('hex')}`,
        new Date().toISOString(),
      );
    } catch (error) {
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(body.email))
        throw new HttpError(409, 'An account with this email already exists.');
      throw error;
    }
    signIn(res, user);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const body = credentials.parse(req.body);
    const user = db
      .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?')
      .get(body.email) as
      { id: string; name: string; email: string; password_hash: string } | undefined;
    const [salt, stored] = user?.password_hash.split(':') ?? [
      '00000000000000000000000000000000',
      '00'.repeat(64),
    ];
    const derived = (await deriveKey(body.password, salt, 64)) as Buffer;
    const latestCredentials =
      user && db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (
      !user ||
      !timingSafeEqual(Buffer.from(stored, 'hex'), derived) ||
      latestCredentials?.password_hash !== user.password_hash
    )
      throw new HttpError(401, 'Email or password is incorrect.');
    const publicUser = { id: user.id, name: user.name, email: user.email };
    signIn(res, publicUser);
    res.json({ user: publicUser });
  });
  app.post('/api/auth/logout', (_req, res) => {
    planningRuns.cancelSession(session(res).id);
    app.locals.studioActions?.cancelSession(session(res).id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session(res).id);
    res.locals.session = createSession(res);
    res.json({ user: null });
  });

  app.get('/api/trips', (_req, res) => {
    const trips = db
      .prepare('SELECT data FROM trips WHERE owner_id = ? ORDER BY updated_at DESC')
      .all(session(res).owner_id)
      .map((row) => JSON.parse(String(row.data)));
    res.json({ trips });
  });
  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Please give Tara a moment before sending another message.' },
  });
  const activeChats = new Set<string>();
  app.post('/api/trips/:id/items', (req, res) => {
    const id = String(req.params.id);
    if (activeChats.has(id))
      throw new HttpError(409, 'Tara is updating this trip. Please wait for the reply.');
    res.status(201).json(addCatalogItem(db, session(res).owner_id, id, req.body));
  });
  function planningInput(res: Response, body: z.infer<typeof planningRequestSchema>) {
    const ownerId = session(res).owner_id;
    const existing = planningRuns.byRequest(ownerId, body.requestId);
    if (existing) {
      if (body.tripId && existing.tripId !== body.tripId)
        throw new HttpError(
          409,
          'This request ID belongs to a different trip. Start a new request.',
        );
      return { existing };
    }
    const trip = body.tripId ? ownedTrip(db, ownerId, body.tripId) : newTrip();
    if (!trip) throw new HttpError(404, 'Trip not found.');
    if (!body.tripId) applyProfileDefaults(db, ownerId, trip);
    if (body.brief?.destinationStops?.some((stop) => !findDestination(stop.destinationId, trip)))
      throw new HttpError(
        400,
        'Ask Tara to research a new destination before adding it to this route.',
      );
    if (trip.messages.length >= 200)
      throw new HttpError(
        409,
        'This conversation is full. Start a new trip or use the itinerary editor.',
      );
    if (
      !body.tripId &&
      Number(
        db.prepare('SELECT COUNT(*) AS count FROM trips WHERE owner_id = ?').get(ownerId)?.count,
      ) >= 100
    )
      throw new HttpError(409, 'You have reached 100 trips. Delete an old trip to create another.');
    return {
      input: {
        ownerId,
        sessionId: session(res).id,
        trip,
        message: body.message,
        requestId: body.requestId,
        brief: body.brief,
        isNew: !body.tripId,
      },
    };
  }
  app.post('/api/planning/runs', chatLimiter, (req, res) => {
    const body = planningRequestSchema.parse(req.body);
    const prepared = planningInput(res, body);
    const run = prepared.existing ?? planningRuns.start({ ...prepared.input!, persistDraft: true });
    res.status(202).json({ run });
  });
  app.get('/api/planning/runs/:id', (req, res) => {
    const run = planningRuns.get(session(res).owner_id, String(req.params.id));
    if (!run) throw new HttpError(404, 'Planning run not found.');
    res.json({ run });
  });
  app.post('/api/planning/runs/:id/cancel', (req, res) => {
    res.json({ run: planningRuns.cancel(session(res).owner_id, String(req.params.id)) });
  });
  app.get('/api/trips/:id/runs', (req, res) => {
    const trip = requireTrip(req, res);
    res.json({ runs: planningRuns.list(session(res).owner_id, trip.id) });
  });
  app.post('/api/chat', chatLimiter, async (req, res) => {
    const body = planningRequestSchema.omit({ requestId: true }).parse(req.body);
    const prepared = planningInput(res, { ...body, requestId: randomUUID() });
    const input = prepared.input!;
    const run = planningRuns.start({ ...input, persistDraft: false });
    activeChats.add(input.trip.id);
    try {
      const result = await planningRuns.wait(input.ownerId, run.id);
      requireActiveSession(res);
      res.json({ ...result, runId: run.id });
    } finally {
      activeChats.delete(input.trip.id);
    }
  });
  app.get('/api/trips/:id', (req, res) => res.json({ trip: requireTrip(req, res) }));
  const placeDetailsLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Please wait a minute before refreshing more place details.' },
  });
  app.get('/api/trips/:id/places/:placeId', placeDetailsLimiter, async (req, res) => {
    const trip = requireTrip(req, res);
    const placeId = String(req.params.placeId);
    const plannedDay = trip.itinerary.find((day) =>
      day.items.some((item) => item.placeId === placeId),
    );
    if (!plannedDay || !placeId.startsWith('google-'))
      throw new HttpError(404, 'This place is not in your saved itinerary.');
    const controller = new AbortController();
    const closed = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', closed);
    try {
      const place = await readGooglePlaceDetails(
        placeId,
        plannedDay.destinationId || trip.destinationId,
        controller.signal,
        findDestination(plannedDay.destinationId || trip.destinationId, trip),
      );
      requireActiveSession(res);
      const current = ownedTrip(db, session(res).owner_id, trip.id);
      if (!current?.itinerary.some((day) => day.items.some((item) => item.placeId === placeId)))
        throw new HttpError(
          409,
          'Your itinerary changed while these details were loading. Refresh the trip.',
        );
      res.json({ place });
    } finally {
      res.off('close', closed);
    }
  });
  app.patch('/api/trips/:id', (req, res) => {
    const original = requireTrip(req, res);
    if (activeChats.has(original.id))
      throw new HttpError(409, 'Wait for Tara to finish updating this trip, then try again.');
    const { revision, ...patch } = tripPatchSchema.parse(req.body);
    if (revision !== undefined && revision !== (original.revision ?? 0))
      throw new HttpError(
        409,
        'This trip has a newer version. Reload it before saving your changes.',
      );
    let trip: Trip = { ...original, ...patch, updatedAt: new Date().toISOString() };
    if (
      patch.brief ||
      ['startDate', 'days', 'travelers', 'budget', 'interests'].some((key) =>
        Object.hasOwn(patch, key),
      )
    ) {
      trip.brief = { ...defaultBrief(), ...original.brief, ...patch.brief };
      const consultation = updateConsultation({
        trip: original,
        message: '',
        brief: trip.brief,
        form: patch.brief?.consultation,
      });
      const fields = {
        startDate: 'dates',
        days: 'duration',
        travelers: 'travelers',
        budget: 'budget',
        interests: 'interests',
      } as const;
      for (const [key, field] of Object.entries(fields) as [
        keyof typeof fields,
        (typeof fields)[keyof typeof fields],
      ][]) {
        if (!Object.hasOwn(patch, key)) continue;
        if (key === 'startDate' && !patch.startDate) delete consultation.facts.dates;
        else
          consultation.facts[field] = {
            source: 'form',
            valueState: 'specified',
            evidence: `${key}: ${JSON.stringify(patch[key])}`.slice(0, 500),
          };
      }
      if (patch.brief?.originAirport)
        consultation.facts.origin = {
          source: 'form',
          valueState: 'specified',
          evidence: patch.brief.originAirport,
        };
      trip.brief.consultation = consultation;
      trip.brief.includeFlights = consultation.services.flights.status === 'requested';
      trip.brief.includeHotels = consultation.services.hotels.status === 'requested';
    }
    if (patch.brief?.destinationStops.length) {
      if (
        patch.brief.destinationStops.some((stop) => !findDestination(stop.destinationId, original))
      )
        throw new HttpError(400, 'Choose a researched destination for each trip stop.');
      if (patch.brief.destinationStops.reduce((sum, stop) => sum + stop.days, 0) !== trip.days)
        throw new HttpError(
          400,
          'The days allocated to destinations must match the trip duration.',
        );
      trip.destinationId = patch.brief.destinationStops[0].destinationId;
    }
    if (patch.itinerary) {
      const ids = patch.itinerary.flatMap((day) => day.items.map((item) => item.id));
      if (
        patch.itinerary.length !== trip.days ||
        patch.itinerary.some((day, index) => day.day !== index + 1) ||
        new Set(ids).size !== ids.length
      )
        throw new HttpError(
          400,
          'Itinerary days must match the trip duration, be in order, and have unique activity IDs.',
        );
      const oldItems = new Map(
        original.itinerary.flatMap((day) =>
          day.items.map((item) => [item.id, { day: day.day, item }] as const),
        ),
      );
      const contentKeys = [
        'time',
        'title',
        'description',
        'location',
        'category',
        'cost',
        'durationMinutes',
        'travelMinutes',
        'placeId',
        'sourceId',
      ] as const;
      trip.itinerary = patch.itinerary.map((day) => ({
        ...day,
        items: day.items.map((item) => {
          const previous = oldItems.get(item.id);
          const changed =
            !previous ||
            previous.day !== day.day ||
            contentKeys.some((key) => previous.item[key] !== item[key]);
          const explicitlyUnlocked = previous?.item.locked === true && item.locked === false;
          const edited = { ...item, ...(changed && !explicitlyUnlocked ? { locked: true } : {}) };
          if (
            previous?.item.placeId?.startsWith('google-') &&
            (['title', 'description', 'location'] as const).some(
              (key) => previous.item[key] !== item[key],
            )
          ) {
            // A traveler's authored custom stop no longer points to provider-owned display content.
            delete edited.placeId;
            delete edited.sourceId;
          }
          return edited;
        }),
      }));
    } else {
      const planningDetailsChanged =
        (['days', 'budget', 'travelers'] as const).some(
          (key) => patch[key] !== undefined && patch[key] !== original[key],
        ) ||
        (patch.interests !== undefined &&
          JSON.stringify(patch.interests) !== JSON.stringify(original.interests)) ||
        (patch.brief !== undefined &&
          JSON.stringify(patch.brief) !== JSON.stringify(original.brief));
      if (planningDetailsChanged && original.itinerary.length) {
        trip.itinerary = buildLocalItinerary(trip, trip.brief, original.planning?.places);
        trip = preserveLockedStops(original, trip);
      }
    }
    if (trip.status === 'planned' && !trip.itinerary.length)
      throw new HttpError(400, 'Choose a destination before marking the trip planned.');
    const researchInvalidated =
      (['startDate', 'days', 'travelers', 'budget'] as const).some(
        (key) => patch[key] !== undefined && patch[key] !== original[key],
      ) ||
      (patch.interests !== undefined &&
        JSON.stringify(patch.interests) !== JSON.stringify(original.interests)) ||
      (patch.brief !== undefined && JSON.stringify(patch.brief) !== JSON.stringify(original.brief));
    if (researchInvalidated && trip.planning) {
      // Keep the public evidence behind saved places; old supplier offers do not
      // apply to a changed date, party or route and must be searched again.
      trip.planning = structuredClone(trip.planning);
      trip.planning.flights = [];
      trip.planning.stays = [];
      trip.planning.destinations = (
        trip.brief?.destinationStops?.length
          ? trip.brief.destinationStops
          : [{ destinationId: trip.destinationId }]
      )
        .map((stop) => findDestination(stop.destinationId, trip)!)
        .filter(Boolean);
      trip.planning.budget.flights = null;
      trip.planning.budget.accommodation = 0;
      trip.planning.budget.unpriced = [
        ...new Set([...trip.planning.budget.unpriced, 'Accommodation', 'Flights']),
      ];
      trip.planning.issues = trip.planning.issues.filter(
        (issue) => issue.code !== 'research_refresh',
      );
      trip.planning.issues.push({
        code: 'research_refresh',
        severity: 'info',
        message:
          'Trip details changed. Ask Tara to refresh place suitability and supplier results for this version. Source dates show when the saved research was checked.',
      });
      if (trip.itinerary.length) trip = refreshPlanningReport(trip);
      else trip.planning.questions = getConsultationQuestions(trip, trip.brief!, 2);
    } else if (patch.itinerary) trip = refreshPlanningReport(trip);
    persistTripRevision(
      db,
      session(res).owner_id,
      trip,
      patch.itinerary ? 'You edited the itinerary' : 'You updated trip details',
    );
    res.json({ trip });
  });
  app.get('/api/trips/:id/revisions', (req, res) => {
    const trip = requireTrip(req, res);
    res.json({ revisions: tripRevisions(db, trip.id) });
  });
  app.post('/api/trips/:id/revisions/:revisionId/restore', (req, res) => {
    const current = requireTrip(req, res);
    const body = z
      .object({ revision: z.number().int().min(0) })
      .strict()
      .parse(req.body);
    if (body.revision !== (current.revision ?? 0))
      throw new HttpError(409, 'This trip has a newer version. Reload it before restoring a plan.');
    if (activeChats.has(current.id))
      throw new HttpError(409, 'Wait for Tara to finish updating this trip, then try again.');
    const row = db
      .prepare('SELECT data, version FROM trip_revisions WHERE id = ? AND trip_id = ?')
      .get(String(req.params.revisionId), current.id);
    if (!row) throw new HttpError(404, 'Trip revision not found.');
    const snapshot = JSON.parse(String(row.data)) as Trip;
    const trip: Trip = {
      ...snapshot,
      id: current.id,
      createdAt: current.createdAt,
      messages: current.messages,
      shareToken: current.shareToken,
    };
    persistTripRevision(db, session(res).owner_id, trip, `Restored version ${row.version}`);
    res.json({ trip });
  });
  app.delete('/api/trips/:id', (req, res) => {
    const trip = requireTrip(req, res);
    planningRuns.cancelTrip(session(res).owner_id, trip.id);
    db.prepare('DELETE FROM planning_runs WHERE trip_id = ? AND owner_id = ?').run(
      trip.id,
      session(res).owner_id,
    );
    db.prepare('DELETE FROM trips WHERE id = ? AND owner_id = ?').run(
      trip.id,
      session(res).owner_id,
    );
    res.status(204).end();
  });
  app.post('/api/trips/:id/share', (req, res) => {
    const trip = requireTrip(req, res);
    trip.shareToken ||= randomBytes(24).toString('hex');
    trip.updatedAt = new Date().toISOString();
    persistTrip(db, session(res).owner_id, trip);
    res.json({ shareToken: trip.shareToken, url: `/shared/${trip.shareToken}` });
  });
  app.delete('/api/trips/:id/share', (req, res) => {
    const trip = requireTrip(req, res);
    trip.shareToken = null;
    trip.updatedAt = new Date().toISOString();
    persistTrip(db, session(res).owner_id, trip);
    res.status(204).end();
  });
  app.get('/api/shared/:token', (req, res) => {
    if (!/^[a-f0-9]{48}$/.test(String(req.params.token)))
      throw new HttpError(404, 'This shared trip is no longer available.');
    const row = db
      .prepare('SELECT data FROM trips WHERE share_token = ?')
      .get(String(req.params.token));
    if (!row) throw new HttpError(404, 'This shared trip is no longer available.');
    const trip = JSON.parse(String(row.data)) as Trip;
    // Private briefing notes and airport/nationality preferences are not part of a public itinerary.
    const { brief: _brief, planning: _planning, ...publicTrip } = trip;
    publicTrip.destinations = [
      ...new Set([
        trip.destinationId,
        ...trip.itinerary.map((day) => day.destinationId || trip.destinationId),
      ]),
    ]
      .map((id) => findDestination(id, trip)!)
      .filter(Boolean);
    res.json({ trip: { ...publicTrip, messages: [], shareToken: null } });
  });
  app.post('/api/shared/:token/clone', (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const token = String(req.params.token);
    if (!/^[a-f0-9]{48}$/.test(token))
      throw new HttpError(404, 'This shared trip is no longer available.');
    const row = db.prepare('SELECT data FROM trips WHERE share_token = ?').get(token);
    if (!row) throw new HttpError(404, 'This shared trip is no longer available.');
    const ownerId = session(res).owner_id;
    if (
      Number(
        db.prepare('SELECT COUNT(*) AS count FROM trips WHERE owner_id = ?').get(ownerId)?.count,
      ) >= 100
    )
      throw new HttpError(409, 'You have reached 100 trips. Delete an old trip to create another.');
    const source = JSON.parse(String(row.data)) as Trip;
    const { brief: _brief, planning: _planning, ...publicTrip } = source;
    publicTrip.destinations = [
      ...new Set([
        source.destinationId,
        ...source.itinerary.map((day) => day.destinationId || source.destinationId),
      ]),
    ]
      .map((id) => findDestination(id, source)!)
      .filter(Boolean);
    const now = new Date().toISOString();
    const trip: Trip = {
      ...publicTrip,
      id: randomUUID(),
      title: `${source.title.slice(0, 113)} (copy)`,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      shareToken: null,
      messages: [],
      itinerary: source.itinerary.map((day) => ({
        ...day,
        items: day.items.map((item) => ({ ...item, completed: false })),
      })),
    };
    persistTripRevision(db, ownerId, trip, 'Copied a shared itinerary');
    res.status(201).json({ trip });
  });
  app.get('/api/trips/:id/calendar.ics', (req, res) => {
    const trip = requireTrip(req, res);
    if (!trip.startDate)
      throw new HttpError(400, 'Choose a start date before exporting your calendar.');
    if (!trip.itinerary.length)
      throw new HttpError(400, 'Create an itinerary before exporting your calendar.');
    res.setHeader('Content-Disposition', `attachment; filename="asktara-${trip.id}.ics"`);
    res.type('text/calendar; charset=utf-8').send(tripCalendar(trip));
  });
  app.get('/api/saved', (_req, res) =>
    res.json({
      items: db
        .prepare(
          'SELECT id, type, item_id AS itemId FROM saved WHERE owner_id = ? ORDER BY rowid DESC',
        )
        .all(session(res).owner_id),
    }),
  );
  app.post('/api/saved', (req, res) => {
    const body = z
      .object({
        type: z.enum(['destination', 'stay', 'experience']),
        itemId: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    const items =
      body.type === 'destination' ? destinations : body.type === 'stay' ? stays : experiences;
    if (!items.some((item) => item.id === body.itemId))
      throw new HttpError(404, 'This item is not in the catalog.');
    db.prepare('INSERT OR IGNORE INTO saved (id, owner_id, type, item_id) VALUES (?, ?, ?, ?)').run(
      randomUUID(),
      session(res).owner_id,
      body.type,
      body.itemId,
    );
    const item = db
      .prepare(
        'SELECT id, type, item_id AS itemId FROM saved WHERE owner_id = ? AND type = ? AND item_id = ?',
      )
      .get(session(res).owner_id, body.type, body.itemId) as unknown as SavedItem;
    res.status(201).json({ item });
  });
  app.delete('/api/saved/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM saved WHERE id = ? AND owner_id = ?')
      .run(String(req.params.id), session(res).owner_id);
    if (!result.changes) throw new HttpError(404, 'Saved item not found.');
    res.status(204).end();
  });
  const searchLimiter = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many searches. Please wait a minute.' },
  });
  app.post('/api/flights/search', searchLimiter, async (req, res) => {
    const input = flightSearchSchema.parse(req.body);
    const result = await searchFlights(input);
    requireActiveSession(res);
    const offers = result.offers.map((offer) => {
      if (!sandboxBookingsEnabled() || result.source !== 'liteapi' || result.mode !== 'test')
        return offer;
      if (
        offer.expiresAt &&
        (!Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= Date.now())
      )
        return offer;
      const confirmationAvailable = process.env.LITEAPI_FLIGHT_BOOKING_ENABLED === 'true';
      const bookingOfferId = bookingStore.saveOffer(session(res).owner_id, {
        provider: 'liteapi',
        providerOfferId: offer.id,
        expiresAt: offer.expiresAt,
        view: {
          kind: 'flight',
          name: offer.airline,
          description: 'Complete requested flight journey for all adults.',
          price: offer.price,
          currency: offer.currency,
          adults: input.adults,
          startDate: input.departureDate,
          endDate: input.returnDate,
          location: `${input.origin} → ${input.destination}`,
          journeys: offer.journeys,
          confirmationAvailable,
          ...(!confirmationAvailable
            ? {
                unavailableReason:
                  'Flight reservation confirmation is not enabled for this sandbox account.',
              }
            : {}),
        },
      });
      return { ...offer, bookingOfferId };
    });
    res.json({ ...result, offers });
  });
  app.post('/api/hotels/search', searchLimiter, async (req, res) => {
    const { tripId, ...input } = hotelSearchSchema
      .safeExtend({ tripId: z.string().uuid().optional() })
      .parse(req.body);
    const trip = tripId ? ownedTrip(db, session(res).owner_id, tripId) : undefined;
    if (tripId && !trip) throw new HttpError(404, 'Trip not found.');
    if (trip?.brief && hasUnsupportedParty(trip.brief))
      throw new HttpError(
        400,
        'Family room pricing is not supported yet. Your itinerary can include children, but this search must not price them as adults.',
      );
    const destination = findDestination(input.destinationId, trip);
    if (!destination)
      throw new HttpError(400, 'Plan this destination with Tara before searching its hotels.');
    const result = await searchHotels(input, undefined, destination);
    requireActiveSession(res);
    if (tripId && !ownedTrip(db, session(res).owner_id, tripId))
      throw new HttpError(404, 'Trip not found.');
    const offers = result.offers.map((offer) => {
      if (!sandboxBookingsEnabled() || result.mode !== 'test' || !offer.offerId) return offer;
      const bookingOfferId = bookingStore.saveOffer(session(res).owner_id, {
        provider: 'liteapi',
        providerOfferId: offer.offerId,
        hotelId: offer.hotelId,
        guestNationality: input.guestNationality,
        view: {
          kind: 'hotel',
          name: offer.name,
          description: offer.board || 'Review room conditions before confirmation.',
          price: offer.price,
          currency: offer.currency,
          adults: input.adults,
          startDate: input.checkin,
          endDate: input.checkout,
          location: offer.address || destination.name,
          room: offer.room,
          tripId,
          confirmationAvailable: true,
        },
      });
      return { ...offer, bookingOfferId };
    });
    res.json({ ...result, offers });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large')
      return res
        .status(413)
        .json({ error: 'This request is too large. Use a smaller file or shorter text.' });
    if (error instanceof ZodError)
      return res.status(400).json({
        error: error.issues
          .map((issue) => `${issue.path.join('.') || 'Input'}: ${issue.message}`)
          .join('; '),
        code: 'INVALID_INPUT',
      });
    if (
      error instanceof HttpError ||
      error instanceof StudioError ||
      error instanceof StudioImportError ||
      error instanceof BookingError ||
      error instanceof AccountError ||
      error instanceof TripItemError ||
      error instanceof ProviderError ||
      error instanceof PlanningRunError ||
      error instanceof PlanningConstraintError
    )
      return res.status(error.status).json({
        error: error.message,
        ...(error instanceof ProviderError ||
        error instanceof BookingError ||
        error instanceof StudioError
          ? { code: error.code }
          : {}),
      });
    if (error instanceof SyntaxError && 'body' in error)
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request body is too large.' });
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
