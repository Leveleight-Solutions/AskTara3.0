import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Compass,
  Globe2,
  Heart,
  Info,
  MapPin,
  Mountain,
  Plane,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  Waves,
  X,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  VisuallyHidden,
  IconButton,
  Inset,
  SegmentedControl,
  Select,
  TabNav,
  Text,
  TextField,
} from '@radix-ui/themes';
import type { Experience, Stay, Vibe } from '../../shared/types';
import { money } from '../api';
import { useApp } from '../context';
import {
  DestinationCard,
  EmptyState,
  ExperienceCard,
  Modal,
  SaveButton,
  StayCard,
  TaraMark,
} from '../components/ui';
import HotelSearch from '../components/HotelSearch';
import { AddToTripDialog } from '../components/AddToTripDialog';

const vibes: { label: Vibe; icon: typeof Compass }[] = [
  { label: 'All places', icon: Globe2 },
  { label: 'By the water', icon: Waves },
  { label: 'City escapes', icon: Building2 },
  { label: 'Into the wild', icon: Mountain },
  { label: 'Culture & charm', icon: Compass },
];
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
type SelectedListing = { kind: 'stay'; item: Stay } | { kind: 'experience'; item: Experience };

/** Shared page shell: the old `.page-container` padding, as a Radix Container. */
function Page({ children }: { children: ReactNode }) {
  return (
    <Container size="4" px={{ initial: '4', md: '6' }} py="6" pb="9">
      {children}
    </Container>
  );
}

function PageIntro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: ReactNode }) {
  return (
    <Flex direction="column" gap="2" mb="2">
      <Text size="1" color="gray" weight="medium">
        {eyebrow}
      </Text>
      <Heading as="h1" size="8">
        {title}
      </Heading>
      <Text as="p" size="3" color="gray">
        {lead}
      </Text>
    </Flex>
  );
}

/** Eyebrow + heading + optional lead, used above every section grid. */
function SectionHeading({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
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

function ExploreNav({ current }: { current: 'destinations' | 'stays' | 'experiences' }) {
  const items = [
    {
      key: 'destinations' as const,
      to: '/explore',
      icon: <Globe2 size={17} />,
      label: 'Destinations',
    },
    { key: 'flights' as const, to: '/flights', icon: <Plane size={17} />, label: 'Flights' },
    { key: 'stays' as const, to: '/stays', icon: <BedDouble size={17} />, label: 'Stays' },
    {
      key: 'experiences' as const,
      to: '/experiences',
      icon: <Sparkles size={17} />,
      label: 'Experiences',
    },
  ];
  return (
    <TabNav.Root aria-label="Discover travel" mt="5" mb="5">
      {items.map((item) => {
        const active = item.key === current;
        return (
          <TabNav.Link key={item.key} asChild active={active}>
            <Link to={item.to} aria-current={active ? 'page' : undefined}>
              <Flex align="center" gap="2">
                {item.icon}
                {item.label}
              </Flex>
            </Link>
          </TabNav.Link>
        );
      })}
    </TabNav.Root>
  );
}

/** Search field + one dropdown: the whole filter surface stays on one scannable row. */
function FilterBar({
  searchLabel,
  placeholder,
  query,
  onQuery,
  selectLabel,
  selectIcon,
  selectValue,
  selectText,
  options,
  onSelect,
}: {
  searchLabel: string;
  placeholder: string;
  query: string;
  onQuery: (value: string) => void;
  selectLabel: string;
  selectIcon: ReactNode;
  selectValue: string;
  selectText: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <Flex gap="3" align="center" wrap="wrap">
      <Box flexGrow="1" style={{ minWidth: 240, maxWidth: 600 }}>
        <TextField.Root
          size="3"
          aria-label={searchLabel}
          placeholder={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        >
          <TextField.Slot>
            <Search size={18} />
          </TextField.Slot>
          {query && (
            <TextField.Slot side="right">
              <IconButton
                type="button"
                size="2"
                variant="ghost"
                color="gray"
                aria-label="Clear search"
                onClick={() => onQuery('')}
              >
                <X size={16} />
              </IconButton>
            </TextField.Slot>
          )}
        </TextField.Root>
      </Box>
      <Select.Root size="3" value={selectValue} onValueChange={onSelect}>
        <Select.Trigger aria-label={selectLabel}>
          <Flex align="center" gap="2">
            {selectIcon}
            {selectText}
          </Flex>
        </Select.Trigger>
        <Select.Content>
          {options.map((o) => (
            <Select.Item key={o.value} value={o.value}>
              {o.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}

function ResultCount({
  children,
  onReset,
  label,
}: {
  children: ReactNode;
  onReset?: () => void;
  /** Names the results section. Rendered for assistive tech only: the count beside it is the
      visible affordance, but without a heading here the card titles (h3) would follow the page
      h1 with no h2 in between. */
  label: string;
}) {
  return (
    <Flex justify="between" align="center" gap="3" mt="5" mb="4" style={{ minHeight: 32 }}>
      <VisuallyHidden>
        <Heading as="h2">{label}</Heading>
      </VisuallyHidden>
      <Text size="2" color="gray" aria-live="polite">
        {children}
      </Text>
      {onReset && (
        <Button type="button" size="3" variant="ghost" color="gray" onClick={onReset}>
          Reset filters
          <X size={13} />
        </Button>
      )}
    </Flex>
  );
}

const cardGrid = { initial: '1', xs: '2', md: '3' } as const;

function ListingDetail({
  selection,
  onClose,
}: {
  selection: SelectedListing;
  onClose: () => void;
}) {
  const { catalog } = useApp();
  const [adding, setAdding] = useState(false);
  const backToIdea = useCallback(() => setAdding(false), []);
  const item = selection.item;
  const destination = catalog.destinations.find((d) => d.id === item.destinationId)!;
  const isStay = selection.kind === 'stay';
  const prompt = isStay
    ? `Plan a trip to ${destination.name} with a ${(item as Stay).style.toLowerCase()} stay and a relaxed pace`
    : `Plan a trip to ${destination.name} including ${item.name.toLowerCase()}`;
  const search = isStay
    ? `${(item as Stay).style} in ${destination.name}`
    : `${item.name} ${destination.name} tours`;
  if (adding) return <AddToTripDialog selection={selection} onClose={backToIdea} />;
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <Grid columns={{ initial: '1', sm: '320px 1fr' }} gap="5" mt="3">
        <Box position="relative">
          <img
            src={item.image}
            alt={`${isStay ? 'Stay' : 'Travel'} inspiration for ${destination.name}`}
            style={{
              display: 'block',
              width: '100%',
              height: 240,
              objectFit: 'cover',
              borderRadius: 'var(--radius-3)',
            }}
          />
          <Box position="absolute" top="2" right="2">
            <SaveButton type={selection.kind} id={item.id} label={item.name} />
          </Box>
          <Box position="absolute" bottom="2" left="2">
            <Badge variant="solid" highContrast>
              Sample inspiration
            </Badge>
          </Box>
        </Box>
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <MapPin size={15} />
            <Text size="2" color="gray">
              {destination.name}, {destination.country}
            </Text>
          </Flex>
          <Text as="p" size="3">
            {item.description.replace(/^Sample (stay inspiration|itinerary idea): /, '')}
          </Text>
          <Grid columns={{ initial: '1', xs: '2' }} gap="3">
            <Card size="1">
              <Flex align="center" gap="3">
                <Wallet size={18} />
                <Flex direction="column">
                  <Text size="1" color="gray">
                    Planning estimate
                  </Text>
                  <Text size="2" weight="bold">
                    {money(item.price)}{' '}
                    <Text color="gray" weight="regular">
                      / {isStay ? 'night' : 'person'}
                    </Text>
                  </Text>
                </Flex>
              </Flex>
            </Card>
            <Card size="1">
              <Flex align="center" gap="3">
                {isStay ? <BedDouble size={18} /> : <Clock3 size={18} />}
                <Flex direction="column">
                  <Text size="1" color="gray">
                    {isStay ? 'The feeling' : 'Time to enjoy it'}
                  </Text>
                  <Text size="2" weight="bold">
                    {isStay ? (item as Stay).style : (item as Experience).duration}
                  </Text>
                </Flex>
              </Flex>
            </Card>
          </Grid>
          {isStay && (
            <Flex gap="2" wrap="wrap">
              {(item as Stay).amenities.map((a) => (
                <Badge key={a} color="gray" variant="soft" size="2">
                  <Check size={14} />
                  {a}
                </Badge>
              ))}
            </Flex>
          )}
          <Callout.Root color="blue" size="1">
            <Callout.Icon>
              <Info size={16} />
            </Callout.Icon>
            <Callout.Text>
              {isStay
                ? 'This is a fictional stay concept to help you shape your trip. Photos illustrate the style; no room inventory, guest reviews, or reservations are offered.'
                : 'This is a curated itinerary idea, not an available tour or a confirmed booking.'}{' '}
              Prices are illustrative USD estimates. Confirm current prices and availability
              directly with a provider.
            </Callout.Text>
          </Callout.Root>
          <Flex gap="3" wrap="wrap" mt="2">
            <Button size="3" onClick={() => setAdding(true)}>
              Add to an existing trip
              <CalendarDays size={16} />
            </Button>
            <Button asChild size="3" variant="soft">
              <Link to={`/chat?q=${encodeURIComponent(prompt)}`} onClick={onClose}>
                Plan around this
                <Sparkles size={16} />
              </Link>
            </Button>
            <Button asChild size="3" variant="soft" color="gray">
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(search)}`}
                target="_blank"
                rel="noreferrer"
              >
                Find real options
                <ArrowUpRight size={16} />
              </a>
            </Button>
          </Flex>
        </Flex>
      </Grid>
    </Modal>
  );
}

export function Explore() {
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const vibe = vibes.some((v) => v.label === params.get('vibe'))
    ? (params.get('vibe') as Vibe)
    : 'All places';
  const region = params.get('region') || 'all';
  const regions = useMemo(
    () => [...new Set(catalog.destinations.map((d) => d.region))].sort(),
    [catalog],
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all' || value === 'All places') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }
  const destinations = catalog.destinations.filter(
    (d) =>
      (vibe === 'All places' || d.vibe === vibe) &&
      (region === 'all' || d.region === region) &&
      matches(`${d.name} ${d.country} ${d.description} ${d.tags.join(' ')}`, query),
  );
  const filtered = Boolean(query || vibe !== 'All places' || region !== 'all');
  return (
    <Page>
      <PageIntro
        eyebrow="LET CURIOSITY LEAD THE WAY"
        title="Your next somewhere."
        lead="A change of scene. A different rhythm. Find a place that speaks to you."
      />
      <ExploreNav current="destinations" />
      <FilterBar
        searchLabel="Search destinations"
        placeholder="A country, a city, a feeling…"
        query={query}
        onQuery={(value) => filter('q', value)}
        selectLabel="Filter by region"
        selectIcon={<SlidersHorizontal size={16} />}
        selectValue={region}
        selectText={region === 'all' ? 'All regions' : region}
        options={[
          { value: 'all', label: 'All regions' },
          ...regions.map((r) => ({ value: r, label: r })),
        ]}
        onSelect={(value) => filter('region', value)}
      />
      <Box mt="4" maxWidth="100%" style={{ overflowX: 'auto' }}>
        <SegmentedControl.Root
          size="3"
          value={vibe}
          onValueChange={(value) => filter('vibe', value)}
          aria-label="Travel style"
        >
          {vibes.map(({ label, icon: Icon }) => (
            <SegmentedControl.Item key={label} value={label} aria-pressed={vibe === label}>
              <Flex align="center" gap="2">
                <Icon size={15} />
                {label}
              </Flex>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Box>
      <ResultCount label="Destinations" onReset={filtered ? () => setParams({}) : undefined}>
        {destinations.length} {destinations.length === 1 ? 'place' : 'places'} to get lost in
      </ResultCount>
      {destinations.length > 0 ? (
        <Grid columns={cardGrid} gap="5">
          {destinations.map((d) => (
            <DestinationCard key={d.id} destination={d} />
          ))}
        </Grid>
      ) : (
        <EmptyState
          title="A little further off the map."
          description="Try another destination or clear a filter to see more places."
          action="Show all destinations"
          onAction={() => setParams({})}
        />
      )}
      <Card mt="8" size="2">
        <Flex align="center" gap="4" direction={{ initial: 'column', sm: 'row' }}>
          <Box style={{ color: 'var(--accent-9)' }}>
            <TaraMark size={30} />
          </Box>
          <Box flexGrow="1">
            <Heading as="h2" size="4">
              Not sure where, but ready to go?
            </Heading>
            <Text as="p" size="2" color="gray">
              Tell Tara what a perfect day feels like. Start from there.
            </Text>
          </Box>
          <Button asChild size="3" variant={destinations.length > 0 ? 'solid' : 'soft'}>
            <Link to="/chat">
              Find my kind of place
              <ArrowRight size={16} />
            </Link>
          </Button>
        </Flex>
      </Card>
    </Page>
  );
}

export function DestinationDetail() {
  const { id } = useParams();
  const { catalog } = useApp();
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const destination = catalog.destinations.find((d) => d.id === id);
  if (!destination) return <NotFound />;
  const stays = catalog.stays.filter((s) => s.destinationId === id);
  const experiences = catalog.experiences.filter((e) => e.destinationId === id);
  const nearby = catalog.destinations
    .filter((d) => d.id !== id && (d.vibe === destination.vibe || d.region === destination.region))
    .slice(0, 4);
  return (
    <Page>
      <Button asChild variant="ghost" color="gray" size="3" mb="4">
        <Link to="/explore">
          <ArrowLeft size={16} />
          All destinations
        </Link>
      </Button>
      <Card size="2">
        <Inset clip="padding-box" side="top" pb="current">
          <Box position="relative">
            <img
              src={destination.image}
              alt={`${destination.name}, ${destination.country}`}
              style={{ display: 'block', width: '100%', height: 320, objectFit: 'cover' }}
            />
            <Box position="absolute" top="3" right="3">
              <SaveButton type="destination" id={destination.id} label={destination.name} />
            </Box>
          </Box>
        </Inset>
        <Flex direction="column" gap="2">
          <Text size="1" color="gray">
            {destination.country} · {destination.region}
          </Text>
          <Heading as="h1" size="8">
            {destination.name}
          </Heading>
          <Text as="p" size="3" color="gray">
            {destination.description}
          </Text>
        </Flex>
      </Card>
      <Grid columns={{ initial: '1', md: '2fr 1fr' }} gap="6" mt="6" align="start">
        <Box>
          <Text size="1" color="gray" weight="medium">
            A LITTLE INTRODUCTION
          </Text>
          <Heading as="h2" size="6" mt="1" mb="3">
            A place to make your own.
          </Heading>
          <Text as="p" size="3" color="gray">
            {destination.longDescription}
          </Text>
          <Flex gap="2" wrap="wrap" mt="4">
            {destination.tags.map((tag) => (
              <Badge key={tag} color="gray" variant="soft" size="2">
                {tag}
              </Badge>
            ))}
          </Flex>
        </Box>
        <Card size="2" asChild>
          <aside>
            <Flex direction="column" gap="4">
              <Heading as="h2" size="4">
                The little details
              </Heading>
              <Flex align="center" gap="3">
                <CalendarDays size={19} />
                <Flex direction="column">
                  <Text size="1" color="gray">
                    A lovely time to visit
                  </Text>
                  <Text size="2" weight="bold">
                    {destination.bestTime}
                  </Text>
                </Flex>
              </Flex>
              <Flex align="center" gap="3">
                <Wallet size={19} />
                <Flex direction="column">
                  <Text size="1" color="gray">
                    Indicative daily budget
                  </Text>
                  <Text size="2" weight="bold">
                    {money(destination.dailyBudget)}{' '}
                    <Text color="gray" weight="regular">
                      / person
                    </Text>
                  </Text>
                </Flex>
              </Flex>
              <Text as="p" size="1" color="gray">
                A starting estimate in USD for stays, meals, and exploring. Flights are extra;
                season and travel style change the total.
              </Text>
              <Button asChild size="3">
                <Link
                  to={`/chat?q=${encodeURIComponent(`Plan a 5 day trip to ${destination.name}`)}`}
                >
                  Plan this trip
                  <Sparkles size={16} />
                </Link>
              </Button>
            </Flex>
          </aside>
        </Card>
      </Grid>
      <Box asChild mt="8">
        <section>
          <SectionHeading
            eyebrow="A FEW REASONS TO GO"
            title="Make room for a little wonder."
            lead="Starting points for your story. Leave space for what you find along the way."
          />
          <Grid columns={{ initial: '1', xs: '2', md: '3' }} gap="3">
            {destination.highlights.map((highlight, i) => (
              <Card key={highlight} asChild>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${highlight}, ${destination.name}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Flex align="center" gap="3">
                    <Text size="1" color="gray" weight="bold">
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                    <Box flexGrow="1">
                      <Text size="2">{highlight}</Text>
                    </Box>
                    <ArrowUpRight size={16} />
                  </Flex>
                </a>
              </Card>
            ))}
          </Grid>
        </section>
      </Box>
      {(stays.length > 0 || experiences.length > 0) && (
        <Box asChild mt="8">
          <section>
            <SectionHeading
              eyebrow="PIECE IT TOGETHER"
              title="Little things to build a trip around."
              lead="Sample stays and experiences to spark an idea."
            />
            <Grid columns={cardGrid} gap="5">
              {stays.map((s) => (
                <StayCard
                  key={s.id}
                  stay={s}
                  onSelect={() => setSelection({ kind: 'stay', item: s })}
                />
              ))}
              {experiences.map((e) => (
                <ExperienceCard
                  key={e.id}
                  experience={e}
                  onSelect={() => setSelection({ kind: 'experience', item: e })}
                />
              ))}
              <Card size="2">
                <Flex direction="column" align="start" gap="3">
                  <Box style={{ color: 'var(--accent-9)' }}>
                    <TaraMark size={34} />
                  </Box>
                  <Heading as="h3" size="4">
                    Your trip.
                    <br />
                    Your kind of wonderful.
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    Tell Tara your dates, your pace, and the things you love. Bring it all together
                    in one plan.
                  </Text>
                  <Button asChild size="3" variant="soft" mt="2">
                    <Link
                      to={`/chat?q=${encodeURIComponent(`Help me plan a trip to ${destination.name}`)}`}
                    >
                      Let’s make a plan
                      <ArrowRight size={16} />
                    </Link>
                  </Button>
                </Flex>
              </Card>
            </Grid>
          </section>
        </Box>
      )}
      {nearby.length > 0 && (
        <Box asChild mt="8">
          <section>
            <SectionHeading
              eyebrow="KEEP THE CURIOSITY GOING"
              title="Another place, another possibility."
              action={
                <Button asChild variant="ghost" size="3">
                  <Link to="/explore">
                    Explore the collection
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              }
            />
            <Grid columns={cardGrid} gap="5">
              {nearby.map((d) => (
                <DestinationCard key={d.id} destination={d} />
              ))}
            </Grid>
          </section>
        </Box>
      )}
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </Page>
  );
}

export function Collection({ kind }: { kind: 'stays' | 'experiences' }) {
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const destinationId = params.get('destination') || 'all';
  const query = params.get('q') || '';
  const isStays = kind === 'stays';
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }
  function visible(item: Stay | Experience) {
    const destination = catalog.destinations.find((d) => d.id === item.destinationId);
    return (
      (destinationId === 'all' || item.destinationId === destinationId) &&
      matches(
        `${item.name} ${item.description} ${destination?.name} ${destination?.country} ${'style' in item ? item.style : item.category}`,
        query,
      )
    );
  }
  const stays = catalog.stays.filter(visible);
  const experiences = catalog.experiences.filter(visible);
  const count = isStays ? stays.length : experiences.length;
  const selectedDestination = catalog.destinations.find((d) => d.id === destinationId);
  return (
    <Page>
      <PageIntro
        eyebrow={isStays ? 'MORE THAN A PLACE TO SLEEP' : 'COLLECT A FEW GOOD STORIES'}
        title={isStays ? 'Stay somewhere wonderful.' : 'The moments that stay with you.'}
        lead={
          isStays
            ? 'A courtyard. A mountain view. A room that feels like part of the journey.'
            : 'A taste of somewhere new. A different view. A little closer to the places you go.'
        }
      />
      <ExploreNav current={isStays ? 'stays' : 'experiences'} />
      {isStays && (
        <HotelSearch destinationId={destinationId === 'all' ? undefined : destinationId} />
      )}
      <Box mt={isStays ? '5' : '0'}>
        <FilterBar
          searchLabel={`Search ${kind}`}
          placeholder={
            isStays ? 'A hideaway, an island, a city…' : 'Food, culture, a little adventure…'
          }
          query={query}
          onQuery={(value) => filter('q', value)}
          selectLabel="Filter by destination"
          selectIcon={<MapPin size={16} />}
          selectValue={destinationId}
          selectText={selectedDestination ? selectedDestination.name : 'All destinations'}
          options={[
            { value: 'all', label: 'All destinations' },
            ...catalog.destinations.map((d) => ({ value: d.id, label: d.name })),
          ]}
          onSelect={(value) => filter('destination', value)}
        />
      </Box>
      <ResultCount
        label={kind === 'stays' ? 'Places to stay' : 'Experiences'}
        onReset={query || destinationId !== 'all' ? () => setParams({}) : undefined}
      >
        {count}{' '}
        {isStays ? (count === 1 ? 'stay' : 'stays') : count === 1 ? 'experience' : 'experiences'} to
        inspire you
      </ResultCount>
      <Text as="p" size="1" color="gray" mb="4">
        {isStays
          ? 'An inspiration collection of fictional stays. Photos illustrate a style; prices are estimates, not live room rates.'
          : 'Curated itinerary ideas with indicative prices. These are sample experiences, not bookable tours.'}
      </Text>
      {count ? (
        <Grid columns={cardGrid} gap="5">
          {isStays
            ? stays.map((s) => (
                <StayCard
                  key={s.id}
                  stay={s}
                  onSelect={() => setSelection({ kind: 'stay', item: s })}
                />
              ))
            : experiences.map((e) => (
                <ExperienceCard
                  key={e.id}
                  experience={e}
                  onSelect={() => setSelection({ kind: 'experience', item: e })}
                />
              ))}
        </Grid>
      ) : (
        <EmptyState
          title="Let’s try a different direction."
          description="Clear a filter or try another search to find your next idea."
          action={`Show all ${kind}`}
          onAction={() => setParams({})}
        />
      )}
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </Page>
  );
}

export function Saved() {
  const { catalog, saved, user, openAuth } = useApp();
  const [tab, setTab] = useState<'all' | 'destination' | 'stay' | 'experience'>('all');
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const items = saved.filter((s) => tab === 'all' || s.type === tab);
  const tabs = [
    { value: 'all' as const, label: 'Everything', icon: Heart },
    { value: 'destination' as const, label: 'Destinations', icon: Globe2 },
    { value: 'stay' as const, label: 'Stays', icon: BedDouble },
    { value: 'experience' as const, label: 'Experiences', icon: Sparkles },
  ];
  return (
    <Page>
      <PageIntro
        eyebrow="A LITTLE INSPIRATION, KEPT CLOSE"
        title="Your someday starts here."
        lead="The places you love. The things you want to do. Save them now, make a story later."
      />
      {!user && saved.length > 0 && (
        <Callout.Root color="blue" mt="5">
          <Callout.Icon>
            <Heart size={19} />
          </Callout.Icon>
          <Callout.Text>
            Your wishlist is saved in this browser. Create an account to keep it with you.
          </Callout.Text>
          <Box>
            <Button variant="soft" size="3" onClick={openAuth}>
              Sign in or join
              <ArrowRight size={15} />
            </Button>
          </Box>
        </Callout.Root>
      )}
      <Box mt="5" maxWidth="100%" style={{ overflowX: 'auto' }}>
        <SegmentedControl.Root
          size="3"
          value={tab}
          onValueChange={(value) => setTab(value as 'all' | 'destination' | 'stay' | 'experience')}
          aria-label="Filter wishlist"
        >
          {tabs.map(({ value, label, icon: Icon }) => (
            <SegmentedControl.Item key={value} value={value} aria-pressed={tab === value}>
              <Flex align="center" gap="2">
                <Icon size={15} />
                {label}
                <Badge color="gray" variant="soft" radius="full">
                  {value === 'all' ? saved.length : saved.filter((s) => s.type === value).length}
                </Badge>
              </Flex>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Box>
      <Box mt="5">
        {items.length ? (
          <Grid columns={cardGrid} gap="5">
            {items.map((item) => {
              if (item.type === 'destination') {
                const d = catalog.destinations.find((d) => d.id === item.itemId);
                return d ? <DestinationCard key={item.id} destination={d} /> : null;
              }
              if (item.type === 'stay') {
                const s = catalog.stays.find((s) => s.id === item.itemId);
                return s ? (
                  <StayCard
                    key={item.id}
                    stay={s}
                    onSelect={() => setSelection({ kind: 'stay', item: s })}
                  />
                ) : null;
              }
              const e = catalog.experiences.find((e) => e.id === item.itemId);
              return e ? (
                <ExperienceCard
                  key={item.id}
                  experience={e}
                  onSelect={() => setSelection({ kind: 'experience', item: e })}
                />
              ) : null;
            })}
          </Grid>
        ) : (
          <EmptyState
            title={
              tab === 'all'
                ? 'A blank page, full of possibility.'
                : 'A little room for inspiration.'
            }
            description={
              tab === 'all'
                ? 'Tap the heart on a place, stay, or experience that catches your eye. It will be waiting for you here.'
                : `Your saved ${tab === 'destination' ? 'destinations' : `${tab}s`} will appear here. Find something that feels like you.`
            }
            action={
              tab === 'stay'
                ? 'Explore stays'
                : tab === 'experience'
                  ? 'Explore experiences'
                  : 'Find your next somewhere'
            }
            to={tab === 'stay' ? '/stays' : tab === 'experience' ? '/experiences' : '/explore'}
          />
        )}
      </Box>
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </Page>
  );
}

export function NotFound() {
  return (
    <Page>
      <EmptyState
        title="A little off the beaten path."
        description="This page isn’t here, but there’s a whole world waiting to be explored."
        action="Back to discovering"
        to="/explore"
      />
    </Page>
  );
}
