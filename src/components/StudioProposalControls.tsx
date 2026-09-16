import { useEffect, useState, type FormEvent } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  Eye,
  Link2,
  Lock,
  Save,
  ShieldCheck,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Reset,
  Select,
  Separator,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import type { StudioAgency, StudioPricing, StudioWorkspace } from '../../shared/studio';
import type { StudioClientProposal, StudioProposalLink } from '../../shared/studio-proposals';
import { studioProposalMoney } from '../../shared/studio-proposals';
import { api } from '../api';
import { StudioProposalDocument } from '../pages/StudioProposal';

/** `<fieldset disabled>` is kept for its native disable cascade; this strips the UA chrome. */
const bareFieldset = { border: 0, margin: 0, padding: 0, minInlineSize: 'auto' as const };

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
    <form onSubmit={(event) => void save(event)}>
      <Flex direction="column" gap="4">
        <Card size="2">
          <Reset>
            <fieldset disabled={busy} style={bareFieldset}>
              <Reset>
                <legend>
                  <Heading as="h3" size="3" mb="3">
                    Agency identity
                  </Heading>
                </legend>
              </Reset>
              <Flex direction="column" gap="3">
                <Grid columns={{ initial: '1', sm: '2' }} gap="3">
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Agency name
                    </Text>
                    <TextField.Root
                      size="3"
                      value={draft.name}
                      required
                      maxLength={120}
                      onChange={(event) => update('name', event.target.value)}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Accent colour
                    </Text>
                    {/* Radix Themes has no colour picker; the native control stores the agency's
                        own brand colour, which is data rather than app styling. */}
                    <input
                      type="color"
                      value={draft.accentColor}
                      onChange={(event) => update('accentColor', event.target.value)}
                      style={{
                        width: '100%',
                        height: 40,
                        padding: 'var(--space-1)',
                        border: '1px solid var(--gray-a7)',
                        borderRadius: 'var(--radius-2)',
                        background: 'var(--color-surface)',
                      }}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Client contact email
                    </Text>
                    <TextField.Root
                      size="3"
                      type="email"
                      value={draft.email}
                      maxLength={254}
                      onChange={(event) => update('email', event.target.value)}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Client contact phone
                    </Text>
                    <TextField.Root
                      size="3"
                      value={draft.phone}
                      maxLength={50}
                      onChange={(event) => update('phone', event.target.value)}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Agency website
                    </Text>
                    <TextField.Root
                      size="3"
                      type="url"
                      placeholder="https://your-agency.com"
                      value={draft.website}
                      onChange={(event) => update('website', event.target.value)}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Price validity (hours)
                    </Text>
                    <TextField.Root
                      size="3"
                      type="number"
                      min={1}
                      max={720}
                      step={1}
                      value={draft.quoteValidityHours}
                      onChange={(event) => update('quoteValidityHours', Number(event.target.value))}
                    />
                  </label>
                </Grid>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Agency logo · PNG or JPEG
                  </Text>
                  {/* Radix Themes has no file input; the native control is kept. */}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(event) => void logo(event.target.files?.[0])}
                    style={{ fontSize: 'var(--font-size-2)' }}
                  />
                </label>
                {draft.logoDataUrl && (
                  <Flex align="center" gap="3" wrap="wrap">
                    <img
                      src={draft.logoDataUrl}
                      alt="Agency logo preview"
                      style={{ maxWidth: 140, maxHeight: 60 }}
                    />
                    <Button
                      type="button"
                      size="3"
                      variant="soft"
                      color="gray"
                      onClick={() => update('logoDataUrl', '')}
                    >
                      Remove logo
                    </Button>
                  </Flex>
                )}
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Client-facing proposal note
                  </Text>
                  <TextArea
                    size="3"
                    value={draft.disclaimer}
                    maxLength={2000}
                    onChange={(event) => update('disclaimer', event.target.value)}
                  />
                </label>
                <Text as="p" size="2" color="gray">
                  Published proposals keep their current branding until you explicitly republish
                  them.
                </Text>
              </Flex>
            </fieldset>
          </Reset>
        </Card>
        <Card size="2">
          <Reset>
            <fieldset disabled={busy} style={bareFieldset}>
              <Reset>
                <legend>
                  <Heading as="h3" size="3" mb="3">
                    Agency workflow
                  </Heading>
                </legend>
              </Reset>
              <Flex direction="column" gap="3">
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    PNR format preference
                  </Text>
                  <Select.Root
                    size="3"
                    value={draft.gds}
                    onValueChange={(value) => update('gds', value as StudioAgency['gds'])}
                  >
                    <Select.Trigger aria-label="PNR format preference" />
                    <Select.Content>
                      <Select.Item value="auto">Detect from supplied text</Select.Item>
                      <Select.Item value="amadeus">Amadeus</Select.Item>
                      <Select.Item value="sabre">Sabre</Select.Item>
                      <Select.Item value="galileo">Galileo</Select.Item>
                      <Select.Item value="other">Other</Select.Item>
                    </Select.Content>
                  </Select.Root>
                </label>
                <Text as="p" size="2" color="gray">
                  This preference helps interpret imported records. It does not connect to or
                  retrieve bookings from a GDS.
                </Text>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Additional qualifying questions · one per line
                  </Text>
                  <TextArea
                    size="3"
                    value={draft.customQuestions.join('\n')}
                    onChange={(event) => update('customQuestions', event.target.value.split('\n'))}
                    placeholder="Which frequent-flyer programme does the client use?"
                  />
                </label>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Internal payment cost allowance (%)
                  </Text>
                  <TextField.Root
                    size="3"
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={draft.paymentCostPercent}
                    onChange={(event) => update('paymentCostPercent', Number(event.target.value))}
                  />
                </label>
                <Text as="p" size="2" color="gray">
                  Used only in your internal estimate. It does not add a client fee or change
                  published prices.
                </Text>
              </Flex>
            </fieldset>
          </Reset>
        </Card>
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Icon>
              <CircleAlert size={16} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {saved && (
          <Callout.Root color="green" role="status">
            <Callout.Icon>
              <CircleCheck size={16} />
            </Callout.Icon>
            <Callout.Text>Agency settings saved.</Callout.Text>
          </Callout.Root>
        )}
        <Box>
          <Button size="3" loading={busy} disabled={busy}>
            <Save size={15} />
            {busy ? 'Saving…' : 'Save agency settings'}
          </Button>
        </Box>
      </Flex>
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
    <Flex direction="column" gap="4">
      <Card size="3">
        <form onSubmit={(event) => void savePricing(event)}>
          <Reset>
            <fieldset disabled={busy} style={bareFieldset}>
              <Reset>
                <legend>
                  <Heading as="h3" size="4" mb="3">
                    Client pricing
                  </Heading>
                </legend>
              </Reset>
              <Flex direction="column" gap="3">
                <Grid columns={{ initial: '1', sm: '2' }} gap="3">
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Proposal format
                    </Text>
                    <Select.Root
                      size="3"
                      value={pricing.mode}
                      onValueChange={(value) =>
                        setPricing({ ...pricing, mode: value as StudioPricing['mode'] })
                      }
                    >
                      <Select.Trigger aria-label="Proposal format" />
                      <Select.Content>
                        <Select.Item value="itemised">Show itemised prices</Select.Item>
                        <Select.Item value="package">Show one package price</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </label>
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Package / working currency
                    </Text>
                    <TextField.Root
                      size="3"
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
                      <Text as="div" size="2" weight="medium" mb="1">
                        Total package price
                      </Text>
                      <TextField.Root
                        size="3"
                        type="number"
                        min={0}
                        step={0.01}
                        required
                        value={pricing.packagePrice ?? ''}
                        onChange={(event) =>
                          setPricing({
                            ...pricing,
                            packagePrice:
                              event.target.value === '' ? null : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                </Grid>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Client-facing pricing notes
                  </Text>
                  <TextArea
                    size="3"
                    value={pricing.notes}
                    maxLength={2000}
                    onChange={(event) => setPricing({ ...pricing, notes: event.target.value })}
                    placeholder="Explain inclusions, exclusions and what needs reconfirmation."
                  />
                </label>
                <Text as="p" size="2" color="gray">
                  {pricing.mode === 'package'
                    ? 'Your explicit package price is shown to the client. Individual prices and supplier costs stay private.'
                    : 'Item totals stay in their original currencies. Test rates are labelled and excluded; estimates remain labelled.'}
                </Text>
                <Reset>
                  <details>
                    <Reset>
                      <summary style={{ cursor: 'pointer' }}>
                        <Text size="2" weight="medium">
                          Internal commercial estimate · never shown to clients
                        </Text>
                      </summary>
                    </Reset>
                    <Flex direction="column" gap="3" mt="3">
                      <Badge color="gray" variant="soft" size="2">
                        <Lock size={12} aria-hidden="true" /> Internal only
                      </Badge>
                      <label>
                        <Text as="div" size="2" weight="medium" mb="1">
                          Markup on recorded costs (%)
                        </Text>
                        <TextField.Root
                          size="3"
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
                      <Text as="p" size="2" color="gray">
                        Recorded costs in {pricing.currency}:{' '}
                        {studioProposalMoney(estimatedCosts, pricing.currency)}
                        {missingCosts
                          ? ` · ${missingCosts} item(s) have missing costs or another currency.`
                          : ''}
                      </Text>
                      <Text as="p" size="2" color="gray">
                        Markup allowance: {studioProposalMoney(suggestedMarkup, pricing.currency)}.
                        Payment cost allowance:{' '}
                        {studioProposalMoney(paymentAllowance, pricing.currency)} (
                        {agency.paymentCostPercent}% of the entered package price).
                      </Text>
                      <Text as="p" size="2" color="gray">
                        Illustrative costs plus allowances:{' '}
                        {studioProposalMoney(
                          estimatedCosts + suggestedMarkup + paymentAllowance,
                          pricing.currency,
                        )}
                        . This is an internal calculation, not a complete trip cost or a client fee.
                        Enter any chosen package price yourself.
                      </Text>
                    </Flex>
                  </details>
                </Reset>
                <Box>
                  <Button size="3" variant="soft" loading={busy} disabled={busy || !dirty}>
                    <Save size={15} />
                    Save pricing
                  </Button>
                </Box>
              </Flex>
            </fieldset>
          </Reset>
        </form>
      </Card>
      <Card size="2">
        <Reset>
          <details>
            <Reset>
              <summary style={{ cursor: 'pointer' }}>
                <Text size="2" weight="medium">
                  Agency branding and workflow settings
                </Text>
              </summary>
            </Reset>
            <Box mt="3">
              <AgencySettings agency={agency} onAgencyUpdate={onAgencyUpdate} onError={onError} />
            </Box>
          </details>
        </Reset>
      </Card>
      <Card size="3">
        <Reset>
          <fieldset style={bareFieldset}>
            <Reset>
              <legend>
                <Heading as="h3" size="4" mb="3">
                  Review and share
                </Heading>
              </legend>
            </Reset>
            <Flex direction="column" gap="3">
              <Callout.Root color="gray" size="1">
                <Callout.Icon>
                  <ShieldCheck size={16} />
                </Callout.Icon>
                <Callout.Text>
                  Only selected items, recommendations and client-facing descriptions are included.
                  Private context, imported documents, chat, booking references and internal costs
                  are excluded. Review the preview before publishing.
                </Callout.Text>
              </Callout.Root>
              {!workspace.structureAccepted && (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>Accept the trip structure before publishing.</Callout.Text>
                </Callout.Root>
              )}
              {workspace.items.some((item) => item.included && item.needsReview) && (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>Review the included imported items before publishing.</Callout.Text>
                </Callout.Root>
              )}
              {dirty && (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>
                    Save your pricing changes before previewing or publishing.
                  </Callout.Text>
                </Callout.Root>
              )}
              <Flex gap="2" wrap="wrap">
                <Button
                  type="button"
                  size="3"
                  variant="soft"
                  disabled={busy || dirty}
                  onClick={() => void showPreview()}
                >
                  <Eye size={15} />
                  Preview client proposal
                </Button>
                <Button asChild size="3" variant="soft">
                  <a
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
                </Button>
                <Button
                  type="button"
                  size="3"
                  loading={busy}
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
                </Button>
              </Flex>
              {workspace.proposal && (
                <Card size="2" variant="surface">
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <Badge color="green" variant="soft" size="2">
                        <CircleCheck size={12} aria-hidden="true" /> Published
                      </Badge>
                      <Text size="2" weight="bold">
                        Client link
                      </Text>
                    </Flex>
                    <Text as="p" size="2" style={{ overflowWrap: 'anywhere' }}>
                      <a href={currentUrl} target="_blank" rel="noopener noreferrer">
                        {currentUrl}
                      </a>
                    </Text>
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(currentUrl)
                            .then(() => setNotice('Client link copied.'))
                            .catch(() => setError('Copy the link displayed above.'))
                        }
                      >
                        <Copy size={14} />
                        Copy link
                      </Button>
                      <Button asChild size="3" variant="soft">
                        <a href={`/api/studio/proposals/${workspace.proposal.token}/pdf`} download>
                          <Download size={14} />
                          Published PDF
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="red"
                        disabled={busy}
                        onClick={() => void revoke()}
                      >
                        Revoke link
                      </Button>
                    </Flex>
                    <Text as="p" size="2" color="gray">
                      Republishing replaces this link with a new snapshot and revokes the previous
                      link. Prices require reconfirmation after the agency validity period; the
                      viewer remains available.
                    </Text>
                  </Flex>
                </Card>
              )}
            </Flex>
          </fieldset>
        </Reset>
      </Card>
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Icon>
            <CircleAlert size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {notice && (
        <Callout.Root color="green" role="status">
          <Callout.Icon>
            <CircleCheck size={16} />
          </Callout.Icon>
          <Callout.Text>{notice}</Callout.Text>
        </Callout.Root>
      )}
      {preview && (
        <Card size="3">
          <Flex align="center" gap="2" mb="3">
            <Badge color="blue" variant="soft" size="2">
              <Eye size={12} aria-hidden="true" /> Preview
            </Badge>
            <Text size="2" color="gray">
              This is what the client sees.
            </Text>
          </Flex>
          <Separator size="4" mb="3" />
          <StudioProposalDocument proposal={preview} preview />
        </Card>
      )}
    </Flex>
  );
}

export default StudioProposalControls;
export { AgencySettings as StudioAgencySettings };
