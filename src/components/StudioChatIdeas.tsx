import { useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';
import { MapPin, Plus, Utensils } from 'lucide-react';
import type { StudioWorkspace } from '../../shared/studio';
import { Modal } from './ui';

export function StudioChatIdeas({
  workspace,
  busy,
  onAdd,
}: {
  workspace: StudioWorkspace;
  busy: boolean;
  onAdd: (
    id: string,
    day: number,
    period: 'morning' | 'afternoon' | 'evening' | 'flexible',
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [day, setDay] = useState(1);
  const [period, setPeriod] = useState<'morning' | 'afternoon' | 'evening' | 'flexible'>(
    'flexible',
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const recommendation = workspace.recommendations.find((item) => item.id === selected);
  return (
    <>
      {workspace.recommendations.length > 0 && (
        <section className="studio-chat-ideas" aria-label="Researched activity and food choices">
          <div className="studio-chat-section-label">IDEAS TO MAKE IT THEIR TRIP</div>
          <div className="studio-chat-ideas-grid">
            {workspace.recommendations.slice(0, 12).map((item) => (
              <article key={item.id}>
                <span className="studio-idea-icon">
                  {item.category === 'food' ? <Utensils size={17} /> : <MapPin size={17} />}
                </span>
                <div>
                  <small>{item.category === 'food' ? 'Eat & drink' : 'Explore'}</small>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <div className="studio-idea-sources">
                    {item.sources.slice(0, 2).map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        {source.label}
                      </a>
                    ))}
                  </div>
                  <Button
                    size="1"
                    variant="soft"
                    disabled={busy || !workspace.itinerary}
                    onClick={() => {
                      setSelected(item.id);
                      setDay(
                        workspace.itinerary?.days.find((d) => d.stopIds.includes(item.stopId))
                          ?.day || 1,
                      );
                      setError('');
                    }}
                  >
                    <Plus size={13} /> Add to a day
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!workspace.itinerary && (
            <Text as="p" size="1" color="gray" mt="2">
              Build the daily plan to place these ideas into specific days.
            </Text>
          )}
        </section>
      )}
      {recommendation && (
        <Modal
          title={`Add ${recommendation.name}`}
          onClose={() => {
            if (!saving) setSelected('');
          }}
        >
          <Text as="p" size="2" color="gray" mb="4">
            Choose where it fits. The researched source links will stay with the activity.
          </Text>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1">
                Itinerary day
              </Text>
              <select
                aria-label="Itinerary day"
                value={day}
                onChange={(event) => setDay(Number(event.target.value))}
              >
                {workspace.itinerary?.days
                  .filter(
                    (d) => !recommendation.stopId || d.stopIds.includes(recommendation.stopId),
                  )
                  .map((d) => (
                    <option key={d.day} value={d.day}>
                      Day {d.day} · {d.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <Text as="div" size="2" mb="1">
                Time of day
              </Text>
              <select
                aria-label="Time of day"
                value={period}
                onChange={(event) => setPeriod(event.target.value as typeof period)}
              >
                {['morning', 'afternoon', 'evening', 'flexible'].map((p) => (
                  <option key={p} value={p}>
                    {p === 'flexible' ? 'At your own pace' : p}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <Text color="red" role="alert" size="2">
                {error}
              </Text>
            )}
            <Button
              loading={saving}
              disabled={
                busy ||
                saving ||
                !workspace.itinerary?.days.some(
                  (d) =>
                    d.day === day &&
                    (!recommendation.stopId || d.stopIds.includes(recommendation.stopId)),
                )
              }
              onClick={() => {
                setSaving(true);
                void onAdd(recommendation.id, day, period)
                  .then(() => setSelected(''))
                  .catch((cause) => setError(cause.message))
                  .finally(() => setSaving(false));
              }}
            >
              Add to itinerary
            </Button>
          </Flex>
        </Modal>
      )}
    </>
  );
}
