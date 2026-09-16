import { useEffect, useId, useState } from 'react';
import { ExternalLink, MapPin, Route } from 'lucide-react';
import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Inset,
  Link as ThemeLink,
  Select,
  Text,
} from '@radix-ui/themes';
import type { ItineraryDay, PublicConfig, Trip } from '../../shared/types';
import type { PlanningPlace } from '../../shared/planning';
import { findDestination } from '../../shared/destinations';
import {
  googleEmbedUrl,
  googlePlaceLink,
  itineraryMapRoutes,
  itineraryMapStops,
  type MapTravelMode,
} from '../../shared/maps';
import { api } from '../api';

/** Fresh Google details are passed from page state; this component never persists them. */
export default function ItineraryMap({
  trip,
  day,
  freshPlaces = {},
}: {
  trip: Trip;
  day?: ItineraryDay;
  freshPlaces?: Record<string, PlanningPlace>;
}) {
  const [config, setConfig] = useState<PublicConfig>({});
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<MapTravelMode>('suggested');
  const [section, setSection] = useState(0);
  const id = useId();
  useEffect(() => {
    const controller = new AbortController();
    api<PublicConfig>('/config', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setConfig(result);
      })
      .catch(() => {
        /* The external route remains available when configuration is unavailable. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => setSection(0), [trip.id, day?.day]);
  const stops = itineraryMapStops(trip, day, freshPlaces);
  const googleStops = stops.filter((stop) => stop.googlePlaceId && freshPlaces[stop.id]);
  const attributions = googleStops
    .flatMap((stop) => freshPlaces[stop.id].attributions || [])
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (other) => other.provider === entry.provider && other.providerUri === entry.providerUri,
        ) === index,
    );
  const routes = itineraryMapRoutes(stops, mode);
  const route = routes[Math.min(section, routes.length - 1)];
  const destination = findDestination(day?.destinationId || trip.destinationId, trip);
  const destinationStop = destination
    ? {
        id: destination.id,
        label: destination.name,
        query: `${destination.name}, ${destination.country}`,
        destinationLabel: `${destination.name}, ${destination.country}`,
      }
    : undefined;
  const visibleStops = route?.stops || (destinationStop ? [destinationStop] : []);
  const embed = googleEmbedUrl(visibleStops, config.mapsEmbedApiKey, mode);
  const external = route?.url || (destinationStop ? googlePlaceLink(destinationStop) : undefined);
  if (!day || !destination) return null;
  return (
    <Card asChild size="2" mx={{ initial: '4', sm: '6' }} mb="5" mt="2">
      <section aria-labelledby={`${id}-heading`} data-testid="itinerary-map">
        <Flex align="center" justify="between" gap="3" mb="3">
          <Box minWidth="0">
            <Text size="1" color="gray">
              Day {day.day} · {destination.name}
            </Text>
            <Heading as="h3" size="3" mt="1" id={`${id}-heading`}>
              <Flex align="center" gap="2">
                <Route size={17} />
                {stops.length > 1 ? 'Your day, on the map' : 'Explore the neighborhood'}
              </Flex>
            </Heading>
          </Box>
          {external && (
            <Button asChild variant="ghost" size="2" style={{ flexShrink: 0 }}>
              <a
                href={external}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open itinerary in Google Maps"
              >
                <ExternalLink size={15} />
                <Box display={{ initial: 'none', sm: 'block' }}>
                  <span>Google Maps</span>
                </Box>
              </a>
            </Button>
          )}
        </Flex>
        {stops.length > 1 && (
          <Grid columns={{ initial: '1', sm: routes.length > 1 ? '2' : '1' }} gap="3" mb="3">
            <Box>
              <Text
                as="label"
                htmlFor={`${id}-mode`}
                size="1"
                color="gray"
                mb="1"
                style={{ display: 'block' }}
              >
                Getting around
              </Text>
              <Select.Root
                size="2"
                value={mode}
                onValueChange={(value) => setMode(value as MapTravelMode)}
              >
                <Select.Trigger id={`${id}-mode`} style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="suggested">Suggested routes</Select.Item>
                  <Select.Item value="walking">Walking</Select.Item>
                  <Select.Item value="driving">Driving</Select.Item>
                  <Select.Item value="transit">Public transport</Select.Item>
                </Select.Content>
              </Select.Root>
            </Box>
            {routes.length > 1 && (
              <Box>
                <Text
                  as="label"
                  htmlFor={`${id}-section`}
                  size="1"
                  color="gray"
                  mb="1"
                  style={{ display: 'block' }}
                >
                  Route section
                </Text>
                <Select.Root
                  size="2"
                  value={String(Math.min(section, routes.length - 1))}
                  onValueChange={(value) => setSection(Number(value))}
                >
                  <Select.Trigger id={`${id}-section`} style={{ width: '100%' }} />
                  <Select.Content>
                    {routes.map((_entry, index) => (
                      <Select.Item value={String(index)} key={index}>
                        Section {index + 1} of {routes.length}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
            )}
          </Grid>
        )}
        {embed ? (
          <Inset side="x" my="3">
            <iframe
              title={`Google Maps ${stops.length > 1 ? 'route' : 'place'} for day ${day.day}`}
              src={embed}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              style={{
                display: 'block',
                width: '100%',
                height: 320,
                minWidth: 200,
                minHeight: 200,
                border: 0,
              }}
            />
          </Inset>
        ) : (
          <Inset side="x" my="3">
            <Flex
              direction="column"
              align="center"
              gap="2"
              px="4"
              py="5"
              style={{ background: 'var(--gray-a2)', textAlign: 'center' }}
            >
              <MapPin size={25} />
              <Text as="p" size="3">
                {loading ? 'Preparing your map…' : 'Your places are ready to explore.'}
              </Text>
              <Text size="1" color="gray" style={{ maxWidth: 290 }}>
                {stops.length
                  ? `${stops.length} linked place${stops.length === 1 ? '' : 's'} in your day.`
                  : `Discover ${destination.name} and choose the places you’d like to visit.`}
              </Text>
              {external && (
                <Button asChild size="3" variant="soft" mt="3">
                  <a href={external} target="_blank" rel="noopener noreferrer">
                    {stops.length > 1 ? 'Open this route' : 'Explore on Google Maps'}
                    <ExternalLink size={14} />
                  </a>
                </Button>
              )}
            </Flex>
          </Inset>
        )}
        {route && (
          <Flex asChild direction="column" gap="2" mt="3">
            <ol style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
              {route.stops.map((stop) => (
                <Text asChild size="1" color="gray" key={stop.id}>
                  <li>
                    <ThemeLink
                      href={googlePlaceLink(stop)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {stop.label} <ExternalLink size={11} />
                    </ThemeLink>
                  </li>
                </Text>
              ))}
            </ol>
          </Flex>
        )}
        {googleStops.length > 0 && (
          <Flex gap="2" wrap="wrap" align="center" mt="3">
            <Text size="1" color="gray" weight="bold">
              Google Maps
            </Text>
            {attributions.map((entry, index) => (
              <Text size="1" color="gray" key={index}>
                {entry.providerUri?.startsWith('https://') ? (
                  <ThemeLink href={entry.providerUri} target="_blank" rel="noopener noreferrer">
                    {entry.provider}
                  </ThemeLink>
                ) : (
                  entry.provider
                )}
              </Text>
            ))}
          </Flex>
        )}
        <Text as="p" size="1" color="gray" mt="3">
          {routes.length > 1 ? 'Longer days are split into sections for mobile directions. ' : ''}
          Routes connect linked landmarks and researched places in itinerary order. Check directions
          and travel times in Google Maps before setting out.
        </Text>
        {embed && external && (
          <Box mt="2">
            <ThemeLink href={external} target="_blank" rel="noopener noreferrer" size="1">
              Map not loading? Open in Google Maps <ExternalLink size={12} />
            </ThemeLink>
          </Box>
        )}
      </section>
    </Card>
  );
}
