import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Ship, Trash2 } from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  IconButton,
  Select,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import type { StudioImportInput } from '../../shared/studio-imports';
import { STUDIO_IMPORT_MAX_TEXT } from '../../shared/studio-imports';
import {
  studioCruiseDraftSchema,
  STUDIO_CRUISE_MAX_FARE,
  type StudioCruiseDay,
  type StudioCruiseDraft,
} from '../../shared/studio-cruise';
import {
  moveStudioItineraryEntry,
  STUDIO_MANUAL_ITINERARY_MAX_DAYS,
} from '../../shared/studio-itinerary';

export function StudioCruiseImport({
  disabled,
  initialDraft,
  onExtract,
  onApply,
}: {
  disabled: boolean;
  initialDraft?: StudioCruiseDraft | null;
  onExtract: (input: StudioImportInput) => Promise<StudioCruiseDraft | undefined>;
  onApply: (draft: StudioCruiseDraft) => Promise<boolean | undefined>;
}) {
  const [draft, setDraft] = useState<StudioCruiseDraft | null>(initialDraft || null);
  const [sourceType, setSourceType] = useState<'url' | 'text'>('url');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(initialDraft || null);
    setSaved(false);
    setError('');
    // Workspace revisions can refresh the same saved cruise while a new preview is open.
    // Only a deliberate change of selection should replace the agent's local review.
  }, [initialDraft?.id]);
  const blocked = disabled || busy;
  const change = (patch: Partial<StudioCruiseDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : null));
    setSaved(false);
  };
  const updateDay = (index: number, patch: Partial<StudioCruiseDay>) => {
    if (draft)
      change({ days: draft.days.map((day, i) => (i === index ? { ...day, ...patch } : day)) });
  };
  const reorder = (days: StudioCruiseDay[]) => {
    if (!draft) return;
    const selected = draft.disembarkAfterDay ? draft.days[draft.disembarkAfterDay - 1] : null;
    const selection = selected ? days.indexOf(selected) : -1;
    change({
      days: days.map((day, index) => ({ ...day, day: index + 1 })),
      disembarkAfterDay: selection >= 0 ? selection + 1 : null,
    });
  };
  return (
    <Card size="3">
      <Flex asChild direction="column" gap="4">
        <section aria-label="Cruise itinerary import">
          <Box>
            <Heading as="h3" size="4">
              <Ship size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Cruise itinerary
            </Heading>
            <Text as="p" size="2" color="gray" mt="2">
              Import the cruise line's schedule, review every day, then add the travelled segment to
              the plan.
            </Text>
          </Box>
          <Flex gap="2" wrap="wrap">
            <Button
              type="button"
              variant={sourceType === 'url' ? 'solid' : 'soft'}
              disabled={blocked}
              onClick={() => {
                setSourceType('url');
                setSource('');
              }}
            >
              Cruise itinerary link
            </Button>
            <Button
              type="button"
              variant={sourceType === 'text' ? 'solid' : 'soft'}
              disabled={blocked}
              onClick={() => {
                setSourceType('text');
                setSource('');
              }}
            >
              Paste cruise text
            </Button>
          </Flex>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              {sourceType === 'url' ? 'Cruise line itinerary URL' : 'Cruise source text'}
            </Text>
            {sourceType === 'url' ? (
              <TextField.Root
                value={source}
                onChange={(event) => setSource(event.target.value)}
                type="url"
                maxLength={2048}
                disabled={blocked}
                placeholder="https://cruiseline.com/itinerary"
              />
            ) : (
              <TextArea
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={STUDIO_IMPORT_MAX_TEXT}
                rows={6}
                disabled={blocked}
                placeholder="Paste the day-by-day schedule, including ports, dates and times…"
              />
            )}
          </label>
          <Flex gap="2" wrap="wrap">
            <Button
              type="button"
              loading={busy}
              disabled={blocked || !source.trim()}
              onClick={() => {
                setBusy(true);
                setError('');
                setSaved(false);
                const input: StudioImportInput =
                  sourceType === 'url'
                    ? { kind: 'url', name: 'Cruise itinerary', url: source.trim() }
                    : { kind: 'text', name: 'Cruise itinerary', text: source.trim() };
                void onExtract(input)
                  .then((result) => {
                    if (result) setDraft(result);
                  })
                  .catch((failure: unknown) =>
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : 'Cruise extraction failed. Paste the source text and try again.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Preview cruise days
            </Button>
            <Button
              type="button"
              variant="soft"
              disabled={blocked}
              onClick={() => {
                setError('');
                setSaved(false);
                setDraft({
                  id: crypto.randomUUID(),
                  name: 'Cruise itinerary',
                  ship: '',
                  sourceName: 'Agent entry',
                  sourceUrl: '',
                  extractedAt: new Date().toISOString(),
                  currency: 'USD',
                  fullFare: null,
                  disembarkAfterDay: null,
                  onwardTransport: 'undecided',
                  returnTransport: 'undecided',
                  days: [
                    {
                      day: 1,
                      date: '',
                      port: 'Embarkation port',
                      arrival: '',
                      departure: '',
                      details: '',
                    },
                  ],
                  warnings: [],
                });
              }}
            >
              Enter cruise manually
            </Button>
          </Flex>
          <Text size="1" color="gray">
            If a link is unreadable, paste accessible itinerary text above. Missing ports and dates
            are never filled in automatically.
          </Text>
          {error && (
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          {draft && (
            <>
              <Heading as="h4" size="3">
                Review and edit cruise
              </Heading>
              {draft.warnings.map((warning, index) => (
                <Text size="1" color="gray" key={index}>
                  {warning}
                </Text>
              ))}
              {draft.sourceUrl && /^https:\/\//i.test(draft.sourceUrl) && (
                <Text asChild size="1">
                  <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Open imported source
                  </a>
                </Text>
              )}
              <Flex gap="3" wrap="wrap">
                <label style={{ flex: '1 1 220px' }}>
                  <Text as="div" size="2" mb="1">
                    Cruise name
                  </Text>
                  <TextField.Root
                    value={draft.name}
                    maxLength={160}
                    disabled={blocked}
                    onChange={(event) => change({ name: event.target.value })}
                  />
                </label>
                <label style={{ flex: '1 1 220px' }}>
                  <Text as="div" size="2" mb="1">
                    Ship
                  </Text>
                  <TextField.Root
                    value={draft.ship}
                    maxLength={160}
                    disabled={blocked}
                    onChange={(event) => change({ ship: event.target.value })}
                  />
                </label>
              </Flex>
              <Flex gap="3" wrap="wrap">
                <label>
                  <Text as="div" size="2" mb="1">
                    Full cruise fare
                  </Text>
                  <TextField.Root
                    type="number"
                    min="0"
                    max={STUDIO_CRUISE_MAX_FARE}
                    step="0.01"
                    value={draft.fullFare ?? ''}
                    disabled={blocked}
                    onChange={(event) =>
                      change({
                        fullFare: event.target.value === '' ? null : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  <Text as="div" size="2" mb="1">
                    Cruise fare currency
                  </Text>
                  <TextField.Root
                    value={draft.currency}
                    maxLength={3}
                    disabled={blocked}
                    onChange={(event) => change({ currency: event.target.value.toUpperCase() })}
                  />
                </label>
              </Flex>
              <Callout.Root color="amber" size="1">
                <Callout.Text>
                  The full cruise fare stays payable if the client leaves early. Removing days does
                  not calculate a partial refund. Confirm early disembarkation with the cruise line.
                </Callout.Text>
              </Callout.Root>
              {draft.days.map((day, index) => (
                <Card key={index} size="2">
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between" gap="2" wrap="wrap">
                      <Badge
                        color={
                          draft.disembarkAfterDay && day.day > draft.disembarkAfterDay
                            ? 'gray'
                            : undefined
                        }
                      >
                        Cruise day {day.day}
                        {draft.disembarkAfterDay && day.day > draft.disembarkAfterDay
                          ? ' · omitted from plan'
                          : ''}
                      </Badge>
                      <Flex gap="2">
                        <IconButton
                          type="button"
                          variant="soft"
                          aria-label={`Move cruise day ${day.day} up`}
                          disabled={blocked || index === 0}
                          onClick={() => reorder(moveStudioItineraryEntry(draft.days, index, -1))}
                        >
                          <ArrowUp size={14} />
                        </IconButton>
                        <IconButton
                          type="button"
                          variant="soft"
                          aria-label={`Move cruise day ${day.day} down`}
                          disabled={blocked || index === draft.days.length - 1}
                          onClick={() => reorder(moveStudioItineraryEntry(draft.days, index, 1))}
                        >
                          <ArrowDown size={14} />
                        </IconButton>
                        <IconButton
                          type="button"
                          color="red"
                          variant="soft"
                          aria-label={`Delete cruise day ${day.day}`}
                          disabled={blocked || draft.days.length === 1}
                          onClick={() => reorder(draft.days.filter((_, i) => i !== index))}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </Flex>
                    </Flex>
                    <Flex gap="3" wrap="wrap">
                      <label style={{ flex: '1 1 200px' }}>
                        <Text as="div" size="2" mb="1">
                          Port or sea day · day {day.day}
                        </Text>
                        <TextField.Root
                          value={day.port}
                          maxLength={160}
                          disabled={blocked}
                          onChange={(event) => updateDay(index, { port: event.target.value })}
                        />
                      </label>
                      <label style={{ flex: '1 1 180px' }}>
                        <Text as="div" size="2" mb="1">
                          Cruise date · day {day.day}
                        </Text>
                        <TextField.Root
                          value={day.date}
                          maxLength={80}
                          placeholder="As stated, or YYYY-MM-DD"
                          disabled={blocked}
                          onChange={(event) => updateDay(index, { date: event.target.value })}
                        />
                      </label>
                    </Flex>
                    <Flex gap="3" wrap="wrap">
                      <label>
                        <Text as="div" size="2" mb="1">
                          Arrival · day {day.day}
                        </Text>
                        <TextField.Root
                          value={day.arrival}
                          maxLength={80}
                          disabled={blocked}
                          onChange={(event) => updateDay(index, { arrival: event.target.value })}
                        />
                      </label>
                      <label>
                        <Text as="div" size="2" mb="1">
                          Departure · day {day.day}
                        </Text>
                        <TextField.Root
                          value={day.departure}
                          maxLength={80}
                          disabled={blocked}
                          onChange={(event) => updateDay(index, { departure: event.target.value })}
                        />
                      </label>
                    </Flex>
                    <label>
                      <Text as="div" size="2" mb="1">
                        Cruise details · day {day.day}
                      </Text>
                      <TextArea
                        value={day.details}
                        maxLength={1200}
                        disabled={blocked}
                        rows={2}
                        onChange={(event) => updateDay(index, { details: event.target.value })}
                      />
                    </label>
                  </Flex>
                </Card>
              ))}
              <Box>
                <Button
                  type="button"
                  variant="soft"
                  disabled={blocked || draft.days.length >= STUDIO_MANUAL_ITINERARY_MAX_DAYS}
                  onClick={() =>
                    reorder([
                      ...draft.days,
                      {
                        day: draft.days.length + 1,
                        date: '',
                        port: 'New port',
                        arrival: '',
                        departure: '',
                        details: '',
                      },
                    ])
                  }
                >
                  <Plus size={14} />
                  Add cruise day
                </Button>
              </Box>
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Leave the cruise
                </Text>
                <Select.Root
                  value={draft.disembarkAfterDay?.toString() || 'full'}
                  disabled={blocked}
                  onValueChange={(value) =>
                    change({ disembarkAfterDay: value === 'full' ? null : Number(value) })
                  }
                >
                  <Select.Trigger aria-label="Leave the cruise" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="full">Follow the full cruise schedule</Select.Item>
                    {draft.days.map((day) => (
                      <Select.Item key={day.day} value={String(day.day)}>
                        Day {day.day}: {day.port}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <Flex gap="3" wrap="wrap">
                {(['onwardTransport', 'returnTransport'] as const).map((field) => (
                  <label key={field} style={{ flex: '1 1 180px' }}>
                    <Text as="div" size="2" mb="1">
                      {field === 'onwardTransport' ? 'Onward travel after cruise' : 'Return travel'}
                    </Text>
                    <Select.Root
                      value={draft[field]}
                      disabled={blocked}
                      onValueChange={(value) =>
                        change({ [field]: value as StudioCruiseDraft[typeof field] })
                      }
                    >
                      <Select.Trigger
                        aria-label={
                          field === 'onwardTransport'
                            ? 'Onward travel after cruise'
                            : 'Return travel'
                        }
                        style={{ width: '100%' }}
                      />
                      <Select.Content>
                        <Select.Item value="undecided">To decide</Select.Item>
                        <Select.Item value="flight">Flight</Select.Item>
                        <Select.Item value="cruise">Another cruise</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </label>
                ))}
              </Flex>
              <Text size="1" color="gray">
                Onward and return services can be completed in the itinerary's service editor.
                Applying adds a reviewed plan; it does not book the cruise or transport.
              </Text>
              <Box>
                <Button
                  type="button"
                  size="3"
                  loading={busy}
                  disabled={blocked}
                  onClick={() => {
                    const checked = studioCruiseDraftSchema.safeParse(draft);
                    if (!checked.success) {
                      setError(checked.error.issues[0]?.message || 'Check the cruise fields.');
                      return;
                    }
                    setBusy(true);
                    setError('');
                    void onApply(checked.data)
                      .then((result) => setSaved(Boolean(result)))
                      .catch((failure: unknown) =>
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : 'The cruise could not be saved.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Apply reviewed cruise
                </Button>
              </Box>
              {saved && (
                <Text color="green" size="2" role="status">
                  Reviewed cruise saved to the itinerary.
                </Text>
              )}
            </>
          )}
        </section>
      </Flex>
    </Card>
  );
}
