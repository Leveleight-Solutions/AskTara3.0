import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Download, Eye, Link2, Save, ShieldCheck } from 'lucide-react';
import type { StudioAgency, StudioPricing, StudioWorkspace } from '../../shared/studio';
import type { StudioClientProposal, StudioProposalLink } from '../../shared/studio-proposals';
import { studioProposalMoney } from '../../shared/studio-proposals';
import { api } from '../api';
import { StudioProposalDocument } from '../pages/StudioProposal';
import '../pages/studio-proposal.css';

export function AgencySettings({
  agency,
  onAgencyUpdate,
  onError,
}: {
  agency: StudioAgency;
  onAgencyUpdate: (agency: StudioAgency) => void;
  onError?: (message: string) => void;
}) {
  const [draft, setDraft] = useState(agency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(agency), [agency]);
  const update = <K extends keyof StudioAgency>(key: K, value: StudioAgency[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ agency: StudioAgency }>('/studio/agency', {
        method: 'PATCH',
        body: JSON.stringify({
          agency: {
            ...draft,
            customQuestions: draft.customQuestions
              .map((question) => question.trim())
              .filter(Boolean),
          },
        }),
      });
      onAgencyUpdate(result.agency);
      setSaved(true);
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  async function logo(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a PNG or JPEG logo smaller than 5 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 600 / image.width, 240 / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Logo processing is unavailable.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const value = canvas.toDataURL('image/jpeg', 0.85);
      if (value.length > 200000) throw new Error('Please use a smaller logo.');
      update('logoDataUrl', value);
      setError('');
    } catch (cause) {
      setError((cause as Error).message || 'Unable to read this logo.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return (
    <form className="studio-proposal-controls" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        <legend>Agency identity</legend>
        <div className="studio-proposal-form-grid">
          <label>
            Agency name
            <input
              value={draft.name}
              required
              maxLength={120}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
          <label>
            Accent colour
            <input
              type="color"
              value={draft.accentColor}
              onChange={(event) => update('accentColor', event.target.value)}
            />
          </label>
          <label>
            Client contact email
            <input
              type="email"
              value={draft.email}
              maxLength={254}
              onChange={(event) => update('email', event.target.value)}
            />
          </label>
          <label>
            Client contact phone
            <input
              value={draft.phone}
              maxLength={50}
              onChange={(event) => update('phone', event.target.value)}
            />
          </label>
          <label>
            Agency website
            <input
              type="url"
              placeholder="https://your-agency.com"
              value={draft.website}
              onChange={(event) => update('website', event.target.value)}
            />
          </label>
          <label>
            Price validity (hours)
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={draft.quoteValidityHours}
              onChange={(event) => update('quoteValidityHours', Number(event.target.value))}
            />
          </label>
        </div>
        <label>
          Agency logo · PNG or JPEG
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => void logo(event.target.files?.[0])}
          />
        </label>
        {draft.logoDataUrl && (
          <div className="studio-proposal-actions">
            <img
              src={draft.logoDataUrl}
              alt="Agency logo preview"
              style={{ maxWidth: 140, maxHeight: 60 }}
            />
            <button
              type="button"
              className="button button-secondary"
              onClick={() => update('logoDataUrl', '')}
            >
              Remove logo
            </button>
          </div>
        )}
        <label>
          Client-facing proposal note
          <textarea
            value={draft.disclaimer}
            maxLength={2000}
            onChange={(event) => update('disclaimer', event.target.value)}
          />
        </label>
        <p>Published proposals keep their current branding until you explicitly republish them.</p>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Agency workflow</legend>
        <label>
          PNR format preference
          <select
            value={draft.gds}
            onChange={(event) => update('gds', event.target.value as StudioAgency['gds'])}
          >
            <option value="auto">Detect from supplied text</option>
            <option value="amadeus">Amadeus</option>
            <option value="sabre">Sabre</option>
            <option value="galileo">Galileo</option>
            <option value="other">Other</option>
          </select>
        </label>
        <p>
          This preference helps interpret imported records. It does not connect to or retrieve
          bookings from a GDS.
        </p>
        <label>
          Additional qualifying questions · one per line
          <textarea
            value={draft.customQuestions.join('\n')}
            onChange={(event) => update('customQuestions', event.target.value.split('\n'))}
            placeholder="Which frequent-flyer programme does the client use?"
          />
        </label>
        <label>
          Internal payment cost allowance (%)
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={draft.paymentCostPercent}
            onChange={(event) => update('paymentCostPercent', Number(event.target.value))}
          />
        </label>
        <p>
          Used only in your internal estimate. It does not add a client fee or change published
          prices.
        </p>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved && <p role="status">Agency settings saved.</p>}
      <button className="button button-primary" disabled={busy}>
        <Save size={15} />
        {busy ? 'Saving…' : 'Save agency settings'}
      </button>
    </form>
  );
}

export function StudioProposalControls({
  workspace,
  agency,
  onUpdate,
  onAgencyUpdate,
  onError,
}: {
  workspace: StudioWorkspace;
  agency: StudioAgency;
  onUpdate: (workspace: StudioWorkspace) => void;
  onAgencyUpdate: (agency: StudioAgency) => void;
  onError?: (message: string) => void;
}) {
  const [pricing, setPricing] = useState<StudioPricing>(workspace.pricing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<StudioClientProposal | null>(null);
  const [link, setLink] = useState<StudioProposalLink | null>(null);
  useEffect(() => {
    setPricing(workspace.pricing);
    setPreview(null);
  }, [workspace.revision, workspace.pricing]);
  useEffect(() => {
    if (link && link.token !== workspace.proposal?.token) setLink(null);
  }, [workspace.proposal?.token, link]);
  const dirty = JSON.stringify(pricing) !== JSON.stringify(workspace.pricing);
  const path = `/studio/workspaces/${workspace.id}`;
  const currentUrl = workspace.proposal
    ? `${window.location.origin}${link?.url || `/proposal/${workspace.proposal.token}`}`
    : '';
  const estimatedCosts = workspace.items
    .filter((item) => item.included && item.currency === pricing.currency && item.cost !== null)
    .reduce((sum, item) => sum + (item.cost || 0), 0);
  const paymentAllowance = ((pricing.packagePrice || 0) * agency.paymentCostPercent) / 100;
  const suggestedMarkup = (estimatedCosts * pricing.marginPercent) / 100;
  const missingCosts = workspace.items.filter(
    (item) => item.included && (item.cost === null || item.currency !== pricing.currency),
  ).length;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  async function savePricing(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await api<{ workspace: StudioWorkspace }>(path, {
        method: 'PATCH',
        body: JSON.stringify({ revision: workspace.revision, pricing }),
      });
      onUpdate(result.workspace);
      setNotice('Pricing saved. Published client links remain unchanged until republished.');
    });
  }
  async function publish() {
    await run(async () => {
      const result = await api<{ workspace: StudioWorkspace; proposal: StudioProposalLink }>(
        `${path}/proposal`,
        { method: 'POST', body: JSON.stringify({ revision: workspace.revision }) },
      );
      onUpdate(result.workspace);
      setLink(result.proposal);
      setNotice('Client proposal published. Copy the link to share it.');
    });
  }
  async function revoke() {
    await run(async () => {
      const result = await api<{ workspace: StudioWorkspace }>(`${path}/proposal`, {
        method: 'DELETE',
        body: JSON.stringify({ revision: workspace.revision }),
      });
      onUpdate(result.workspace);
      setLink(null);
      setNotice('The client link is revoked. Downloaded PDFs cannot be recalled.');
    });
  }
  async function showPreview() {
    await run(async () => {
      const result = await api<{ proposal: StudioClientProposal }>(`${path}/proposal/preview`);
      setPreview(result.proposal);
    });
  }
  return (
    <div className="studio-proposal-controls">
      <form onSubmit={(event) => void savePricing(event)}>
        <fieldset disabled={busy}>
          <legend>Client pricing</legend>
          <div className="studio-proposal-form-grid">
            <label>
              Proposal format
              <select
                value={pricing.mode}
                onChange={(event) =>
                  setPricing({ ...pricing, mode: event.target.value as StudioPricing['mode'] })
                }
              >
                <option value="itemised">Show itemised prices</option>
                <option value="package">Show one package price</option>
              </select>
            </label>
            <label>
              Package / working currency
              <input
                value={pricing.currency}
                required
                minLength={3}
                maxLength={3}
                pattern="[A-Z]{3}"
                onChange={(event) =>
                  setPricing({ ...pricing, currency: event.target.value.toUpperCase() })
                }
              />
            </label>
            {pricing.mode === 'package' && (
              <label>
                Total package price
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  required
                  value={pricing.packagePrice ?? ''}
                  onChange={(event) =>
                    setPricing({
                      ...pricing,
                      packagePrice: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                />
              </label>
            )}
          </div>
          <label>
            Client-facing pricing notes
            <textarea
              value={pricing.notes}
              maxLength={2000}
              onChange={(event) => setPricing({ ...pricing, notes: event.target.value })}
              placeholder="Explain inclusions, exclusions and what needs reconfirmation."
            />
          </label>
          <p>
            {pricing.mode === 'package'
              ? 'Your explicit package price is shown to the client. Individual prices and supplier costs stay private.'
              : 'Item totals stay in their original currencies. Test rates are labelled and excluded; estimates remain labelled.'}
          </p>
          <details className="studio-proposal-internal">
            <summary>Internal commercial estimate · never shown to clients</summary>
            <label>
              Markup on recorded costs (%)
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={pricing.marginPercent}
                onChange={(event) =>
                  setPricing({ ...pricing, marginPercent: Number(event.target.value) })
                }
              />
            </label>
            <p>
              Recorded costs in {pricing.currency}:{' '}
              {studioProposalMoney(estimatedCosts, pricing.currency)}
              {missingCosts
                ? ` · ${missingCosts} item(s) have missing costs or another currency.`
                : ''}
            </p>
            <p>
              Markup allowance: {studioProposalMoney(suggestedMarkup, pricing.currency)}. Payment
              cost allowance: {studioProposalMoney(paymentAllowance, pricing.currency)} (
              {agency.paymentCostPercent}% of the entered package price).
            </p>
            <p>
              Illustrative costs plus allowances:{' '}
              {studioProposalMoney(
                estimatedCosts + suggestedMarkup + paymentAllowance,
                pricing.currency,
              )}
              . This is an internal calculation, not a complete trip cost or a client fee. Enter any
              chosen package price yourself.
            </p>
          </details>
          <button className="button button-secondary" disabled={busy || !dirty}>
            <Save size={15} />
            Save pricing
          </button>
        </fieldset>
      </form>
      <details>
        <summary>Agency branding and workflow settings</summary>
        <AgencySettings agency={agency} onAgencyUpdate={onAgencyUpdate} onError={onError} />
      </details>
      <fieldset>
        <legend>Review and share</legend>
        <p>
          <ShieldCheck size={14} /> Only selected items, recommendations and client-facing
          descriptions are included. Private context, imported documents, chat, booking references
          and internal costs are excluded. Review the preview before publishing.
        </p>
        {!workspace.structureAccepted && <p>Accept the trip structure before publishing.</p>}
        {workspace.items.some((item) => item.included && item.needsReview) && (
          <p>Review the included imported items before publishing.</p>
        )}
        {dirty && <p>Save your pricing changes before previewing or publishing.</p>}
        <div className="studio-proposal-actions">
          <button
            className="button button-secondary"
            disabled={busy || dirty}
            onClick={() => void showPreview()}
          >
            <Eye size={15} />
            Preview client proposal
          </button>
          <a
            className="button button-secondary"
            href={`/api${path}/proposal/preview/pdf`}
            download
            onClick={(event) => {
              if (busy || dirty) event.preventDefault();
            }}
            aria-disabled={busy || dirty}
          >
            <Download size={15} />
            Download draft PDF
          </a>
          <button
            className="button button-primary"
            disabled={
              busy ||
              dirty ||
              !workspace.structureAccepted ||
              workspace.items.some((item) => item.included && item.needsReview)
            }
            onClick={() => void publish()}
          >
            <Link2 size={15} />
            {workspace.proposal ? 'Republish client proposal' : 'Publish client proposal'}
          </button>
        </div>
        {workspace.proposal && (
          <div className="studio-proposal-link">
            <strong>Client link</strong>
            <p>
              <a href={currentUrl} target="_blank" rel="noopener noreferrer">
                {currentUrl}
              </a>
            </p>
            <div className="studio-proposal-actions">
              <button
                className="button button-secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(currentUrl)
                    .then(() => setNotice('Client link copied.'))
                    .catch(() => setError('Copy the link displayed above.'))
                }
              >
                <Copy size={14} />
                Copy link
              </button>
              <a
                className="button button-secondary"
                href={`/api/studio/proposals/${workspace.proposal.token}/pdf`}
                download
              >
                <Download size={14} />
                Published PDF
              </a>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => void revoke()}
              >
                Revoke link
              </button>
            </div>
            <p>
              Republishing replaces this link with a new snapshot and revokes the previous link.
              Prices require reconfirmation after the agency validity period; the viewer remains
              available.
            </p>
          </div>
        )}
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <div className="studio-proposal-preview">
          <StudioProposalDocument proposal={preview} preview />
        </div>
      )}
    </div>
  );
}

export default StudioProposalControls;
export { AgencySettings as StudioAgencySettings };
