import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { Express, Response } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import type { StudioAgency, StudioWorkspace } from '../shared/studio.ts';
import type { StudioClientProposal, StudioProposalLink } from '../shared/studio-proposals.ts';
import { studioProposalIsStale, studioProposalMoney } from '../shared/studio-proposals.ts';
import { StudioError } from './studio-store.ts';

const revisionBody = z.object({ revision: z.number().int().nonnegative() }).strict();
const tokenPattern = /^[a-f0-9]{64}$/;
const text = (value: string, max = 3000) =>
  String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max);
export const studioAgencySlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'agency';

/** Public source links cannot carry supplier booking/session query strings or imported PNRs. */
function publicSourceUrl(value: string, privateReferences: string[]) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
      url.hostname.endsWith('.local') ||
      /(?:booking|reservation|manage|checkout|confirmation|passport|pnr)/i.test(url.pathname)
    )
      return '';
    if (
      privateReferences.some((reference) => value.toLowerCase().includes(reference.toLowerCase()))
    )
      return '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function buildStudioClientProposal(
  workspace: StudioWorkspace,
  agency: StudioAgency,
  now = new Date(),
): StudioClientProposal {
  const privateReferences = workspace.items
    .map((item) => item.privateReference.trim())
    .filter((reference) => reference.length >= 3);
  const publicText = (value: string, max = 3000) => {
    let result = text(value, max);
    for (const reference of privateReferences)
      result = result.replace(
        new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        '[reference removed]',
      );
    return result.replace(
      /\b(?:PNR|record locator|booking reference|passport(?: number)?)\s*[:#=]\s*[a-z0-9-]+/gi,
      '[private reference removed]',
    );
  };
  const included = workspace.items.filter((item) => item.included);
  const packageMode = workspace.pricing.mode === 'package';
  const validityMs = Math.max(1, Math.min(720, agency.quoteValidityHours || 48)) * 60 * 60 * 1000;
  let validUntil = now.getTime() + validityMs;
  const totals = new Map<
    string,
    { currency: string; amount: number; containsEstimates: boolean }
  >();
  for (const item of included) {
    if (item.price === null || item.priceStatus === 'sandbox' || item.priceStatus === 'unpriced')
      continue;
    if (!packageMode) {
      const total = totals.get(item.currency) || {
        currency: item.currency,
        amount: 0,
        containsEstimates: false,
      };
      total.amount = Math.round((total.amount + item.price) * 100) / 100;
      total.containsEstimates ||= item.priceStatus === 'agent_estimate';
      totals.set(item.currency, total);
    }
    if (item.priceStatus === 'supplier_quote') {
      const quoted = Date.parse(item.quotedAt);
      // An undated supplier quote cannot gain a fresh validity window through publication.
      validUntil = Math.min(
        validUntil,
        Number.isFinite(quoted) ? quoted + validityMs : now.getTime(),
      );
    }
  }
  return {
    version: 1,
    title: publicText(workspace.title, 200),
    clientName: publicText(workspace.brief.clientName, 150),
    publishedAt: now.toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    revision: workspace.revision,
    agency: {
      name: publicText(agency.name, 120),
      slug: studioAgencySlug(agency.name),
      logoDataUrl:
        /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(agency.logoDataUrl) &&
        agency.logoDataUrl.length <= 200000
          ? agency.logoDataUrl
          : '',
      accentColor: /^#[a-fA-F0-9]{6}$/.test(agency.accentColor) ? agency.accentColor : '#285641',
      email: publicText(agency.email, 254),
      phone: publicText(agency.phone, 50),
      website: publicSourceUrl(agency.website, privateReferences),
      disclaimer: publicText(agency.disclaimer, 2000),
    },
    trip: {
      startDate: workspace.brief.startDate,
      endDate: workspace.brief.endDate,
      adults: workspace.brief.adults,
      children: workspace.brief.children,
    },
    stops: workspace.stops.map((stop) => ({
      id: stop.id,
      name: publicText(stop.name, 120),
      country: publicText(stop.country, 100),
      nights: stop.nights,
      arrivalDate: stop.arrivalDate,
      departureDate: stop.departureDate,
      onwardTransport: stop.onwardTransport,
      neighbourhood: publicText(stop.neighbourhood, 150),
    })),
    items: included.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: publicText(item.title, 200),
      description: publicText(item.description),
      stopId: item.stopId,
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      price: packageMode || item.priceStatus === 'unpriced' ? null : item.price,
      currency: item.currency,
      priceStatus: item.priceStatus,
      quotedAt: item.quotedAt,
    })),
    recommendations: workspace.recommendations
      .filter((item) => item.included)
      .map((item) => ({
        id: item.id,
        stopId: item.stopId,
        name: publicText(item.name, 200),
        category: item.category,
        description: publicText(item.description),
        sources: item.sources.flatMap((source) => {
          const url = publicSourceUrl(source.url, privateReferences);
          return url
            ? [{ label: publicText(source.label, 150), url, checkedAt: source.checkedAt }]
            : [];
        }),
      })),
    itinerary: workspace.itinerary
      ? {
          generatedAt: text(workspace.itinerary.generatedAt, 40),
          days: workspace.itinerary.days.map((day) => ({
            day: day.day,
            date: text(day.date, 10),
            stopIds: day.stopIds.filter((id) => workspace.stops.some((stop) => stop.id === id)),
            title: publicText(day.title, 200),
            summary: publicText(day.summary),
            activities: day.activities.map((activity) => ({
              period: activity.period,
              title: publicText(activity.title, 200),
              description: publicText(activity.description),
              sources: activity.sources.flatMap((source) => {
                const url = publicSourceUrl(source.url, privateReferences);
                return url
                  ? [
                      {
                        label: publicText(source.label, 150),
                        url,
                        checkedAt: text(source.checkedAt, 40),
                      },
                    ]
                  : [];
              }),
            })),
          })),
          notes: workspace.itinerary.notes.map((note) => publicText(note, 2000)),
        }
      : null,
    pricing: {
      mode: workspace.pricing.mode,
      packagePrice: packageMode ? workspace.pricing.packagePrice : null,
      currency: workspace.pricing.currency,
      notes: publicText(workspace.pricing.notes, 2000),
      totals: [...totals.values()],
      unpricedCount: included.filter(
        (item) => item.price === null || item.priceStatus === 'unpriced',
      ).length,
      sandboxCount: included.filter((item) => item.priceStatus === 'sandbox').length,
    },
    notice:
      'This proposal creates no reservation or insurance cover. Your agent will reconfirm availability, prices and terms before booking. Items marked as externally booked were reported by your agent; this proposal does not verify their booking status.',
  };
}

export function initializeStudioProposalStorage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS studio_proposals (
    token TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, revoked_at TEXT
  ); CREATE INDEX IF NOT EXISTS studio_proposals_workspace ON studio_proposals(workspace_id, owner_id);`);
}

/** All output comes from the sanitized snapshot, including PDF metadata. */
export async function studioProposalPdf(
  proposal: StudioClientProposal,
  now = Date.now(),
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    bufferPages: true,
    font: fileURLToPath(new URL('./assets/fonts/NotoSans-Regular.ttf', import.meta.url)),
    info: { Title: proposal.title, Author: proposal.agency.name, Subject: 'Travel proposal' },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.registerFont(
    'ProposalLatin',
    fileURLToPath(new URL('./assets/fonts/NotoSans-Regular.ttf', import.meta.url)),
  );
  doc.registerFont(
    'ProposalCJK',
    fileURLToPath(new URL('./assets/fonts/NotoSansJP.ttf', import.meta.url)),
  );
  const write = (value: string, options: PDFKit.Mixins.TextOptions = {}) => {
    const runs = value.split(/([\u2e80-\u9fff\uf900-\ufaff]+)/u).filter(Boolean);
    runs.forEach((run, index) => {
      doc
        .font(/[\u2e80-\u9fff\uf900-\ufaff]/u.test(run) ? 'ProposalCJK' : 'ProposalLatin')
        .text(run, { ...options, continued: index < runs.length - 1 });
    });
    return doc;
  };
  const body = (value: string) => {
    if (value) {
      doc.fillColor('#374139').fontSize(10);
      write(value, { lineGap: 3 }).moveDown(0.65);
    }
  };
  const heading = (value: string) => {
    if (doc.y > 710) doc.addPage();
    doc.fillColor(proposal.agency.accentColor).fontSize(17);
    write(value).moveDown(0.45);
  };
  if (proposal.agency.logoDataUrl) {
    try {
      doc.image(Buffer.from(proposal.agency.logoDataUrl.split(',')[1], 'base64'), 48, 42, {
        fit: [105, 55],
      });
      doc.y = 110;
    } catch {
      /* Invalid image data never prevents access to the text proposal. */
    }
  }
  body(proposal.agency.name);
  doc.fillColor(proposal.agency.accentColor).fontSize(26);
  write(proposal.title).moveDown(0.4);
  if (proposal.clientName) body(`Prepared for ${proposal.clientName}`);
  body(
    [proposal.trip.startDate, proposal.trip.endDate].filter(Boolean).join(' to ') ||
      'Travel dates to be confirmed',
  );
  body(
    [
      proposal.trip.adults === null ? '' : `${proposal.trip.adults} adults`,
      proposal.trip.children === null ? '' : `${proposal.trip.children} children`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  body(
    studioProposalIsStale(proposal, now)
      ? 'PRICES NEED RECONFIRMATION. The price validity period has passed. This proposal remains available for reference.'
      : `Prices require reconfirmation after ${new Date(proposal.validUntil).toLocaleString('en-AU', { timeZone: 'UTC' })} UTC, or sooner if availability changes.`,
  );
  heading('Your route');
  for (const stop of proposal.stops) {
    body(
      `${stop.name}${stop.country ? `, ${stop.country}` : ''} · ${stop.nights === null ? 'Nights to confirm' : `${stop.nights} nights`}\n${[stop.arrivalDate, stop.departureDate].filter(Boolean).join(' to ')}${stop.neighbourhood ? `\nArea: ${stop.neighbourhood}` : ''}${stop.onwardTransport !== 'undecided' ? `\nOnward travel: ${stop.onwardTransport}` : ''}`,
    );
  }
  if (proposal.itinerary?.days.length) {
    heading('Your daily itinerary');
    for (const day of proposal.itinerary.days) {
      heading(`Day ${day.day}${day.date ? ` · ${day.date}` : ''} · ${day.title}`);
      body(day.summary);
      for (const activity of day.activities) {
        doc.fillColor('#202b24').fontSize(12);
        write(`${activity.period} · ${activity.title}`).moveDown(0.25);
        body(activity.description);
        for (const source of activity.sources)
          body(
            `${source.label}: ${source.url}${source.checkedAt ? ` (checked ${source.checkedAt.slice(0, 10)})` : ''}`,
          );
      }
    }
    for (const note of proposal.itinerary.notes) body(note);
  }
  if (proposal.items.length) heading('Included services');
  for (const item of proposal.items) {
    doc.fillColor('#202b24').fontSize(12);
    write(item.title).moveDown(0.25);
    body(
      [
        item.startDate && [item.startDate, item.endDate].filter(Boolean).join(' to '),
        item.description,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    body(
      [
        item.status === 'externally_booked'
          ? 'Externally booked — reported by your agent'
          : item.status === 'placeholder'
            ? 'Details to be confirmed'
            : 'Proposed — not booked',
        item.priceStatus === 'sandbox'
          ? 'SANDBOX TEST RATE — excluded from totals'
          : item.priceStatus === 'agent_estimate'
            ? 'Agent estimate — subject to confirmation'
            : item.priceStatus === 'supplier_quote'
              ? 'Supplier quote — subject to availability'
              : 'Price to be confirmed',
        item.price === null ? '' : studioProposalMoney(item.price, item.currency),
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (proposal.recommendations.length) heading('Ideas to explore');
  for (const item of proposal.recommendations) {
    doc.fillColor('#202b24').fontSize(12);
    write(item.name).moveDown(0.25);
    body(item.description);
    for (const source of item.sources)
      body(
        `${source.label}: ${source.url}${source.checkedAt ? ` (checked ${source.checkedAt.slice(0, 10)})` : ''}`,
      );
  }
  heading('Proposal pricing');
  if (proposal.pricing.mode === 'package')
    body(
      proposal.pricing.packagePrice === null
        ? 'Package price to be confirmed.'
        : `${studioProposalMoney(proposal.pricing.packagePrice, proposal.pricing.currency)} — package price set by your agent.`,
    );
  else {
    for (const total of proposal.pricing.totals)
      body(
        `${studioProposalMoney(total.amount, total.currency)} — priced items${total.containsEstimates ? ', including agent estimates' : ''}.`,
      );
    if (!proposal.pricing.totals.length) body('No confirmed priced items.');
    if (proposal.pricing.totals.length > 1)
      body('Currencies are shown separately. No exchange rate has been applied.');
    if (proposal.pricing.unpricedCount)
      body(
        `${proposal.pricing.unpricedCount} items still require pricing. These figures are not a complete trip total.`,
      );
  }
  if (proposal.pricing.sandboxCount)
    body(
      `${proposal.pricing.sandboxCount} services use sandbox test rates. These rates are illustrative and excluded from item totals.`,
    );
  body(proposal.pricing.notes);
  body(proposal.notice);
  body(proposal.agency.disclaimer);
  body(
    [proposal.agency.email, proposal.agency.phone, proposal.agency.website]
      .filter(Boolean)
      .join(' · '),
  );
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc.fillColor('#677369').fontSize(8);
    doc.x = 48;
    doc.y = 802;
    write(`${proposal.agency.name} · Proposal · ${page + 1} / ${range.count}`, {
      lineBreak: false,
    });
  }
  doc.end();
  return finished;
}

interface ProposalStore {
  get(ownerId: string, id: string): StudioWorkspace | undefined;
  save(ownerId: string, workspace: StudioWorkspace, expectedRevision: number): StudioWorkspace;
  getAgency(ownerId: string): StudioAgency;
}

export function installStudioProposalRoutes(
  app: Express,
  options: {
    db: DatabaseSync;
    session: (res: Response) => { owner_id: string };
    requireActiveSession: (res: Response) => void;
    store: ProposalStore;
  },
) {
  const { db, session, requireActiveSession, store } = options;
  initializeStudioProposalStorage(db);
  const owned = (res: Response, id: string) => {
    const workspace = store.get(session(res).owner_id, id);
    if (!workspace) throw new StudioError(404, 'Workspace not found.');
    return workspace;
  };
  const read = (token: string) => {
    if (!tokenPattern.test(token)) throw new StudioError(404, 'This proposal link is unavailable.');
    const row = db
      .prepare('SELECT snapshot_json FROM studio_proposals WHERE token = ? AND revoked_at IS NULL')
      .get(token);
    if (!row) throw new StudioError(404, 'This proposal link is unavailable.');
    return JSON.parse(String(row.snapshot_json)) as StudioClientProposal;
  };
  app.get('/api/studio/workspaces/:id/proposal/preview', (req, res) => {
    const workspace = owned(res, String(req.params.id));
    res.json({
      proposal: buildStudioClientProposal(workspace, store.getAgency(session(res).owner_id)),
    });
  });
  app.get('/api/studio/workspaces/:id/proposal/preview/pdf', async (req, res) => {
    const workspace = owned(res, String(req.params.id));
    const pdf = await studioProposalPdf(
      buildStudioClientProposal(workspace, store.getAgency(session(res).owner_id)),
    );
    requireActiveSession(res);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', 'attachment; filename="travel-proposal-preview.pdf"');
    res.send(pdf);
  });
  app.post('/api/studio/workspaces/:id/proposal', (req, res) => {
    const { revision } = revisionBody.parse(req.body);
    const ownerId = session(res).owner_id;
    const workspace = owned(res, String(req.params.id));
    if (workspace.revision !== revision)
      throw new StudioError(409, 'This workspace changed. Refresh it before publishing.');
    if (!workspace.structureAccepted || !workspace.stops.length)
      throw new StudioError(400, 'Accept the trip structure before publishing a proposal.');
    if (workspace.items.some((item) => item.included && item.needsReview))
      throw new StudioError(400, 'Review the included imported items before publishing.');
    if (workspace.pricing.mode === 'package' && workspace.pricing.packagePrice === null)
      throw new StudioError(
        400,
        'Set the package price or use itemised pricing before publishing.',
      );
    const token = randomBytes(32).toString('hex');
    const snapshot = buildStudioClientProposal(workspace, store.getAgency(ownerId));
    const link: StudioProposalLink = {
      token,
      slug: snapshot.agency.slug,
      url: `/proposal/${snapshot.agency.slug}/${token}`,
      pdfUrl: `/api/studio/proposals/${token}/pdf`,
      publishedAt: snapshot.publishedAt,
      validUntil: snapshot.validUntil,
    };
    requireActiveSession(res);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'UPDATE studio_proposals SET revoked_at = ? WHERE workspace_id = ? AND owner_id = ? AND revoked_at IS NULL',
      ).run(snapshot.publishedAt, workspace.id, ownerId);
      workspace.proposal = { token, publishedAt: snapshot.publishedAt, revision };
      workspace.stage = 'proposal';
      const saved = store.save(ownerId, workspace, revision);
      db.prepare(
        'INSERT INTO studio_proposals (token, workspace_id, owner_id, snapshot_json) VALUES (?, ?, ?, ?)',
      ).run(token, workspace.id, ownerId, JSON.stringify(snapshot));
      db.exec('COMMIT');
      res.status(201).json({ workspace: saved, proposal: link });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  app.delete('/api/studio/workspaces/:id/proposal', (req, res) => {
    const { revision } = revisionBody.parse(req.body);
    const ownerId = session(res).owner_id;
    const workspace = owned(res, String(req.params.id));
    requireActiveSession(res);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'UPDATE studio_proposals SET revoked_at = ? WHERE workspace_id = ? AND owner_id = ? AND revoked_at IS NULL',
      ).run(new Date().toISOString(), workspace.id, ownerId);
      workspace.proposal = null;
      const saved = store.save(ownerId, workspace, revision);
      db.exec('COMMIT');
      res.json({ workspace: saved });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  app.get('/api/studio/proposals/:token', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json({ proposal: read(String(req.params.token)) });
  });
  app.get('/api/studio/proposals/:token/pdf', async (req, res) => {
    const token = String(req.params.token);
    const pdf = await studioProposalPdf(read(token));
    // A revocation that happened while rendering applies to this download too.
    read(token);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', 'attachment; filename="travel-proposal.pdf"');
    res.send(pdf);
  });
}
