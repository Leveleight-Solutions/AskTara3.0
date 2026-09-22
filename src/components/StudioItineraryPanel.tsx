import { useState } from 'react';
import { ArrowRight, MessageCircle, Sparkles } from 'lucide-react';
import { Badge, Box, Button, Callout, Card, Flex, Heading, Text, TextArea } from '@radix-ui/themes';
import type { StudioWorkspace } from '../../shared/studio';
import type { StudioItinerary } from '../../shared/studio-itinerary';
import { STUDIO_ITINERARY_MAX_DAYS } from '../../shared/studio-itinerary';
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
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  building: boolean;
  onGenerate: (instructions: string) => Promise<boolean | undefined>;
  onRefine: () => void;
  onReview: () => void;
}) {
  const { integrations } = useApp();
  const [instructions, setInstructions] = useState('');
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
            Turn the accepted route into a practical daily plan, then refine it with Tara before
            sharing the proposal.
          </Text>
        </Box>
        {!nightsKnown && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              Set the number of nights in every destination before building the itinerary.
            </Callout.Text>
          </Callout.Root>
        )}
        {tooLong && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              Generate an itinerary of up to {STUDIO_ITINERARY_MAX_DAYS} days. Shorten this route or
              split it into separate proposals.
            </Callout.Text>
          </Callout.Root>
        )}
        {!integrations.ai && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              AI planning needs to be connected to generate a day-by-day itinerary.
            </Callout.Text>
          </Callout.Root>
        )}
        <Card size="2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled || !ready) return;
              void onGenerate(instructions.trim()).then((saved) => {
                if (saved) setInstructions('');
              });
            }}
          >
            <Flex direction="column" gap="3">
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
