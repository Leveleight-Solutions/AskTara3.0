import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Message, Trip } from '../shared/types.ts';
import type {
  PlanningRun,
  TravelBrief,
  WorkflowInput,
  WorkflowResult,
} from '../shared/planning.ts';
import { ownedTrip, persistTrip, persistTripRevision } from './database.ts';
import { runPlanningWorkflow } from './agents/index.ts';
import { stripGooglePlaceContent } from './agents/places.ts';
import { planningFailureReason } from './agents/failures.ts';

export class PlanningRunError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Workflow = (input: WorkflowInput) => Promise<WorkflowResult>;
type Context = { ownerId: string; sessionId: string };
type StartInput = Context & {
  trip: Trip;
  message: string;
  requestId: string;
  brief?: Partial<TravelBrief>;
  isNew: boolean;
  persistDraft: boolean;
};
type RunRow = { data: string; owner_id: string; session_id: string; error_status: number | null };
const terminal = (run: PlanningRun) => !['queued', 'running'].includes(run.status);

export class PlanningRunManager {
  private active = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<PlanningRun>;
      sessionId: string;
      tripId: string;
    }
  >();
  constructor(
    private db: DatabaseSync,
    private workflow: Workflow = runPlanningWorkflow,
  ) {}

  private row(id: string) {
    return this.db
      .prepare('SELECT data, owner_id, session_id, error_status FROM planning_runs WHERE id = ?')
      .get(id) as RunRow | undefined;
  }
  get(ownerId: string, id: string): PlanningRun | undefined {
    const row = this.row(id);
    return row?.owner_id === ownerId ? JSON.parse(row.data) : undefined;
  }
  byRequest(ownerId: string, requestId: string): PlanningRun | undefined {
    const row = this.db
      .prepare('SELECT data FROM planning_runs WHERE owner_id = ? AND request_id = ?')
      .get(ownerId, requestId);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  list(ownerId: string, tripId: string): PlanningRun[] {
    return this.db
      .prepare(
        'SELECT data FROM planning_runs WHERE owner_id = ? AND trip_id = ? ORDER BY rowid DESC LIMIT 20',
      )
      .all(ownerId, tripId)
      .map((row) => JSON.parse(String(row.data)));
  }
  private write(run: PlanningRun, status?: number) {
    run.updatedAt = new Date().toISOString();
    const stored = run.result
      ? { ...run, result: { ...run.result, trip: stripGooglePlaceContent(run.result.trip) } }
      : run;
    this.db
      .prepare('UPDATE planning_runs SET data = ?, error_status = ? WHERE id = ?')
      .run(JSON.stringify(stored), status ?? null, run.id);
  }
  private assertSession(context: Context) {
    if (
      !this.db
        .prepare('SELECT id FROM sessions WHERE id = ? AND owner_id = ? AND expires_at > ?')
        .get(context.sessionId, context.ownerId, Date.now())
    )
      throw new PlanningRunError(
        409,
        'Your session changed while this request was running. Please try again.',
      );
  }
  start(input: StartInput): PlanningRun {
    this.assertSession(input);
    const existing = this.byRequest(input.ownerId, input.requestId);
    if (existing) {
      if (!input.isNew && existing.tripId !== input.trip.id)
        throw new PlanningRunError(
          409,
          'This request ID belongs to a different trip. Start a new request.',
        );
      return existing;
    }
    if (this.list(input.ownerId, input.trip.id).some((run) => !terminal(run)))
      throw new PlanningRunError(
        409,
        'Tara is already updating this trip. Please wait for the reply.',
      );
    const activeCount = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM planning_runs WHERE owner_id = ? AND json_extract(data, '$.status') IN ('queued', 'running')",
      )
      .get(input.ownerId);
    if (Number(activeCount?.count) >= 3)
      throw new PlanningRunError(429, 'Finish or cancel an active plan before starting another.');
    const now = new Date().toISOString();
    const run: PlanningRun = {
      id: randomUUID(),
      tripId: input.trip.id,
      requestId: input.requestId,
      status: 'queued',
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (input.persistDraft && input.isNew)
        persistTrip(this.db, input.ownerId, { ...input.trip, revision: 0 });
      this.db
        .prepare(
          'INSERT INTO planning_runs (id, owner_id, session_id, request_id, trip_id, data) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          run.id,
          input.ownerId,
          input.sessionId,
          input.requestId,
          run.tripId,
          JSON.stringify(run),
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const controller = new AbortController();
    // Yield once so the caller receives the durable run ID before work begins.
    const promise = new Promise<void>((resolve) => setImmediate(resolve)).then(() =>
      this.execute(run, structuredClone(input), controller),
    );
    this.active.set(run.id, {
      controller,
      promise,
      sessionId: input.sessionId,
      tripId: run.tripId,
    });
    void promise.finally(() => this.active.delete(run.id)).catch(() => {});
    return structuredClone(run);
  }
  async wait(ownerId: string, id: string) {
    const active = this.active.get(id);
    const run = active ? await active.promise : this.get(ownerId, id);
    if (!run) throw new PlanningRunError(404, 'Planning run not found.');
    if (run.status !== 'completed' || !run.result)
      throw new PlanningRunError(
        this.row(id)?.error_status ?? 409,
        run.error || 'Planning was cancelled. Your saved trip is unchanged.',
      );
    return run.result;
  }
  cancel(ownerId: string, id: string): PlanningRun {
    const run = this.get(ownerId, id);
    if (!run) throw new PlanningRunError(404, 'Planning run not found.');
    if (terminal(run)) return run;
    run.status = 'cancelled';
    run.error = 'Planning was cancelled. Your saved trip is unchanged.';
    this.write(run, 409);
    this.active.get(id)?.controller.abort(new PlanningRunError(409, run.error));
    return run;
  }
  cancelSession(sessionId: string) {
    for (const [id, active] of this.active) {
      if (active.sessionId !== sessionId) continue;
      const row = this.row(id);
      if (!row) continue;
      const run = JSON.parse(row.data) as PlanningRun;
      if (terminal(run)) continue;
      run.status = 'failed';
      run.error = 'Your session changed while this request was running. Please try again.';
      this.write(run, 409);
      active.controller.abort(new PlanningRunError(409, run.error));
    }
  }
  cancelTrip(ownerId: string, tripId: string) {
    for (const run of this.list(ownerId, tripId)) if (!terminal(run)) this.cancel(ownerId, run.id);
  }
  async shutdown() {
    for (const active of this.active.values())
      active.controller.abort(
        new PlanningRunError(503, 'Planning was interrupted by a server shutdown. Please retry.'),
      );
    await Promise.allSettled([...this.active.values()].map((active) => active.promise));
  }
  private async execute(
    initial: PlanningRun,
    input: StartInput,
    controller: AbortController,
  ): Promise<PlanningRun> {
    let run = this.get(input.ownerId, initial.id) ?? initial;
    if (terminal(run)) return run;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new PlanningRunError(
            504,
            'Planning took too long. Your saved trip is unchanged. Please retry.',
          ),
        ),
      360_000,
    );
    timeout.unref();
    try {
      this.assertSession(input);
      controller.signal.throwIfAborted();
      run.status = 'running';
      this.write(run);
      let rejectAbort!: (error: unknown) => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = reject;
      });
      const abort = () =>
        rejectAbort(
          controller.signal.reason ?? new PlanningRunError(409, 'Planning was cancelled.'),
        );
      controller.signal.addEventListener('abort', abort, { once: true });
      let planned: WorkflowResult;
      try {
        planned = await Promise.race([
          this.workflow({
            trip: structuredClone(input.trip),
            message: input.message,
            brief: input.brief,
            signal: controller.signal,
            onEvent: (event) => {
              if (controller.signal.aborted) return;
              const current = this.get(input.ownerId, run.id);
              if (!current || terminal(current)) return;
              current.events.push(event);
              current.events = current.events.slice(-100);
              this.write(current);
            },
          }),
          aborted,
        ]);
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
      controller.signal.throwIfAborted();
      this.assertSession(input);
      run = this.get(input.ownerId, run.id) ?? run;
      if (terminal(run)) return run;
      const latest = ownedTrip(this.db, input.ownerId, input.trip.id);
      if ((!input.isNew || input.persistDraft) && !latest)
        throw new PlanningRunError(409, 'The trip was deleted or moved while Tara was replying.');
      if (latest && (latest.revision ?? 0) !== (input.trip.revision ?? 0))
        throw new PlanningRunError(
          409,
          'Your trip changed while Tara was planning. Your edits were kept. Send the request again to plan from the latest version.',
        );
      const userMessage: Message = {
        id: randomUUID(),
        role: 'user',
        content: input.message,
        createdAt: new Date().toISOString(),
      };
      const message: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: planned.reply,
        createdAt: new Date().toISOString(),
      };
      const trip: Trip = {
        ...planned.trip,
        id: input.trip.id,
        createdAt: input.trip.createdAt,
        shareToken: latest?.shareToken ?? null,
        planning: planned.report,
        messages: [...input.trip.messages, userMessage, message],
      };
      // A successful plan and its terminal run record must survive a crash together.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        persistTripRevision(this.db, input.ownerId, trip, 'Tara updated the itinerary', {
          transaction: false,
        });
        run.status = 'completed';
        run.result = {
          trip,
          message,
          mode: planned.mode,
          ...(planned.warning ? { warning: planned.warning } : {}),
        };
        this.write(run);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        delete run.result;
        throw error;
      }
      return run;
    } catch (error) {
      const current = this.get(input.ownerId, run.id);
      if (current && terminal(current)) return current;
      run = current ?? run;
      run.status =
        controller.signal.aborted &&
        !(
          controller.signal.reason instanceof PlanningRunError &&
          controller.signal.reason.status >= 500
        )
          ? 'cancelled'
          : 'failed';
      const known = error instanceof Error && 'status' in error && typeof error.status === 'number';
      run.error = known
        ? error.message
        : 'Tara could not finish this plan. Your saved trip is unchanged. Please retry.';
      if (run.status === 'failed')
        console.warn('Planning failed', {
          runId: run.id,
          stage: run.events.at(-1)?.agent || 'intake',
          reason: planningFailureReason(error),
        });
      this.write(run, known ? Number(error.status) : 500);
      return run;
    } finally {
      clearTimeout(timeout);
    }
  }
}
