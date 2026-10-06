import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, Callout, Flex, IconButton, Text, TextArea, TextField } from '@radix-ui/themes';
import type { StudioWorkspace } from '../../shared/studio';
import type { StudioItineraryDay } from '../../shared/studio-itinerary';
import {
  moveStudioItineraryEntry,
  STUDIO_ITINERARY_MAX_ACTIVITIES,
} from '../../shared/studio-itinerary';
import { Modal } from './ui';

export function StudioDayEditorDialog({
  workspace,
  index,
  busy,
  onClose,
  onSave,
}: {
  workspace: StudioWorkspace;
  index: number;
  busy: boolean;
  onClose: () => void;
  onSave: (day: StudioItineraryDay) => Promise<void>;
}) {
  const original = useRef(JSON.stringify(workspace.itinerary));
  const [draft, setDraft] = useState(() => structuredClone(workspace.itinerary!.days[index]));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const changed = original.current !== JSON.stringify(workspace.itinerary);
  const blocked = busy || saving || changed;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setError('');
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`Edit day ${draft.day}`}
      onClose={() => {
        if (!saving) onClose();
      }}
      wide
    >
      <Text as="p" size="2" color="gray" mb="4">
        Adjust this day while keeping the rest of the trip. Source links remain only for unchanged
        researched descriptions.
      </Text>
      {changed && (
        <Callout.Root color="amber" mb="3">
          <Callout.Text>
            The saved day plan changed while you were editing. Your draft is kept here; reopen the
            latest day before saving.
          </Callout.Text>
        </Callout.Root>
      )}
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={blocked} style={{ border: 0, padding: 0, margin: 0 }}>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1">
                Day title
              </Text>
              <TextField.Root
                required
                value={draft.title}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1">
                Date
              </Text>
              <TextField.Root
                type="date"
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1">
                Day notes
              </Text>
              <TextArea
                aria-label="Day notes"
                value={draft.summary}
                maxLength={600}
                rows={2}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              />
            </label>
            {draft.activities.map((activity, at) => (
              <section className="studio-day-editor-row" aria-label={`Activity ${at + 1}`} key={at}>
                <Flex justify="between" gap="2" mb="2">
                  <select
                    aria-label={`Time of activity ${at + 1}`}
                    value={activity.period}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        activities: draft.activities.map((item, i) =>
                          i === at
                            ? { ...item, period: event.target.value as typeof item.period }
                            : item,
                        ),
                      })
                    }
                  >
                    {['morning', 'afternoon', 'evening', 'flexible'].map((period) => (
                      <option key={period} value={period}>
                        {period === 'flexible' ? 'At your own pace' : period}
                      </option>
                    ))}
                  </select>
                  <Flex gap="1">
                    <IconButton
                      aria-label={`Move activity ${at + 1} up`}
                      variant="ghost"
                      disabled={at === 0}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          activities: moveStudioItineraryEntry(draft.activities, at, -1),
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton
                      aria-label={`Move activity ${at + 1} down`}
                      variant="ghost"
                      disabled={at === draft.activities.length - 1}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          activities: moveStudioItineraryEntry(draft.activities, at, 1),
                        })
                      }
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                    <IconButton
                      aria-label={`Remove activity ${at + 1}`}
                      type="button"
                      variant="ghost"
                      color="red"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          activities: draft.activities.filter((_, i) => i !== at),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </Flex>
                </Flex>
                <label>
                  <Text as="div" size="1" mb="1">
                    Activity name
                  </Text>
                  <TextField.Root
                    required
                    maxLength={200}
                    value={activity.title}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        activities: draft.activities.map((item, i) =>
                          i === at ? { ...item, title: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <Text as="div" size="1" mt="2" mb="1">
                    Details
                  </Text>
                  <TextArea
                    value={activity.description}
                    maxLength={1200}
                    rows={3}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        activities: draft.activities.map((item, i) =>
                          i === at ? { ...item, description: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
              </section>
            ))}
            <Button
              type="button"
              variant="soft"
              disabled={draft.activities.length >= STUDIO_ITINERARY_MAX_ACTIVITIES}
              onClick={() =>
                setDraft({
                  ...draft,
                  activities: [
                    ...draft.activities,
                    { period: 'flexible', title: '', description: '', sources: [] },
                  ],
                })
              }
            >
              <Plus size={14} /> Add activity
            </Button>
            {error && (
              <Text color="red" size="2" role="alert">
                {error}
              </Text>
            )}
            <Flex gap="3" mt="2">
              <Button loading={saving} disabled={blocked}>
                Save day
              </Button>
              <Button type="button" variant="soft" color="gray" onClick={onClose}>
                Cancel
              </Button>
            </Flex>
          </Flex>
        </fieldset>
      </form>
    </Modal>
  );
}
