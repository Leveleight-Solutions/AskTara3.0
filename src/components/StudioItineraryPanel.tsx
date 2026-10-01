import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Heading,
  IconButton,
  Select,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import type { StudioWorkspace } from '../../shared/studio';
import type {
  StudioItinerary,
  StudioItineraryActivity,
  StudioItineraryDay,
} from '../../shared/studio-itinerary';
import {
  moveStudioItineraryEntry,
  STUDIO_ITINERARY_MAX_ACTIVITIES,
  STUDIO_ITINERARY_MAX_DAYS,
  STUDIO_MANUAL_ITINERARY_MAX_DAYS,
  studioItinerarySchema,
} from '../../shared/studio-itinerary';
import { readableDate } from '../api';
import { useApp } from '../context';

/** The saved day plan is shared by the working canvas and the public proposal. */
export function StudioItineraryContent({
  itinerary,
  dayHeading = 'h3',
  accent,
}: {
  itinerary: StudioItinerary;
  dayHeading?: 'h3' | 'h4';
  accent?: string;
}) {
  return (
    <Flex direction="column" gap="4">
      <Flex asChild direction="column" gap="4">
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {itinerary.days.map((day) => (
            <Card asChild key={day.day} size="3" variant="surface">
              <li>
                <Flex align="center" gap="2" wrap="wrap" mb="2">
                  <Badge size="2" color="gray">
                    Day {day.day}
                  </Badge>
                  {day.date && (
                    <Text size="2" color="gray">
                      {readableDate(day.date)}
                    </Text>
                  )}
                </Flex>
                <Heading as={dayHeading} size="5" style={{ color: accent }}>
                  {day.title}
                </Heading>
                {day.summary && (
                  <Text as="p" size="2" color="gray" mt="2">
                    {day.summary}
                  </Text>
                )}
                <Flex direction="column" gap="4" mt="4">
                  {day.activities.map((activity, index) => (
                    <Box key={`${activity.period}:${index}`}>
                      <Text as="div" size="1" color="gray" weight="medium" mb="1">
                        {activity.period === 'flexible'
                          ? 'At your own pace'
                          : activity.period[0].toUpperCase() + activity.period.slice(1)}
                      </Text>
                      <Text as="div" size="3" weight="bold">
                        {activity.title}
                      </Text>
                      <Text
                        as="p"
                        size="2"
                        mt="1"
                        style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                      >
                        {activity.description}
                      </Text>
                      {activity.sources.length > 0 && (
                        <Flex gap="3" wrap="wrap" mt="2">
                          {activity.sources
                            .filter((source) => /^https?:\/\//i.test(source.url))
                            .map((source, sourceIndex) => (
                              <Text asChild key={`${source.url}:${sourceIndex}`} size="1">
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: accent || 'var(--accent-11)',
                                    overflowWrap: 'anywhere',
                                  }}
                                >
                                  {source.label}
                                </a>
                              </Text>
                            ))}
                        </Flex>
                      )}
                    </Box>
                  ))}
                </Flex>
              </li>
            </Card>
          ))}
        </ol>
      </Flex>
      {itinerary.notes.length > 0 && (
        <Card size="2" variant="surface">
          <Text as="div" size="2" weight="medium">
            Planning notes
          </Text>
          <ul
            style={{
              marginBottom: 0,
              paddingLeft: 'var(--space-4)',
              fontSize: 'var(--font-size-2)',
            }}
          >
            {itinerary.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </Card>
      )}
    </Flex>
  );
}

export function StudioItineraryPanel({
  workspace,
  disabled,
  building,
  onGenerate,
  onRefine,
  onReview,
  onSave,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  building: boolean;
  onGenerate: (instructions: string) => Promise<boolean | undefined>;
  onRefine: () => void;
  onReview: () => void;
  onSave: (itinerary: StudioItinerary | null) => Promise<boolean | undefined>;
}) {
  const { integrations } = useApp();
  const [instructions, setInstructions] = useState('');
  const [editing, setEditing] = useState(false);
  const [foodPreference, setFoodPreference] = useState('');
  useEffect(() => setEditing(false), [workspace.id]);
  const nightsKnown =
    workspace.stops.length > 0 && workspace.stops.every((stop) => stop.nights !== null);
  // Fixed arrivals can leave unallocated calendar days between otherwise short stays.
  let departure = Date.parse(workspace.brief.startDate || workspace.stops[0]?.arrivalDate || '');
  let days = 1;
  for (const [index, stop] of workspace.stops.entries()) {
    const arrival =
      stop.arrivalFixed && stop.arrivalDate ? Date.parse(stop.arrivalDate) : departure;
    if (index > 0 && Number.isFinite(arrival) && Number.isFinite(departure)) {
      days += Math.max(0, (arrival - departure) / 86_400_000);
    }
    days += stop.nights || 0;
    departure = arrival + (stop.nights || 0) * 86_400_000;
  }
  const tooLong = nightsKnown && days > STUDIO_ITINERARY_MAX_DAYS;
  const ready = integrations.ai && workspace.structureAccepted && nightsKnown && !tooLong;
  return (
    <Flex asChild direction="column" gap="4">
      <section aria-label="Day-by-day itinerary">
        <Box>
          <Heading as="h2" size="6">
            Your day-by-day itinerary
          </Heading>
          <Text as="p" size="2" color="gray" mt="2">
            Add your own daily recommendations, arrange activities, and edit every detail before
            sharing the proposal. AI suggestions are optional.
          </Text>
        </Box>
        {!nightsKnown && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              Set the number of nights in every destination before generating AI suggestions. You
              can start a manual plan now.
            </Callout.Text>
          </Callout.Root>
        )}
        {tooLong && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              Generate an itinerary of up to {STUDIO_ITINERARY_MAX_DAYS} days with AI. Manual daily
              plans support up to {STUDIO_MANUAL_ITINERARY_MAX_DAYS} days.
            </Callout.Text>
          </Callout.Root>
        )}
        {!integrations.ai && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              AI planning needs to be connected to generate a day-by-day itinerary. Manual planning
              is available now.
            </Callout.Text>
          </Callout.Root>
        )}
        <Box>
          <Button type="button" size="3" disabled={disabled} onClick={() => setEditing(true)}>
            <Plus size={16} />
            {workspace.itinerary ? 'Edit daily plan' : 'Start daily plan manually'}
          </Button>
        </Box>
        {editing && (
          <StudioItineraryEditor
            key={`${workspace.id}:${workspace.itinerary?.generatedAt || 'manual'}`}
            workspace={workspace}
            disabled={disabled}
            onCancel={() => setEditing(false)}
            onSave={async (itinerary) => {
              const saved = await onSave(itinerary);
              if (saved) setEditing(false);
              return saved;
            }}
          />
        )}
        <Card size="2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled || !ready) return;
              void onGenerate(
                [
                  instructions.trim(),
                  foodPreference.trim() ? `Food preference: ${foodPreference.trim()}` : '',
                ]
                  .filter(Boolean)
                  .join('\n')
                  .slice(0, 4000),
              ).then((saved) => {
                if (saved) setInstructions('');
              });
            }}
          >
            <Flex direction="column" gap="3">
              <Text as="div" size="2" weight="medium">
                Optional AI activity suggestions
              </Text>
              <Text size="1" color="gray">
                Uses the trip's budget and interests. Add food preferences below if helpful.
              </Text>
              <label>
                <Text as="div" size="2" mb="1">
                  Food preference · optional
                </Text>
                <TextField.Root
                  value={foodPreference}
                  onChange={(event) => setFoodPreference(event.target.value)}
                  maxLength={500}
                  disabled={disabled}
                  placeholder="Vegetarian, local food, family favourites…"
                />
              </label>
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Itinerary instructions · optional
                </Text>
                <TextArea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={4000}
                  rows={3}
                  disabled={disabled}
                  placeholder="A relaxed pace, more museums, time for shopping…"
                />
              </label>
              <Flex gap="3" wrap="wrap">
                <Button size="3" disabled={disabled || !ready} loading={building}>
                  <Sparkles size={16} />
                  {workspace.itinerary ? 'Regenerate itinerary' : 'Build day-by-day itinerary'}
                </Button>
                {workspace.itinerary && (
                  <Button
                    type="button"
                    size="3"
                    variant="soft"
                    disabled={disabled}
                    onClick={onRefine}
                  >
                    <MessageCircle size={16} />
                    Refine in chat
                  </Button>
                )}
              </Flex>
            </Flex>
          </form>
        </Card>
        {workspace.itinerary && (
          <>
            <StudioItineraryContent itinerary={workspace.itinerary} />
            <Box>
              <Button type="button" size="3" disabled={disabled} onClick={onReview}>
                Review proposal <ArrowRight size={16} />
              </Button>
            </Box>
          </>
        )}
      </section>
    </Flex>
  );
}

const addDays = (date: string, count: number) => {
  const value = Date.parse(date);
  return Number.isFinite(value)
    ? new Date(value + count * 86_400_000).toISOString().slice(0, 10)
    : '';
};

/** Blank, manual rows follow known route dates and leave recommendations to the agent. */
function manualPlan(workspace: StudioWorkspace): StudioItinerary {
  const days: StudioItineraryDay[] = [];
  let nextDate = workspace.brief.startDate || workspace.stops[0]?.arrivalDate || '';
  const append = (date: string, stopIds: string[], title: string) => {
    if (days.length < STUDIO_MANUAL_ITINERARY_MAX_DAYS)
      days.push({ day: days.length + 1, date, stopIds, title, summary: '', activities: [] });
  };
  for (const stop of workspace.stops) {
    const arrival = stop.arrivalDate || nextDate;
    const previous = days.at(-1);
    if (previous && arrival && previous.date && arrival > previous.date) {
      for (
        let gap = addDays(previous.date, 1);
        gap && gap < arrival && days.length < STUDIO_MANUAL_ITINERARY_MAX_DAYS;
        gap = addDays(gap, 1)
      )
        append(gap, [], 'Travel day');
      append(arrival, [stop.id], stop.name);
    } else if (previous) {
      previous.stopIds.push(stop.id);
      previous.title = `${previous.title} → ${stop.name}`.slice(0, 160);
    } else append(arrival, [stop.id], stop.name);
    for (
      let night = 1;
      night <= (stop.nights || 0) && days.length < STUDIO_MANUAL_ITINERARY_MAX_DAYS;
      night++
    )
      append(addDays(arrival, night), [stop.id], stop.name);
    nextDate = addDays(arrival, stop.nights || 0);
  }
  if (!days.length) append(workspace.brief.startDate, [], 'Day 1');
  return { generatedAt: new Date().toISOString(), days, notes: [] };
}

function StudioItineraryEditor({
  workspace,
  disabled,
  onSave,
  onCancel,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (itinerary: StudioItinerary | null) => Promise<boolean | undefined>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<StudioItinerary>(() =>
    structuredClone(workspace.itinerary || manualPlan(workspace)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const blocked = disabled || saving;
  const updateDay = (index: number, patch: Partial<StudioItineraryDay>) =>
    setDraft((current) => ({
      ...current,
      days: current.days.map((day, i) => (i === index ? { ...day, ...patch } : day)),
    }));
  const updateActivity = (
    dayIndex: number,
    activityIndex: number,
    patch: Partial<StudioItineraryActivity>,
  ) => {
    const day = draft.days[dayIndex];
    updateDay(dayIndex, {
      activities: day.activities.map((activity, index) =>
        index === activityIndex ? { ...activity, ...patch, sources: [] } : activity,
      ),
    });
  };
  const setDays = (days: StudioItineraryDay[]) =>
    setDraft((current) => ({
      ...current,
      days: days.map((day, index) => ({ ...day, day: index + 1 })),
    }));
  return (
    <Card size="3">
      <form
        aria-label="Edit daily itinerary"
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          const next = {
            ...draft,
            notes: draft.notes.map((note) => note.trim()).filter(Boolean),
            generatedAt: new Date().toISOString(),
          };
          const parsed = studioItinerarySchema.safeParse(next);
          if (draft.days.length && !parsed.success) {
            setError(parsed.error.issues[0]?.message || 'Check the daily plan fields.');
            return;
          }
          setSaving(true);
          setError('');
          void onSave(draft.days.length ? next : null)
            .catch((failure: unknown) =>
              setError(
                failure instanceof Error ? failure.message : 'The daily plan could not be saved.',
              ),
            )
            .finally(() => setSaving(false));
        }}
      >
        <Flex direction="column" gap="4">
          <Heading as="h3" size="4">
            Edit daily plan
          </Heading>
          <Text size="1" color="gray">
            Edited activity text is treated as your recommendation. Existing source links are
            removed when that text changes.
          </Text>
          {draft.days.map((day, dayIndex) => (
            <Card key={dayIndex} size="2">
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between" gap="2" wrap="wrap">
                  <Badge>Day {day.day}</Badge>
                  <Flex gap="2">
                    <IconButton
                      type="button"
                      variant="soft"
                      aria-label={`Move day ${day.day} up`}
                      disabled={blocked || dayIndex === 0}
                      onClick={() => setDays(moveStudioItineraryEntry(draft.days, dayIndex, -1))}
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="soft"
                      aria-label={`Move day ${day.day} down`}
                      disabled={blocked || dayIndex === draft.days.length - 1}
                      onClick={() => setDays(moveStudioItineraryEntry(draft.days, dayIndex, 1))}
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="soft"
                      color="red"
                      aria-label={`Delete day ${day.day}`}
                      disabled={blocked}
                      onClick={() => setDays(draft.days.filter((_, index) => index !== dayIndex))}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Flex>
                </Flex>
                <Flex gap="3" wrap="wrap">
                  <label style={{ flex: '1 1 220px' }}>
                    <Text as="div" size="2" mb="1">
                      Day {day.day} title
                    </Text>
                    <TextField.Root
                      value={day.title}
                      maxLength={160}
                      disabled={blocked}
                      onChange={(event) => updateDay(dayIndex, { title: event.target.value })}
                    />
                  </label>
                  <label>
                    <Text as="div" size="2" mb="1">
                      Day {day.day} date
                    </Text>
                    <TextField.Root
                      type="date"
                      value={day.date}
                      disabled={blocked}
                      onChange={(event) => updateDay(dayIndex, { date: event.target.value })}
                    />
                  </label>
                </Flex>
                <label>
                  <Text as="div" size="2" mb="1">
                    Day {day.day} summary
                  </Text>
                  <TextArea
                    value={day.summary}
                    maxLength={600}
                    disabled={blocked}
                    rows={2}
                    onChange={(event) => updateDay(dayIndex, { summary: event.target.value })}
                  />
                </label>
                {workspace.stops.length > 0 && (
                  <Flex gap="3" wrap="wrap" role="group" aria-label={`Day ${day.day} destinations`}>
                    {workspace.stops.map((stop) => (
                      <Text as="label" size="2" key={stop.id}>
                        <Flex gap="2" align="center">
                          <Checkbox
                            checked={day.stopIds.includes(stop.id)}
                            disabled={
                              blocked ||
                              (!day.stopIds.includes(stop.id) && day.stopIds.length >= 20)
                            }
                            onCheckedChange={(checked) =>
                              updateDay(dayIndex, {
                                stopIds: checked
                                  ? [...day.stopIds, stop.id]
                                  : day.stopIds.filter((id) => id !== stop.id),
                              })
                            }
                          />
                          {stop.name}
                        </Flex>
                      </Text>
                    ))}
                  </Flex>
                )}
                {day.activities.map((activity, activityIndex) => (
                  <Box
                    key={activityIndex}
                    p="3"
                    style={{ background: 'var(--gray-a2)', borderRadius: 'var(--radius-2)' }}
                  >
                    <Flex direction="column" gap="3">
                      <Flex justify="between" align="center" gap="2" wrap="wrap">
                        <Text size="2" weight="medium">
                          Activity {activityIndex + 1}
                        </Text>
                        <Flex gap="2">
                          <IconButton
                            type="button"
                            variant="soft"
                            aria-label={`Move day ${day.day} activity ${activityIndex + 1} up`}
                            disabled={blocked || activityIndex === 0}
                            onClick={() =>
                              updateDay(dayIndex, {
                                activities: moveStudioItineraryEntry(
                                  day.activities,
                                  activityIndex,
                                  -1,
                                ),
                              })
                            }
                          >
                            <ArrowUp size={14} />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="soft"
                            aria-label={`Move day ${day.day} activity ${activityIndex + 1} down`}
                            disabled={blocked || activityIndex === day.activities.length - 1}
                            onClick={() =>
                              updateDay(dayIndex, {
                                activities: moveStudioItineraryEntry(
                                  day.activities,
                                  activityIndex,
                                  1,
                                ),
                              })
                            }
                          >
                            <ArrowDown size={14} />
                          </IconButton>
                          <IconButton
                            type="button"
                            variant="soft"
                            color="red"
                            aria-label={`Delete day ${day.day} activity ${activityIndex + 1}`}
                            disabled={blocked}
                            onClick={() =>
                              updateDay(dayIndex, {
                                activities: day.activities.filter(
                                  (_, index) => index !== activityIndex,
                                ),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </Flex>
                      </Flex>
                      <Select.Root
                        value={activity.period}
                        disabled={blocked}
                        onValueChange={(period) =>
                          updateActivity(dayIndex, activityIndex, {
                            period: period as StudioItineraryActivity['period'],
                          })
                        }
                      >
                        <Select.Trigger
                          aria-label={`Day ${day.day} activity ${activityIndex + 1} time`}
                        />
                        <Select.Content>
                          <Select.Item value="morning">Morning</Select.Item>
                          <Select.Item value="afternoon">Afternoon</Select.Item>
                          <Select.Item value="evening">Evening</Select.Item>
                          <Select.Item value="flexible">Flexible</Select.Item>
                        </Select.Content>
                      </Select.Root>
                      <label>
                        <Text as="div" size="2" mb="1">
                          Day {day.day} activity {activityIndex + 1} title
                        </Text>
                        <TextField.Root
                          value={activity.title}
                          maxLength={200}
                          disabled={blocked}
                          onChange={(event) =>
                            updateActivity(dayIndex, activityIndex, { title: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        <Text as="div" size="2" mb="1">
                          Day {day.day} activity {activityIndex + 1} details
                        </Text>
                        <TextArea
                          value={activity.description}
                          maxLength={1200}
                          rows={3}
                          disabled={blocked}
                          onChange={(event) =>
                            updateActivity(dayIndex, activityIndex, {
                              description: event.target.value,
                            })
                          }
                        />
                      </label>
                    </Flex>
                  </Box>
                ))}
                <Box>
                  <Button
                    type="button"
                    variant="soft"
                    disabled={blocked || day.activities.length >= STUDIO_ITINERARY_MAX_ACTIVITIES}
                    onClick={() =>
                      updateDay(dayIndex, {
                        activities: [
                          ...day.activities,
                          {
                            period: 'flexible',
                            title: 'New activity',
                            description: '',
                            sources: [],
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} />
                    Add activity to day {day.day}
                  </Button>
                </Box>
              </Flex>
            </Card>
          ))}
          {!draft.days.length && (
            <Text size="2" color="gray">
              All days removed. Save to clear this daily plan, or add a new day.
            </Text>
          )}
          <Box>
            <Button
              type="button"
              variant="soft"
              disabled={blocked || draft.days.length >= STUDIO_MANUAL_ITINERARY_MAX_DAYS}
              onClick={() =>
                setDays([
                  ...draft.days,
                  {
                    day: draft.days.length + 1,
                    date: addDays(draft.days.at(-1)?.date || '', 1),
                    stopIds: [...(draft.days.at(-1)?.stopIds || [])],
                    title: `Day ${draft.days.length + 1}`,
                    summary: '',
                    activities: [],
                  },
                ])
              }
            >
              <Plus size={14} />
              Add day
            </Button>
          </Box>
          <label>
            <Text as="div" size="2" mb="1">
              Planning notes · one per line
            </Text>
            <TextArea
              value={draft.notes.join('\n')}
              rows={3}
              maxLength={10019}
              disabled={blocked}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  notes: event.target.value.split('\n'),
                }))
              }
            />
          </label>
          {error && (
            <Callout.Root color="red">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" wrap="wrap">
            <Button type="submit" loading={saving} disabled={blocked}>
              Save daily plan
            </Button>
            <Button type="button" variant="soft" disabled={blocked} onClick={onCancel}>
              Cancel edits
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}
