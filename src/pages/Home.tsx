import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronDown, Users } from 'lucide-react';
import { Button, Container, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useApp } from '../context';
import { AuroraBackground } from '../components/AuroraBackground';
import { RiseIn } from '../components/RiseIn';
import { StartComposer } from '../components/StartComposer';
import { Modal } from '../components/ui';
import { buildTripPrompt } from '../../shared/trip-prompt';

/* The home page is the hero and nothing else. The destination, stay, experience and inspiration
   sections that used to follow it duplicated Discover (/explore), which is where browsing lives. */

export default function Home() {
  const { user } = useApp();
  /* Greet by first name once there is an account. Safe to read straight from context without
     guarding against a late swap: /session resolves before the catalog fetch, and the routes only
     mount once the catalog is in, so `user` is already settled by the time this renders — the
     heading never animates in and then rewrites itself. */
  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const [search] = useSearchParams();
  /* A brief can arrive in the URL — an inspiration card, or a forwarded /studio?q= link. Seed the
     composer with it rather than dropping it, and key the composer on it so a second card click
     replaces the text instead of leaving the first one in place. */
  const carriedBrief = search.get('q') || '';
  const [travelers, setTravelers] = useState<number | undefined>();
  const [startDate, setStartDate] = useState('');
  const [details, setDetails] = useState(false);
  return (
    <>
      {/* The hero fills exactly one screen below the app header: dvh (not vh) so mobile
          browsers' collapsing toolbars don't push its foot below the fold, and min-height (not
          height) so a short viewport lets the section grow and the page scroll rather than
          clipping. The header height is read from its variable rather than a literal, so this
          stays true when the top bar becomes a sidebar and the variable goes to 0px.
          justify="center" supplies the vertical rhythm that py="9" used to. */}
      <Flex
        asChild
        direction="column"
        justify="center"
        position="relative"
        style={{
          background: 'var(--accent-2)',
          minHeight: 'calc(100dvh - var(--app-header-height, 0px))',
        }}
      >
        <section>
          {/* Clips itself to this section and paints at z-index 0, so it never adds scrollable
              area; the content below lifts above it. */}
          <AuroraBackground />
          {/* Radix gives .rt-Container flex-grow: 1, which would pin the content to the top of
              the now viewport-tall section; grow 0 lets justify="center" above do the centring,
              and shrink 0 keeps a taller-than-viewport hero at its natural height instead of
              squeezing it. The padding is only the minimum gutter for that overflow case. */}
          <Container
            size="4"
            px={{ initial: '4', md: '6' }}
            py={{ initial: '5', md: '6' }}
            flexGrow="0"
            flexShrink="0"
            position="relative"
            style={{ zIndex: 1 }}
          >
            {/* The only gap in the hero is the one between the question and the composer, so it
                carries all of the breathing room: 32px on a phone, 48px once there is height to
                spend. */}
            <Flex direction="column" align="center" gap={{ initial: '6', sm: '8' }}>
              {/* The h1 is the tallest item, so it is the first thing that gives when the
                  screen is short or narrow. A Radix size prop is width-responsive only, and the
                  constraint here is height as much as width, so the size-9 token is the ceiling
                  of a fluid value that the viewport's own height and width can pull down.
                  It arrives from the composer's line: RiseIn measures that distance at runtime
                  from the pill below, so the entrance holds at any viewport. */}
              <RiseIn originSelector="[data-hero-composer]">
                <Heading
                  as="h1"
                  size="9"
                  weight="regular"
                  align="center"
                  wrap="balance"
                  style={{
                    fontSize: 'clamp(var(--font-size-6), min(7vw, 7.2dvh), var(--font-size-9))',
                    lineHeight: 1.05,
                  }}
                >
                  {firstName ? `What are you planning, ${firstName}?` : 'What are you planning?'}
                </Heading>
              </RiseIn>
              {/* The composer and the two details it can borrow are one group: the pill is the
                  primary control and the chips sit directly beneath it, soft and gray, close
                  enough to read as its footnote rather than as a second row of choices. */}
              <Flex direction="column" align="center" gap="3" width="100%">
                <StartComposer
                  key={carriedBrief}
                  heroAnchor
                  initialMessage={carriedBrief}
                  prepareMessage={(text) => buildTripPrompt(text, { travelers, startDate })}
                />
                <Flex align="center" gap="2" wrap="wrap" justify="center">
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    size="3"
                    onClick={() => setDetails(true)}
                  >
                    <Users size={15} />
                    <span>{travelers ? `${travelers} travellers` : 'Who\u2019s travelling?'}</span>
                    <ChevronDown size={12} />
                  </Button>
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    size="3"
                    onClick={() => setDetails(true)}
                  >
                    <CalendarDays size={15} />
                    <span>
                      {startDate
                        ? new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Add dates'}
                    </span>
                    <ChevronDown size={12} />
                  </Button>
                </Flex>
              </Flex>
            </Flex>
          </Container>
        </section>
      </Flex>
      {details && (
        <Modal title="A few little details" onClose={() => setDetails(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setDetails(false);
            }}
          >
            <Flex direction="column" gap="4" mt="3">
              <Flex direction="column" gap="1" asChild>
                <label>
                  <Text size="2" weight="medium">
                    How many travelers?
                  </Text>
                  <TextField.Root
                    size="3"
                    type="number"
                    min={1}
                    max={9}
                    value={travelers ?? ''}
                    placeholder="Not sure yet"
                    onChange={(e) =>
                      setTravelers(e.target.value ? Number(e.target.value) : undefined)
                    }
                  >
                    <TextField.Slot>
                      <Users size={16} />
                    </TextField.Slot>
                  </TextField.Root>
                </label>
              </Flex>
              <Flex direction="column" gap="1" asChild>
                <label>
                  <Text size="2" weight="medium">
                    When would you like to go?
                  </Text>
                  <TextField.Root
                    size="3"
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  >
                    <TextField.Slot>
                      <CalendarDays size={16} />
                    </TextField.Slot>
                  </TextField.Root>
                </label>
              </Flex>
              <Text as="p" size="1" color="gray">
                Leave anything undecided blank. Tara will ask what she needs to know.
              </Text>
              <Button size="3">
                Sounds good <Check size={16} />
              </Button>
            </Flex>
          </form>
        </Modal>
      )}
    </>
  );
}
