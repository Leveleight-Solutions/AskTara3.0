import { useEffect, useId, useState } from 'react';
import { ExternalLink, MapPin, Route } from 'lucide-react';
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
import './itinerary-map.css';

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
    <section className="itinerary-map" aria-labelledby={`${id}-heading`}>
      <div className="itinerary-map-heading">
        <div>
          <span className="eyebrow">
            Day {day.day} · {destination.name}
          </span>
          <h3 id={`${id}-heading`}>
            <Route size={17} />
            {stops.length > 1 ? 'Your day, on the map' : 'Explore the neighborhood'}
          </h3>
        </div>
        {external && (
          <a
            href={external}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open itinerary in Google Maps"
          >
            <ExternalLink size={15} />
            <span>Google Maps</span>
          </a>
        )}
      </div>
      {stops.length > 1 && (
        <div className="itinerary-map-controls">
          <label htmlFor={`${id}-mode`}>
            Getting around
            <select
              id={`${id}-mode`}
              value={mode}
              onChange={(event) => setMode(event.target.value as MapTravelMode)}
            >
              <option value="suggested">Suggested routes</option>
              <option value="walking">Walking</option>
              <option value="driving">Driving</option>
              <option value="transit">Public transport</option>
            </select>
          </label>
          {routes.length > 1 && (
            <label htmlFor={`${id}-section`}>
              Route section
              <select
                id={`${id}-section`}
                value={Math.min(section, routes.length - 1)}
                onChange={(event) => setSection(Number(event.target.value))}
              >
                {routes.map((_entry, index) => (
                  <option value={index} key={index}>
                    Section {index + 1} of {routes.length}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {embed ? (
        <iframe
          className="itinerary-map-frame"
          title={`Google Maps ${stops.length > 1 ? 'route' : 'place'} for day ${day.day}`}
          src={embed}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <div className="itinerary-map-unconnected">
          <MapPin size={25} />
          <p>{loading ? 'Preparing your map…' : 'Your places are ready to explore.'}</p>
          <span>
            {stops.length
              ? `${stops.length} linked place${stops.length === 1 ? '' : 's'} in your day.`
              : `Discover ${destination.name} and choose the places you’d like to visit.`}
          </span>
          {external && (
            <a className="button" href={external} target="_blank" rel="noopener noreferrer">
              {stops.length > 1 ? 'Open this route' : 'Explore on Google Maps'}
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}
      {route && (
        <ol className="itinerary-map-stops">
          {route.stops.map((stop) => (
            <li key={stop.id}>
              <a href={googlePlaceLink(stop)} target="_blank" rel="noopener noreferrer">
                {stop.label}
                <ExternalLink size={11} />
              </a>
            </li>
          ))}
        </ol>
      )}
      {googleStops.length > 0 && (
        <div className="itinerary-map-attribution">
          <strong>Google Maps</strong>
          {attributions.map((entry, index) => (
            <span key={index}>
              {entry.providerUri?.startsWith('https://') ? (
                <a href={entry.providerUri} target="_blank" rel="noopener noreferrer">
                  {entry.provider}
                </a>
              ) : (
                entry.provider
              )}
            </span>
          ))}
        </div>
      )}
      <p className="itinerary-map-note">
        {routes.length > 1 ? 'Longer days are split into sections for mobile directions. ' : ''}
        Routes connect linked landmarks and researched places in itinerary order. Check directions
        and travel times in Google Maps before setting out.
      </p>
      {embed && external && (
        <a
          className="itinerary-map-fallback"
          href={external}
          target="_blank"
          rel="noopener noreferrer"
        >
          Map not loading? Open in Google Maps <ExternalLink size={12} />
        </a>
      )}
    </section>
  );
}
