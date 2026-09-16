import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  Globe2,
  Sparkles,
  Users,
  Waves,
  Mountain,
  Building2,
  Leaf,
  Coffee,
  Route,
} from 'lucide-react';
import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  VisuallyHidden,
  Inset,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes';
import { useApp } from '../context';
import { AuroraBackground } from '../components/AuroraBackground';
import { RiseIn } from '../components/RiseIn';
import { StartComposer } from '../components/StartComposer';
import { DestinationCard, ExperienceCard, Modal, StayCard, TaraMark } from '../components/ui';
import type { Vibe } from '../../shared/types';
import { buildTripPrompt } from '../../shared/trip-prompt';

const vibeFilters: { label: Vibe; icon: typeof Compass }[] = [
  { label: 'All places', icon: Globe2 },
  { label: 'By the water', icon: Waves },
  { label: 'City escapes', icon: Building2 },
  { label: 'Into the wild', icon: Mountain },
  { label: 'Culture & charm', icon: Compass },
];

/* The hero asks one of these, chosen per visit. They all open the same door â tell Tara about a
   trip â but they ask in a travel agent's voice rather than a search box's. Kept short: the h1 is
   fluid-sized against the viewport's height as well as its width, and a long line is what pushes
   the composer down on a phone. */

const sketchStyle = {
  width: 82,
  height: 77,
  stroke: 'var(--accent-9)',
  strokeWidth: 1.2,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function TravelSketch({ kind }: { kind: 'stay' | 'flight' | 'experience' | 'discover' }) {
  return (
    <Box aria-hidden="true" flexShrink="0">
      {kind === 'stay' ? (
        <svg viewBox="0 0 120 94" style={sketchStyle}>
          <path d="M32 83V43a27 27 0 0 1 54 0v40M29 83h62M41 83V45a18 18 0 0 1 36 0v38M59 65v4M25 80V59m0 10c-13 0-12-11-12-11 12-1 12 11 12 11Zm0 5c12-1 12-11 12-11-11 0-12 11-12 11ZM101 83V55m0 14c-12-1-12-12-12-12 12 0 12 12 12 12Zm0-9c10-2 9-12 9-12-10 1-9 12-9 12Z" />
        </svg>
      ) : kind === 'flight' ? (
        <svg viewBox="0 0 120 94" style={sketchStyle}>
          <path d="m27 35 65-16-29 57-8-26-28-15Zm28 15 37-31M14 79c14-11 24 10 40 0s26-6 35-2M15 89c14-10 24 9 39 0s26-6 35-2" />
        </svg>
      ) : kind === 'experience' ? (
        <svg viewBox="0 0 120 94" style={sketchStyle}>
          <path d="M18 78c0-19 48-2 43-21S24 43 35 26c7-10 20-9 30-9M87 82V55m-8 0h16m-13 0-2-16h15l-3 16M67 80h29M19 35l-3 5-3-5-5-3 5-3 3-5 3 5 5 3-5 3ZM85 11l4 8 9 2-7 7 1 9-7-5-8 5 2-9-7-7 10-2 3-8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 120 94" style={sketchStyle}>
          <circle cx="59" cy="43" r="29" />
          <path d="m47 57 7-18 17-10-7 19-17 9ZM59 9V3m0 80v-7M25 43h-7m82 0h-8M12 88c22-15 33 8 54 0s26-4 37-2" />
        </svg>
      )}
    </Box>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Flex
      justify="between"
      align={{ initial: 'start', sm: 'end' }}
      direction={{ initial: 'column', sm: 'row' }}
      gap="3"
      mb="4"
    >
      <Flex direction="column" gap="1">
        <Text size="1" color="gray" weight="medium">
          {eyebrow}
        </Text>
        <Heading as="h2" size="6">
          {title}
        </Heading>
        {lead && (
          <Text as="p" size="2" color="gray">
            {lead}
          </Text>
        )}
      </Flex>
      {action}
    </Flex>
  );
}

export default function Home() {
  const { catalog } = useApp();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  /* A brief can arrive in the URL — an inspiration card, or a forwarded /studio?q= link. Seed the
     composer with it rather than dropping it, and key the composer on it so a second card click
     replaces the text instead of leaving the first one in place. */
  const carriedBrief = search.get('q') || '';
  const [vibe, setVibe] = useState<Vibe>('All places');
  const [travelers, setTravelers] = useState<number | undefined>();
  const [startDate, setStartDate] = useState('');
  const [details, setDetails] = useState(false);
  const filtered = catalog.destinations
    .filter((d) => vibe === 'All places' || d.vibe === vibe)
    .slice(0, 4);
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
                  align="center"
                  wrap="balance"
                  style={{
                    fontSize: 'clamp(var(--font-size-6), min(7vw, 7.2dvh), var(--font-size-9))',
                    lineHeight: 1.05,
                  }}
                >
                  What are you planning?
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
      <Container size="4" px={{ initial: '4', md: '6' }} py="8">
        <Box asChild>
          <section aria-label="Explore travel services">
            {/* The aria-label names the region but does not appear in the heading outline; without
                this the service card titles (h3) would follow the page h1 with no h2 between. */}
            <VisuallyHidden>
              <Heading as="h2">Explore travel services</Heading>
            </VisuallyHidden>
            <Grid columns={{ initial: '1', xs: '2', md: '4' }} gap="4">
              {[
                {
                  kind: 'stay' as const,
                  title: 'Somewhere to stay',
                  desc: 'Beautiful stays with a little soul.',
                  to: '/stays',
                },
                {
                  kind: 'flight' as const,
                  title: 'A way to get there',
                  desc: 'The right flight for your journey.',
                  to: '/flights',
                },
                {
                  kind: 'experience' as const,
                  title: 'Something to remember',
                  desc: 'Little moments. Lasting memories.',
                  to: '/experiences',
                },
                {
                  kind: 'discover' as const,
                  title: 'A new perspective',
                  desc: 'Find your next somewhere.',
                  to: '/explore',
                },
              ].map((s) => (
                <Card asChild key={s.kind}>
                  <Link to={s.to}>
                    <Flex align="center" gap="3">
                      <TravelSketch kind={s.kind} />
                      <Box>
                        <Flex align="center" gap="2">
                          <Heading as="h3" size="3">
                            {s.title}
                          </Heading>
                          <ArrowUpRight size={15} />
                        </Flex>
                        <Text as="p" size="1" color="gray">
                          {s.desc}
                        </Text>
                      </Box>
                    </Flex>
                  </Link>
                </Card>
              ))}
            </Grid>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <SectionHeading
              eyebrow="THE WORLD IS CALLING"
              title="Where will your curiosity take you?"
              lead="Places with a story. Find the one that feels like yours."
              action={
                <Button asChild variant="ghost" size="3">
                  <Link to="/explore">
                    Explore all destinations <ArrowRight size={17} />
                  </Link>
                </Button>
              }
            />
            <Box mb="5" maxWidth="100%" style={{ overflowX: 'auto' }}>
              <SegmentedControl.Root
                size="3"
                value={vibe}
                onValueChange={(value) => setVibe(value as Vibe)}
                aria-label="Filter destinations by travel style"
              >
                {vibeFilters.map(({ label, icon: Icon }) => (
                  <SegmentedControl.Item key={label} value={label} aria-pressed={vibe === label}>
                    <Flex align="center" gap="2">
                      <Icon size={15} />
                      {label}
                    </Flex>
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Box>
            <Grid columns={{ initial: '1', xs: '2', md: '4' }} gap="5">
              {filtered.map((d) => (
                <DestinationCard key={d.id} destination={d} />
              ))}
            </Grid>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <Card size="4">
              <Grid columns={{ initial: '1', md: '1fr 1fr' }} gap="6" align="center">
                <Flex direction="column" align="start" gap="3">
                  <Text size="1" color="gray" weight="medium">
                    GOOD TRIPS START WITH A CONVERSATION
                  </Text>
                  <Heading as="h2" size="7">
                    You dream it.
                    <br />
                    Tara connects the dots.
                  </Heading>
                  <Text as="p" size="3" color="gray">
                    The quiet little hotel. The long lunch. The road worth taking.
                    <br />
                    Tell Tara what you love, and watch your trip come together.
                  </Text>
                  <Button asChild size="3" variant="soft" mt="2">
                    <Link to="/studio">
                      Let’s dream something up <Sparkles size={16} />
                    </Link>
                  </Button>
                  <Text size="1" color="gray">
                    Your itinerary. Your pace. Your kind of wonderful.
                  </Text>
                </Flex>
                <Flex direction="column" gap="3" aria-hidden="true">
                  <Card size="1">
                    <Inset clip="padding-box" side="top" pb="current">
                      <img
                        src={
                          catalog.destinations.find((d) => d.id === 'amalfi')?.image ||
                          catalog.destinations[1]?.image
                        }
                        alt=""
                        style={{
                          display: 'block',
                          width: '100%',
                          height: 150,
                          objectFit: 'cover',
                        }}
                      />
                    </Inset>
                    <Text size="1" color="gray">
                      Somewhere on the Amalfi Coast…
                    </Text>
                  </Card>
                  <Card size="1">
                    <Flex gap="3" align="center">
                      <Box flexShrink="0" style={{ color: 'var(--accent-9)' }}>
                        <TaraMark size={25} />
                      </Box>
                      <Text size="2">
                        “A little less rush.
                        <br />A little more dolce vita.”
                      </Text>
                    </Flex>
                  </Card>
                  <Card size="1">
                    <Flex direction="column" gap="2">
                      <Flex align="center" gap="2">
                        <Route size={14} />
                        <Text size="1" color="gray" weight="medium">
                          A DAY THAT FEELS LIKE YOU
                        </Text>
                      </Flex>
                      <Flex align="center" gap="3">
                        <Text size="1" color="gray">
                          09:00
                        </Text>
                        <Coffee size={15} />
                        <Text size="2">A slow start, a perfect espresso</Text>
                      </Flex>
                      <Flex align="center" gap="3">
                        <Text size="1" color="gray">
                          11:00
                        </Text>
                        <Waves size={15} />
                        <Text size="2">Take the scenic route to the sea</Text>
                      </Flex>
                      <Flex align="center" gap="3">
                        <Text size="1" color="gray">
                          17:00
                        </Text>
                        <Leaf size={15} />
                        <Text size="2">Nowhere to be. Everything to see.</Text>
                      </Flex>
                    </Flex>
                  </Card>
                </Flex>
              </Grid>
            </Card>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <SectionHeading
              eyebrow="STAY A LITTLE LONGER"
              title="A room with a point of view."
              lead="For the places that become part of the story."
              action={
                <Button asChild variant="ghost" size="3">
                  <Link to="/stays">
                    Find your stay <ArrowRight size={17} />
                  </Link>
                </Button>
              }
            />
            <Grid columns={{ initial: '1', xs: '2', md: '4' }} gap="5">
              {catalog.stays.slice(0, 4).map((s) => (
                <StayCard
                  key={s.id}
                  stay={s}
                  onSelect={() => navigate(`/stays?destination=${s.destinationId}`)}
                />
              ))}
            </Grid>
            <Text as="p" size="1" color="gray" mt="4">
              A curated collection of sample stays. Prices are planning estimates, not live rates.
            </Text>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <SectionHeading
              eyebrow="COLLECT MOMENTS, NOT CHECKLISTS"
              title="The things you’ll talk about later."
              lead="Get a little closer to the places you go."
              action={
                <Button asChild variant="ghost" size="3">
                  <Link to="/experiences">
                    Find your moment <ArrowRight size={17} />
                  </Link>
                </Button>
              }
            />
            <Grid columns={{ initial: '1', xs: '2', md: '4' }} gap="5">
              {catalog.experiences.slice(0, 4).map((e) => (
                <ExperienceCard
                  key={e.id}
                  experience={e}
                  onSelect={() => navigate(`/experiences?destination=${e.destinationId}`)}
                />
              ))}
            </Grid>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <SectionHeading
              eyebrow="A LITTLE INSPIRATION GOES A LONG WAY"
              title="Borrow the idea. Make it your own."
              lead="Three ways to get away. A starting point, never a script."
            />
            <Grid columns={{ initial: '1', xs: '2', md: '3' }} gap="5">
              {[
                {
                  id: 'kyoto',
                  title: 'The art of slowing down',
                  label: '5 DAYS IN KYOTO',
                  prompt: 'Plan a slow 5 day trip to Kyoto, with tea, temples, food and culture',
                },
                {
                  id: 'amalfi',
                  title: 'A week of dolce vita',
                  label: '7 DAYS ON THE AMALFI COAST',
                  prompt:
                    'Plan a relaxed 7 day trip to the Amalfi Coast for 2 travelers with beaches and food',
                },
                {
                  id: 'marrakech',
                  title: 'Follow the colors',
                  label: '3 DAYS IN MARRAKECH',
                  prompt: 'Plan a 3 day trip to Marrakech focused on art, food and culture',
                },
              ].map((story) => (
                <Card asChild key={story.id} size="2">
                  <Link to={`/?q=${encodeURIComponent(story.prompt)}`}>
                    <Inset clip="padding-box" side="top" pb="current">
                      <img
                        src={catalog.destinations.find((d) => d.id === story.id)?.image}
                        alt=""
                        loading="lazy"
                        style={{
                          display: 'block',
                          width: '100%',
                          height: 180,
                          objectFit: 'cover',
                        }}
                      />
                    </Inset>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray" weight="medium">
                        {story.label}
                      </Text>
                      <Heading as="h3" size="4">
                        {story.title}
                      </Heading>
                      <Flex align="center" gap="1" mt="1">
                        <Text size="2">Make this trip yours</Text>
                        <ArrowUpRight size={15} />
                      </Flex>
                    </Flex>
                  </Link>
                </Card>
              ))}
            </Grid>
          </section>
        </Box>
        <Box asChild mt="9">
          <section>
            <Card size="4">
              <Flex direction="column" align="center" gap="3">
                <Box style={{ color: 'var(--accent-9)' }}>
                  <TaraMark size={32} />
                </Box>
                <Heading as="h2" size="7" align="center">
                  Your next story is out there.
                </Heading>
                <Text as="p" size="3" color="gray" align="center">
                  Let’s find it together.
                </Text>
                <Button asChild size="3" variant="soft">
                  <Link to="/studio">
                    Ask Tara <ArrowRight size={16} />
                  </Link>
                </Button>
              </Flex>
            </Card>
          </section>
        </Box>
      </Container>
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
