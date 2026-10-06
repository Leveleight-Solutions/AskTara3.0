import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, IconButton, TextField } from '@radix-ui/themes';
import {
  ArrowRight,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Plane,
  Ship,
  Sparkles,
} from 'lucide-react';
import type { StudioBrief, StudioItem, StudioWorkspace } from '../../shared/studio';
import type { StudioCruiseDraft } from '../../shared/studio-cruise';
import type { StudioJourneyDirection, StudioJourneyOption } from '../../shared/studio-journey';
import type {
  HotelPhoto,
  StudioHotelQuote,
  StudioHotelSearchResult,
} from '../../shared/studio-hotels';
import type { StudioFlightQuote, StudioFlightSearchResult } from '../../shared/studio-flights';
import {
  flightDate,
  flightDuration,
  flightExpiry,
  flightPrice,
  flightTime,
} from '../../shared/flights';
import { studioCountries } from '../../shared/studio-travel-research';
import { api, ApiError, readableDate } from '../api';
import { Modal } from './ui';
import FlightDetails from './FlightDetails';
import {
  studioChatMediaUrl,
  studioChatQuoteContextKey,
  studioChatSearchBriefPatch,
  studioChatSearchDraft,
  type StudioChatSearchDraft,
  type StudioChatSearchKind,
  type StudioChatJourneyContext,
} from './studioChatOfferState';
import './StudioChatOffers.css';

export type StudioChatOfferKind = 'hotels' | 'flights' | 'cruises';
export type StudioChatOfferAction = StudioChatOfferKind;
export interface StudioChatOffersProps {
  workspace: StudioWorkspace;
  busy: boolean;
  hotelsEnabled: boolean;
  flightsEnabled: boolean;
  showActions?: boolean;
  selectedKind?: StudioChatOfferKind | null;
  selectedStopId?: string | null;
  journeyDirection?: StudioJourneyDirection;
  journeyOption?: StudioJourneyOption;
  onKindChange?: (kind: StudioChatOfferKind | null) => void;
  onUpdateWorkspace: (workspace: StudioWorkspace) => void;
  onSaveBrief: (brief: Partial<StudioBrief>) => Promise<StudioWorkspace | false | undefined>;
  onBusyChange?: (active: boolean) => void;
  onEditRoute: () => void;
  onOpenCruise: (cruiseId?: string) => void;
  onPlanActivities: () => void;
  onAddManualService?: (kind: 'hotel' | 'flight' | 'cruise') => void;
}
type Batch = {
  kind: StudioChatSearchKind;
  contextKey: string;
  query: StudioChatSearchDraft;
  loadedAt: number;
  quotes: StudioItem[];
  hotels?: StudioHotelSearchResult;
  flights?: StudioFlightSearchResult;
  warning: string;
  planning?: boolean;
  journey?: StudioChatJourneyContext;
};
type JourneyDateResolution = {
  arrivalDate: string | null;
  returnDepartureDate: string | null;
  nights: number | null;
  notes: string[];
};

function QuotePrice({ price, currency }: { price: number | null; currency: string }) {
  return (
    <strong className="studio-chat-offer__price">
      {price === null ? 'Price not supplied' : flightPrice({ price, currency })}
      <small>{currency}</small>
    </strong>
  );
}
function OfferPhotos({ photos, label }: { photos: HotelPhoto[]; label: string }) {
  const [index, setIndex] = useState(0),
    [failed, setFailed] = useState<string[]>([]);
  const available = photos.filter(
    (photo) => studioChatMediaUrl(photo.url) && !failed.includes(photo.url),
  );
  const selected = available[index % Math.max(1, available.length)];
  return (
    <div className="studio-chat-offer__photos">
      {selected ? (
        <img
          src={studioChatMediaUrl(selected.url)}
          alt={selected.caption || label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed((current) => [...current, selected.url])}
        />
      ) : (
        <div className="studio-chat-offer__photo-fallback">
          <BedDouble size={26} />
          <span>Photos not supplied</span>
        </div>
      )}
      {available.length > 1 && (
        <div className="studio-chat-offer__photo-controls">
          <IconButton
            type="button"
            size="1"
            aria-label={`Previous ${label} photo`}
            onClick={() => setIndex((index + available.length - 1) % available.length)}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <span aria-live="polite">
            {(index % available.length) + 1} / {available.length}
          </span>
          <IconButton
            type="button"
            size="1"
            aria-label={`Next ${label} photo`}
            onClick={() => setIndex((index + 1) % available.length)}
          >
            <ChevronRight size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
export function StudioChatHotelCard({
  hotel,
  reason,
  added,
  needsReview = false,
  priceStatus,
  disabled,
  onSelect,
}: {
  hotel: StudioHotelQuote;
  reason?: string;
  added: boolean;
  needsReview?: boolean;
  priceStatus?: StudioItem['priceStatus'];
  disabled: boolean;
  onSelect: () => void;
}) {
  const [photoKind, setPhotoKind] = useState<'property' | 'room'>('property');
  const review = added && (needsReview || Date.now() - Date.parse(hotel.quotedAt) >= 30 * 60000);
  return (
    <article
      className="studio-chat-offer"
      aria-label={`${hotel.name} · ${hotel.room}`}
      data-testid="studio-chat-hotel-card"
    >
      <div className="studio-chat-offer__media">
        <OfferPhotos
          key={photoKind}
          photos={photoKind === 'property' ? hotel.photos : hotel.roomPhotos}
          label={`${hotel.name} ${photoKind === 'room' ? 'quoted room' : 'hotel'}`}
        />
        <div className="studio-chat-offer__media-switch" aria-label={`${hotel.name} photos`}>
          <button
            type="button"
            aria-pressed={photoKind === 'property'}
            onClick={() => setPhotoKind('property')}
          >
            Hotel photos
          </button>
          <button
            type="button"
            aria-pressed={photoKind === 'room'}
            onClick={() => setPhotoKind('room')}
          >
            Quoted room photos
          </button>
        </div>
      </div>
      <div className="studio-chat-offer__body">
        <div className="studio-chat-offer__eyebrow">
          <span>{hotel.stars === null ? hotel.group : `${hotel.stars} star`}</span>
          <Badge color={hotel.mode === 'test' ? 'amber' : 'gray'}>
            {hotel.mode === 'test'
              ? 'Sandbox availability'
              : hotel.mode === 'provider'
                ? 'Provider mode unverified'
                : 'Supplier quote'}
          </Badge>
        </div>
        {review && <Badge color="amber">Review required</Badge>}
        {added && priceStatus === 'agent_estimate' && <Badge color="gray">Recorded estimate</Badge>}
        <h4>{hotel.name}</h4>
        <p className="studio-chat-offer__muted">{hotel.address || 'Address not supplied'}</p>
        <p>
          <strong>{hotel.room}</strong>
          {hotel.board ? ` · ${hotel.board}` : ''}
        </p>
        <p className="studio-chat-offer__muted">
          Check-in {readableDate(hotel.checkin)} · Check-out {readableDate(hotel.checkout)}
        </p>
        {reason && <p className="studio-chat-offer__reason">{reason}</p>}
        <div className="studio-chat-offer__footer">
          <div>
            <QuotePrice price={hotel.price} currency={hotel.currency} />
            <small>
              {added ? 'Recorded full stay' : 'Full stay'} · {hotel.adults} adults
              {hotel.childAges.length
                ? ` + ${hotel.childAges.length} ${hotel.childAges.length === 1 ? 'child' : 'children'}`
                : ''}{' '}
              · one room
            </small>
          </div>
          <Button type="button" size="2" disabled={disabled || added} onClick={onSelect}>
            {added ? (
              <>
                <Check size={14} /> Added
              </>
            ) : (
              'Add to proposal'
            )}
          </Button>
        </div>
        {review && (
          <p className="studio-chat-offer__muted">
            Recorded quote · review trip details and recheck the price.
          </p>
        )}
        <details className="studio-chat-offer__details">
          <summary>Room & rate details</summary>
          <p>{hotel.roomDescription || 'Room description not supplied.'}</p>
          {hotel.roomAmenities.length > 0 && <p>{hotel.roomAmenities.join(' · ')}</p>}
          <p>{hotel.cancellation || 'Cancellation terms not supplied.'}</p>
          <p>{hotel.taxes || 'Tax details not supplied.'}</p>
          {hotel.description && <p>{hotel.description}</p>}
          {hotel.amenities.length > 0 && <p>{hotel.amenities.join(' · ')}</p>}
          {hotel.distanceKm !== null && (
            <p>{hotel.distanceKm} km from destination centre · straight-line distance</p>
          )}
          {!hotel.roomPhotos.length && <p>No supplier photos were mapped to this quoted room.</p>}
          <p>
            Checked {new Date(hotel.quotedAt).toLocaleString()}. Reconfirm availability and rate
            terms before booking.
          </p>
        </details>
      </div>
    </article>
  );
}
function CarrierMark({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  const src = studioChatMediaUrl(url);
  return (
    <span className="studio-chat-offer__carrier">
      {src && !failed ? (
        <img
          src={src}
          alt={`${name} logo`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">
          {name
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase() || <Plane size={18} />}
        </span>
      )}
    </span>
  );
}
export function StudioChatFlightCard({
  flight,
  added,
  needsReview = false,
  priceStatus,
  disabled,
  onSelect,
  onDetails,
  selectLabel = 'Add to proposal',
  direction,
}: {
  flight: StudioFlightQuote;
  added: boolean;
  needsReview?: boolean;
  priceStatus?: StudioItem['priceStatus'];
  disabled: boolean;
  onSelect: () => void;
  onDetails: () => void;
  selectLabel?: string;
  direction?: StudioJourneyDirection;
}) {
  const expiry = flightExpiry(flight.expiresAt);
  const firstJourneyLabel =
    direction === 'return'
      ? 'Return'
      : direction === 'outbound' || flight.journeys?.length === 2
        ? 'Outbound'
        : 'Requested journey';
  const review =
    added &&
    (needsReview ||
      expiry.state === 'expired' ||
      Date.now() - Date.parse(flight.quotedAt) >= 30 * 60000);
  return (
    <article
      className="studio-chat-offer studio-chat-offer--flight"
      aria-label={`${flight.airline} flight option`}
      data-testid="studio-chat-flight-card"
    >
      <div className="studio-chat-offer__body">
        <div className="studio-chat-offer__flight-heading">
          <CarrierMark name={flight.airline} url={flight.airlineLogoUrl} />
          <div>
            <h4>{flight.airline}</h4>
            <span>
              {flight.origin} <ArrowRight size={12} /> {flight.destination}
            </span>
          </div>
          <Badge color={flight.mode === 'test' ? 'amber' : 'gray'}>
            {flight.mode === 'test'
              ? 'Sandbox fare'
              : flight.mode === 'provider'
                ? 'Provider mode unverified'
                : 'Supplier fare'}
          </Badge>
        </div>
        {review && <Badge color="amber">Review required</Badge>}
        {added && priceStatus === 'agent_estimate' && <Badge color="gray">Recorded estimate</Badge>}
        {(flight.journeys || []).map((journey, journeyIndex) => (
          <section
            key={journey.id}
            aria-label={
              journeyIndex === 0
                ? `${firstJourneyLabel === 'Requested journey' ? 'Requested' : firstJourneyLabel} flight legs`
                : 'Return flight legs'
            }
            className="studio-chat-offer__journey"
          >
            <div className="studio-chat-offer__eyebrow">
              <strong>
                {journeyIndex === 0
                  ? firstJourneyLabel
                  : journeyIndex === 1
                    ? 'Return'
                    : `Journey ${journeyIndex + 1}`}
              </strong>
              <span>
                {flightDuration(journey.duration)} ·{' '}
                {journey.connections
                  ? `${journey.connections} connection${journey.connections === 1 ? '' : 's'}`
                  : 'Nonstop'}
              </span>
            </div>
            {journey.segments.map((segment, index) => (
              <div key={segment.id}>
                {index > 0 && (
                  <p className="studio-chat-offer__connection">
                    {(() => {
                      const connection = flight.connections.find(
                        (value) =>
                          value.journeyId === journey.id &&
                          value.departure === segment.departure &&
                          value.departureAirport.code === segment.origin.code,
                      );
                      return connection ? (
                        <>
                          {connection.airportChange
                            ? `Airport change ${connection.arrivalAirport.code} → ${connection.departureAirport.code}`
                            : `Layover at ${connection.departureAirport.code}`}{' '}
                          ·{' '}
                          {connection.durationMinutes === null
                            ? 'duration not supplied'
                            : `${Math.floor(connection.durationMinutes / 60)}h ${connection.durationMinutes % 60}m`}
                          {connection.overnight ? ' · overnight' : ''}
                        </>
                      ) : (
                        <>Connection at {segment.origin.code} · duration not supplied</>
                      );
                    })()}
                  </p>
                )}
                <div className="studio-chat-offer__leg">
                  <div>
                    <strong>{flightTime(segment.departure)}</strong>
                    <span>{segment.origin.code}</span>
                    <small>{flightDate(segment.departure)}</small>
                  </div>
                  <div className="studio-chat-offer__leg-line">
                    <Plane size={14} />
                    <small>{flightDuration(segment.duration)}</small>
                  </div>
                  <div>
                    <strong>{flightTime(segment.arrival)}</strong>
                    <span>{segment.destination.code}</span>
                    <small>{flightDate(segment.arrival)}</small>
                  </div>
                </div>
                <p className="studio-chat-offer__muted">
                  {segment.marketingCarrier?.name ||
                    segment.operatingCarrier?.name ||
                    flight.airline}
                  {segment.marketingFlightNumber
                    ? ` · ${segment.marketingCarrier?.code || ''}${segment.marketingFlightNumber}`
                    : ''}
                  {segment.operatingCarrier &&
                  segment.marketingCarrier &&
                  segment.operatingCarrier.name !== segment.marketingCarrier.name
                    ? ` · operated by ${segment.operatingCarrier.name}`
                    : ''}
                </p>
              </div>
            ))}
          </section>
        ))}
        {!flight.journeys?.length && (
          <p className="studio-chat-offer__muted">
            {flightDate(flight.departure)} · {flightTime(flight.departure)} {flight.origin} →{' '}
            {flightTime(flight.arrival)} {flight.destination}. Leg details not supplied.
          </p>
        )}
        {(flight.connections || [])
          .filter((connection) => connection.kind === 'technical_stop')
          .map((connection, index) => (
            <p key={index} className="studio-chat-offer__connection">
              Technical stop at {connection.arrivalAirport.code}
              {connection.durationMinutes === null
                ? ' · duration not supplied'
                : ` · ${connection.durationMinutes}m`}
            </p>
          ))}
        <div className="studio-chat-offer__footer">
          <div>
            <QuotePrice price={flight.price} currency={flight.currency} />
            <small>
              {flight.priceScope === 'all_passengers_complete_journey'
                ? `${added ? 'Recorded total' : 'Total'} for ${flight.passengerCount || 'all'} travellers · ${flight.journeys?.length === 2 ? 'outbound + return' : 'requested journey'}`
                : 'Quoted total · passenger coverage not supplied'}
            </small>
          </div>
          <Button
            type="button"
            size="2"
            disabled={disabled || added || expiry.state === 'expired'}
            onClick={onSelect}
          >
            {added ? (
              <>
                <Check size={14} /> Added
              </>
            ) : (
              selectLabel
            )}
          </Button>
        </div>
        <button type="button" className="studio-chat-offer__text-button" onClick={onDetails}>
          Flight, baggage & fare details
        </button>
        {flight.advisories.length > 0 && (
          <details className="studio-chat-offer__details">
            <summary>Connections & arrival notes</summary>
            {flight.advisories.map((advisory, index) => (
              <p key={index}>{advisory.summary}</p>
            ))}
          </details>
        )}
        <small className="studio-chat-offer__muted">
          {added ? 'Saved quote · reconfirm current fare.' : expiry.label} Times are shown as
          supplied; confirm airport local times.
        </small>
      </div>
    </article>
  );
}
export function StudioChatCruiseCard({
  cruise,
  disabled,
  onReview,
}: {
  cruise: StudioCruiseDraft;
  disabled: boolean;
  onReview: () => void;
}) {
  const selected = cruise.days.slice(0, cruise.disembarkAfterDay ?? cruise.days.length);
  return (
    <article
      className="studio-chat-offer studio-chat-offer--cruise"
      aria-label={`${cruise.name} cruise plan`}
      data-testid="studio-chat-cruise-card"
    >
      <div className="studio-chat-offer__body">
        <div className="studio-chat-offer__flight-heading">
          <span className="studio-chat-offer__carrier">
            <Ship size={24} />
          </span>
          <div>
            <h4>{cruise.name}</h4>
            <p className="studio-chat-offer__muted">{cruise.ship || 'Ship not supplied'}</p>
          </div>
          <Badge color="gray">Reviewed itinerary</Badge>
        </div>
        <p>
          {selected[0]?.port} <ArrowRight size={12} /> {selected.at(-1)?.port}
        </p>
        <p className="studio-chat-offer__muted">
          {selected[0]?.date || 'Date not supplied'} –{' '}
          {selected.at(-1)?.date || 'Date not supplied'} · {selected.length} planned cruise days
        </p>
        <div className="studio-chat-offer__footer">
          <div>
            <QuotePrice price={cruise.fullFare} currency={cruise.currency} />
            <small>
              Recorded full cruise fare
              {selected.length < cruise.days.length ? ' · leaving early retains the full fare' : ''}
            </small>
          </div>
          <Button type="button" size="2" disabled={disabled} onClick={onReview}>
            Review sailing
          </Button>
        </div>
        <details className="studio-chat-offer__details">
          <summary>Ports & source</summary>
          {selected.map((day) => (
            <p key={day.id || day.day}>
              <strong>
                Day {day.day} · {day.port}
              </strong>
              {day.arrival ? ` · arrival ${day.arrival}` : ''}
              {day.departure ? ` · departure ${day.departure}` : ''}
            </p>
          ))}
          {studioChatMediaUrl(cruise.sourceUrl) && (
            <a href={cruise.sourceUrl} target="_blank" rel="noreferrer">
              {cruise.sourceName || 'Reviewed cruise source'}
            </a>
          )}
          <p>Recorded itinerary and fare; current cruise availability has not been searched.</p>
        </details>
      </div>
    </article>
  );
}

export default function StudioChatOffers(props: StudioChatOffersProps) {
  const {
    workspace,
    busy,
    hotelsEnabled,
    flightsEnabled,
    selectedKind,
    selectedStopId,
    onKindChange,
  } = props;
  const latest = useRef(props);
  latest.current = props;
  const [activeKind, setActiveKind] = useState<StudioChatOfferKind>('hotels');
  const [dialog, setDialog] = useState<{
    kind: StudioChatSearchKind;
    draft: StudioChatSearchDraft;
    planning?: boolean;
    journey?: StudioChatJourneyContext;
  } | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [showAll, setShowAll] = useState(false),
    [hotelFilter, setHotelFilter] = useState('');
  const [flightDetails, setFlightDetails] = useState<StudioFlightQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const noticeContext = useRef('');
  const [resolutionNotes, setResolutionNotes] = useState<{
    contextKey: string;
    notes: string[];
  } | null>(null);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    lock = useRef(false),
    operationContext = useRef('');
  const contextKey = studioChatQuoteContextKey(workspace);
  const hasSavedSupplier = workspace.items.some((item) => item.included && item.presentation);
  function cancel() {
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
    setWorking(false);
    latest.current.onBusyChange?.(false);
  }
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
      latest.current.onBusyChange?.(false);
    },
    [],
  );
  useEffect(() => {
    if (operationContext.current !== contextKey && lock.current) cancel();
    setBatch((current) => (current?.contextKey === contextKey ? current : null));
    setError('');
    setNotice((current) => (noticeContext.current === contextKey ? current : ''));
    setResolutionNotes((current) => (current?.contextKey === contextKey ? current : null));
    setShowAll(false);
  }, [contextKey]);
  useEffect(() => {
    setDialog(null);
    setActiveKind('hotels');
    setFlightDetails(null);
  }, [workspace.id]);
  useEffect(() => {
    if (!batch && !hasSavedSupplier) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [batch, hasSavedSupplier]);
  function choose(kind: StudioChatOfferKind, requestedStopId?: string | null) {
    if (busy || lock.current) return;
    setActiveKind(kind);
    setError('');
    if (kind !== 'cruises') {
      const currentProps = latest.current;
      const journey =
        kind === 'flights' &&
        (currentProps.journeyDirection || !currentProps.workspace.structureAccepted)
          ? {
              direction: currentProps.journeyDirection || 'outbound',
              optionId: currentProps.journeyOption?.id || '',
              inputKey:
                currentProps.workspace.journeySelections?.[
                  currentProps.journeyDirection || 'outbound'
                ]?.inputKey || '',
            }
          : undefined;
      const draft = studioChatSearchDraft(
        currentProps.workspace,
        journey ? { direction: journey.direction, option: currentProps.journeyOption } : undefined,
      );
      if (
        kind === 'hotels' &&
        requestedStopId &&
        latest.current.workspace.stops.some((stop) => stop.id === requestedStopId)
      )
        draft.stopId = requestedStopId;
      setDialog({
        kind,
        draft,
        planning: kind === 'flights' && !currentProps.workspace.structureAccepted,
        journey,
      });
    }
  }
  useEffect(() => {
    if (selectedKind && !busy && !working) {
      choose(selectedKind, selectedStopId);
      onKindChange?.(null);
    }
  }, [selectedKind, selectedStopId, busy, working, workspace.id]);
  function update(field: keyof StudioChatSearchDraft, value: string) {
    setError('');
    setDialog((current) =>
      current ? { ...current, draft: { ...current.draft, [field]: value } } : null,
    );
  }
  const batchCurrent =
    batch && batch.contextKey === studioChatQuoteContextKey(workspace, batch.journey);
  const batchExpired = Boolean(batch && now - batch.loadedAt >= 30 * 60000);
  function quoteExpired(quoteId: string, at = Date.now()) {
    const quotedAt = batch?.quotes.find((quote) => quote.id === quoteId)?.quotedAt;
    const stamp = quotedAt ? Date.parse(quotedAt) : NaN;
    const flight = batch?.flights?.flights.find((value) => value.quoteId === quoteId);
    return (
      (Number.isFinite(stamp) && at - stamp >= 30 * 60000) ||
      Boolean(flight && flightExpiry(flight.expiresAt, at).state === 'expired')
    );
  }
  const disabled = busy || working || (!workspace.structureAccepted && !batch?.planning);
  async function search(
    kind: StudioChatSearchKind,
    draft: StudioChatSearchDraft,
    offset = 0,
    base = latest.current.workspace,
    planning = false,
    journey?: StudioChatJourneyContext,
  ) {
    const operation = ++epoch.current,
      key = studioChatQuoteContextKey(base, journey);
    operationContext.current = studioChatQuoteContextKey(base);
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    lock.current = true;
    setWorking(true);
    setError('');
    setNotice('');
    latest.current.onBusyChange?.(true);
    if (!offset) {
      setBatch(null);
      setShowAll(false);
      setHotelFilter('');
    }
    try {
      // Let the parent's synchronous supplier lock interrupt pending background research.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (requestController.signal.aborted || operation !== epoch.current) return;
      const saved = latest.current.workspace;
      const current = saved.id === base.id && saved.revision >= base.revision ? saved : base;
      if (studioChatQuoteContextKey(current, journey) !== key) return;
      const body =
        kind === 'hotels'
          ? {
              revision: current.revision,
              stopId: draft.stopId,
              guestNationality: draft.nationality,
              ...(offset ? { offset } : {}),
            }
          : {
              revision: current.revision,
              ...(planning
                ? { stopId: draft.stopId, direction: journey?.direction || 'outbound' }
                : {}),
              origin: draft.origin.trim().toUpperCase(),
              destination: draft.destination.trim().toUpperCase(),
              departureDate: draft.departureDate,
              ...(draft.returnJourney === 'return' ? { returnDate: draft.returnDate } : {}),
              adults: current.brief.adults,
              cabinClass: draft.cabin,
            };
      const result = await api<StudioHotelSearchResult | StudioFlightSearchResult>(
        `/studio/workspaces/${base.id}/${planning ? 'journey/flights' : kind}/search`,
        { method: 'POST', body: JSON.stringify(body), signal: requestController.signal },
      );
      if (
        requestController.signal.aborted ||
        operation !== epoch.current ||
        key !== studioChatQuoteContextKey(latest.current.workspace, journey)
      )
        return;
      setBatch((previous) => {
        let hotels = kind === 'hotels' && 'hotels' in result ? result : undefined;
        let quotes = result.quotes;
        if (offset && previous?.hotels && hotels) {
          const existing = new Set(
            previous.hotels.hotels.map((hotel) =>
              JSON.stringify([
                hotel.hotelKey,
                hotel.room,
                hotel.board,
                hotel.price,
                hotel.currency,
                hotel.checkin,
                hotel.checkout,
              ]),
            ),
          );
          const extra = hotels.hotels.filter(
            (hotel) =>
              !existing.has(
                JSON.stringify([
                  hotel.hotelKey,
                  hotel.room,
                  hotel.board,
                  hotel.price,
                  hotel.currency,
                  hotel.checkin,
                  hotel.checkout,
                ]),
              ),
          );
          const ids = new Set(extra.map((hotel) => hotel.quoteId));
          quotes = [...previous.quotes, ...result.quotes.filter((quote) => ids.has(quote.id))];
          const combined = [...previous.hotels.hotels, ...extra];
          hotels = {
            ...hotels,
            quotes,
            hotels: combined,
            recommendations: previous.hotels.recommendations,
            inventory: {
              ...hotels.inventory,
              returnedHotels: new Set(combined.map((hotel) => hotel.hotelKey)).size,
              returnedQuotes: combined.length,
            },
          };
        }
        return {
          kind,
          contextKey: key,
          query: draft,
          loadedAt: Date.now(),
          quotes,
          hotels,
          flights: kind === 'flights' && 'flights' in result ? result : undefined,
          warning: result.warning,
          planning,
          journey,
        };
      });
      if (!result.quotes.length)
        setNotice(
          'No supplier options returned. Try different search details or add a reviewed quote.',
        );
    } catch (cause) {
      if (!requestController.signal.aborted && operation === epoch.current)
        setError((cause as Error).message);
    } finally {
      if (operation === epoch.current) {
        lock.current = false;
        setWorking(false);
        latest.current.onBusyChange?.(false);
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || busy || lock.current) return;
    let current = latest.current.workspace;
    if ((!current.structureAccepted || !current.stops.length) && !dialog.planning) {
      setError('Approve the route before searching supplier options.');
      return;
    }
    const { patch, error: missing } = studioChatSearchBriefPatch(
      current,
      dialog.draft,
      dialog.kind,
      dialog.journey,
    );
    if (missing) {
      setError(missing);
      return;
    }
    const draft = dialog.draft;
    const stop = current.stops.find((value) => value.id === draft.stopId);
    if (
      dialog.kind === 'hotels' &&
      (!stop?.arrivalDate || !stop.departureDate || !stop.country.trim())
    ) {
      setError('Confirm this stop’s country, check-in and check-out in the route.');
      return;
    }
    if (
      dialog.kind === 'flights' &&
      (!draft.returnJourney || (draft.returnJourney === 'return' && !draft.returnDate))
    ) {
      setError('Confirm one-way or return travel, and the return date when needed.');
      return;
    }
    lock.current = true;
    setWorking(true);
    setError('');
    let startedSearch = false;
    try {
      if (Object.keys(patch).length) {
        const saved = await latest.current.onSaveBrief(patch);
        if (!saved || saved.id !== current.id) {
          setError('These trip details were not saved. Try again.');
          return;
        }
        const remaining = studioChatSearchBriefPatch(saved, draft, dialog.kind, dialog.journey);
        if (remaining.error || Object.keys(remaining.patch).length) {
          setError('These trip details were not saved. Try again.');
          return;
        }
        current = saved;
        // Let a guarded parent publish the saved revision before the request starts.
        latest.current = { ...latest.current, workspace: saved };
      }
      setDialog(null);
      lock.current = false;
      startedSearch = true;
      await search(dialog.kind, draft, 0, current, Boolean(dialog.planning), dialog.journey);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      if (!startedSearch) {
        lock.current = false;
        setWorking(false);
      }
    }
  }
  async function select(quoteId: string) {
    if (
      busy ||
      lock.current ||
      !batch ||
      batch.contextKey !== studioChatQuoteContextKey(latest.current.workspace, batch.journey) ||
      batchExpired ||
      quoteExpired(quoteId)
    )
      return;
    const operation = ++epoch.current,
      key = batch.contextKey,
      id = latest.current.workspace.id;
    operationContext.current = studioChatQuoteContextKey(latest.current.workspace);
    const requestController = new AbortController();
    controller.current = requestController;
    lock.current = true;
    setWorking(true);
    setError('');
    latest.current.onBusyChange?.(true);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (requestController.signal.aborted || operation !== epoch.current) return;
      let result: { workspace: StudioWorkspace; dateResolution?: JourneyDateResolution };
      try {
        result = await api(
          `/studio/workspaces/${id}/${batch.planning ? 'journey/' : ''}quotes/${quoteId}`,
          {
            method: 'POST',
            body: JSON.stringify({
              revision: latest.current.workspace.revision,
              ...(batch.planning ? { direction: batch.journey?.direction || 'outbound' } : {}),
            }),
            signal: requestController.signal,
          },
        );
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        const recovered = await api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${id}`, {
          signal: requestController.signal,
        });
        if (operation !== epoch.current || latest.current.workspace.id !== id) return;
        latest.current.onUpdateWorkspace(recovered.workspace);
        if (studioChatQuoteContextKey(recovered.workspace, batch.journey) !== key) {
          setBatch(null);
          throw cause;
        }
        result = await api(
          `/studio/workspaces/${id}/${batch.planning ? 'journey/' : ''}quotes/${quoteId}`,
          {
            method: 'POST',
            body: JSON.stringify({
              revision: recovered.workspace.revision,
              ...(batch.planning ? { direction: batch.journey?.direction || 'outbound' } : {}),
            }),
            signal: requestController.signal,
          },
        );
      }
      if (
        operation !== epoch.current ||
        requestController.signal.aborted ||
        latest.current.workspace.id !== id ||
        studioChatQuoteContextKey(latest.current.workspace, batch.journey) !== key
      )
        return;
      latest.current.onUpdateWorkspace(result.workspace);
      noticeContext.current = studioChatQuoteContextKey(result.workspace);
      const resolution = result.dateResolution;
      setResolutionNotes(
        resolution?.notes.length
          ? { contextKey: noticeContext.current, notes: resolution.notes }
          : null,
      );
      setNotice(
        batch.planning
          ? resolution && batch.journey?.direction !== 'return' && !resolution.arrivalDate
            ? 'Schedule saved; local arrival still needs confirmation.'
            : resolution && batch.journey?.direction === 'return' && !resolution.returnDepartureDate
              ? 'Schedule saved; local return departure still needs confirmation.'
              : 'Schedule saved. Review the supplied travel dates and stay nights before confirming the route.'
          : 'Added to the proposal.',
      );
    } catch (cause) {
      if (!requestController.signal.aborted && operation === epoch.current)
        setError((cause as Error).message);
    } finally {
      if (operation === epoch.current) {
        lock.current = false;
        setWorking(false);
        latest.current.onBusyChange?.(false);
      }
    }
  }
  const displayedHotels =
    batchCurrent && batch.hotels
      ? (() => {
          const picks = new Set(batch.hotels.recommendations.picks.map((pick) => pick.quoteId));
          const candidates = showAll
            ? batch.hotels.hotels
            : picks.size
              ? batch.hotels.hotels.filter((hotel) => picks.has(hotel.quoteId))
              : batch.hotels.hotels.slice(0, 4);
          return candidates.filter((hotel) =>
            [hotel.name, hotel.room, hotel.address]
              .join(' ')
              .toLowerCase()
              .includes(hotelFilter.toLowerCase()),
          );
        })()
      : [];
  const batchIds = new Set(batchCurrent ? batch.quotes.map((quote) => quote.id) : []);
  const saved = workspace.items.filter(
    (item) => item.included && item.presentation && !batchIds.has(item.id),
  );
  const selected = (id: string) => workspace.items.some((item) => item.id === id && item.included);
  const b = workspace.brief,
    d = dialog?.draft;
  function input(
    field: keyof StudioChatSearchDraft,
    label: string,
    type: 'text' | 'number' | 'date' = 'text',
    options: {
      min?: number | string;
      max?: number;
      pattern?: string;
      maxLength?: number;
      required?: boolean;
    } = {},
  ) {
    return (
      <label className="studio-chat-offers__field">
        <span>{label}</span>
        <TextField.Root
          type={type}
          value={String(d?.[field] || '')}
          onChange={(event) => update(field, event.target.value)}
          required
          {...options}
        />
      </label>
    );
  }
  return (
    <section
      className="studio-chat-offers"
      aria-label="Supplier options in chat"
      data-testid="studio-chat-offers"
    >
      {props.showActions !== false && (
        <div className="studio-chat-offers__actions">
          <Button
            type="button"
            variant="soft"
            size="2"
            disabled={busy || working || !hotelsEnabled}
            onClick={() => choose('hotels')}
          >
            <BedDouble size={14} /> Find hotels
          </Button>
          <Button
            type="button"
            variant="soft"
            size="2"
            disabled={busy || working || !flightsEnabled}
            onClick={() => choose('flights')}
          >
            <Plane size={14} /> Find flights
          </Button>
          <Button
            type="button"
            variant="soft"
            size="2"
            disabled={busy || working}
            onClick={() => choose('cruises')}
          >
            <Ship size={14} /> Cruise plans
          </Button>
          <Button
            type="button"
            variant="soft"
            size="2"
            disabled={busy || working}
            onClick={props.onPlanActivities}
          >
            <Sparkles size={14} /> Daily activities
          </Button>
        </div>
      )}
      {working && (
        <div className="studio-chat-offers__status" role="status">
          <span>Checking supplier options…</span>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="studio-chat-offers__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="studio-chat-offers__status" role="status">
          {notice}
        </p>
      )}
      {resolutionNotes && resolutionNotes.notes.length > 0 && (
        <details className="studio-chat-offer__details">
          <summary>Schedule review notes</summary>
          {resolutionNotes.notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </details>
      )}
      {batchCurrent && batch.hotels && (
        <div className="studio-chat-offers__results" aria-label="Hotel options">
          <div className="studio-chat-offers__result-heading">
            <h3>
              {showAll || !batch.hotels.recommendations.picks.length
                ? 'Returned hotel rooms'
                : 'Hotels for this trip'}
            </h3>
            <button
              type="button"
              onClick={() => setDialog({ kind: 'hotels', draft: batch.query })}
              disabled={busy || working}
            >
              Change search
            </button>
          </div>
          <div className="studio-chat-offers__cards">
            {displayedHotels.map((hotel) => (
              <StudioChatHotelCard
                key={hotel.quoteId}
                hotel={hotel}
                reason={
                  batch.hotels?.recommendations.picks.find((pick) => pick.quoteId === hotel.quoteId)
                    ?.reason
                }
                added={selected(hotel.quoteId)}
                needsReview={workspace.items.find((item) => item.id === hotel.quoteId)?.needsReview}
                priceStatus={workspace.items.find((item) => item.id === hotel.quoteId)?.priceStatus}
                disabled={
                  disabled || !batchCurrent || batchExpired || quoteExpired(hotel.quoteId, now)
                }
                onSelect={() => void select(hotel.quoteId)}
              />
            ))}
          </div>
          {!showAll && batch.hotels.hotels.length > displayedHotels.length && (
            <Button type="button" variant="ghost" onClick={() => setShowAll(true)}>
              See all {batch.hotels.hotels.length} room quotes
            </Button>
          )}
          {showAll && (
            <label className="studio-chat-offers__field">
              <span>Filter hotel or room</span>
              <TextField.Root
                value={hotelFilter}
                onChange={(event) => setHotelFilter(event.target.value)}
              />
            </label>
          )}
          {batch.hotels.inventory.nextOffset !== null &&
            batch.hotels.inventory.nextOffset !== undefined && (
              <Button
                type="button"
                size="2"
                variant="soft"
                disabled={busy || working || batchExpired}
                onClick={() =>
                  void search('hotels', batch.query, batch.hotels!.inventory.nextOffset!)
                }
              >
                More hotel options
              </Button>
            )}
          <details className="studio-chat-offer__details">
            <summary>Search coverage & supplier terms</summary>
            <p>
              {batch.hotels.inventory.returnedHotels} returned hotels ·{' '}
              {batch.hotels.inventory.returnedQuotes} room quotes within{' '}
              {batch.hotels.inventory.searchRadiusKm} km.
              {batch.hotels.inventory.incomplete ? ' Some supplier pages were unavailable.' : ''}
            </p>
            <p>{batch.warning}</p>
          </details>
        </div>
      )}
      {batchCurrent && batch.kind === 'flights' && (
        <div className="studio-chat-offers__results" aria-label="Flight options">
          <div className="studio-chat-offers__result-heading">
            <h3>Flight options</h3>
            <button
              type="button"
              disabled={busy || working}
              onClick={() =>
                setDialog({
                  kind: 'flights',
                  draft: batch.query,
                  planning: batch.planning,
                  journey: batch.journey,
                })
              }
            >
              Change search
            </button>
          </div>
          <div className="studio-chat-offers__cards">
            {batch.flights?.flights?.map((flight) => (
              <StudioChatFlightCard
                key={flight.quoteId}
                flight={flight}
                added={selected(flight.quoteId)}
                needsReview={
                  workspace.items.find((item) => item.id === flight.quoteId)?.needsReview
                }
                priceStatus={
                  workspace.items.find((item) => item.id === flight.quoteId)?.priceStatus
                }
                disabled={
                  disabled || !batchCurrent || batchExpired || quoteExpired(flight.quoteId, now)
                }
                onSelect={() => void select(flight.quoteId)}
                onDetails={() => setFlightDetails(flight)}
                selectLabel={batch.planning ? 'Use flight dates' : 'Add to proposal'}
                direction={batch.journey?.direction}
              />
            ))}
            {!batch.flights?.flights?.length &&
              batch.quotes.map((quote) => (
                <article key={quote.id} className="studio-chat-offer" aria-label={quote.title}>
                  <div className="studio-chat-offer__body">
                    <Badge color={quote.priceStatus === 'sandbox' ? 'amber' : 'gray'}>
                      {quote.priceStatus === 'sandbox' ? 'Sandbox fare' : 'Supplier fare'}
                    </Badge>
                    <h4>{quote.title}</h4>
                    <p>{quote.description}</p>
                    <QuotePrice price={quote.price} currency={quote.currency} />
                    <p className="studio-chat-offer__muted">Supplier leg details not supplied.</p>
                    <Button
                      type="button"
                      disabled={
                        disabled ||
                        batchExpired ||
                        quoteExpired(quote.id, now) ||
                        selected(quote.id)
                      }
                      onClick={() => void select(quote.id)}
                    >
                      {selected(quote.id)
                        ? 'Added'
                        : batch.planning
                          ? 'Use flight dates'
                          : 'Add to proposal'}
                    </Button>
                  </div>
                </article>
              ))}
          </div>
          <details className="studio-chat-offer__details">
            <summary>Supplier terms</summary>
            <p>{batch.warning}</p>
          </details>
        </div>
      )}
      {batchExpired && (
        <p role="status">These search prices have expired. Search again for current options.</p>
      )}
      {saved.length > 0 && (
        <div className="studio-chat-offers__results" aria-label="Included supplier options">
          <h3>Included in this proposal</h3>
          <div className="studio-chat-offers__cards">
            {saved.map((item) =>
              item.presentation?.kind === 'hotel' ? (
                <StudioChatHotelCard
                  key={item.id}
                  hotel={item.presentation.hotel}
                  added
                  needsReview={item.needsReview}
                  priceStatus={item.priceStatus}
                  disabled={busy || working}
                  onSelect={() => {}}
                />
              ) : item.presentation?.kind === 'flight' ? (
                <StudioChatFlightCard
                  key={item.id}
                  flight={item.presentation.flight}
                  added
                  needsReview={item.needsReview}
                  priceStatus={item.priceStatus}
                  disabled={busy || working}
                  onSelect={() => {}}
                  onDetails={() =>
                    setFlightDetails(
                      item.presentation!.kind === 'flight' ? item.presentation!.flight : null,
                    )
                  }
                />
              ) : null,
            )}
          </div>
        </div>
      )}
      {activeKind === 'cruises' && (
        <div className="studio-chat-offers__results" aria-label="Reviewed cruise plans">
          <div className="studio-chat-offers__result-heading">
            <h3>Cruise plans</h3>
            <button type="button" disabled={busy || working} onClick={() => props.onOpenCruise()}>
              Import a sailing
            </button>
          </div>
          <div className="studio-chat-offers__cards">
            {workspace.cruises?.map((cruise) => (
              <StudioChatCruiseCard
                key={cruise.id}
                cruise={cruise}
                disabled={busy || working}
                onReview={() => props.onOpenCruise(cruise.id)}
              />
            ))}
          </div>
          {!workspace.cruises?.length && (
            <p className="studio-chat-offer__muted">
              Bring in a cruise itinerary or supplier quote to review its ports, dates and full
              fare.
            </p>
          )}
        </div>
      )}
      {dialog && d && (
        <Modal
          title={dialog.kind === 'hotels' ? 'Hotel options' : 'Flight options'}
          onClose={() => {
            if (working) cancel();
            setDialog(null);
          }}
        >
          <form onSubmit={(event) => void submit(event)} className="studio-chat-offers__search">
            <fieldset disabled={busy || working}>
              {(!workspace.structureAccepted || !workspace.stops.length) && !dialog.planning ? (
                <>
                  <p>Approve the destinations and dates before comparing supplier options.</p>
                  <Button
                    type="button"
                    onClick={() => {
                      setDialog(null);
                      props.onEditRoute();
                    }}
                  >
                    Review the route
                  </Button>
                </>
              ) : (
                <>
                  {dialog.planning && (
                    <p className="studio-chat-offer__muted">
                      Compare {dialog.journey?.direction === 'return' ? 'return' : 'outward'}{' '}
                      supplier flight schedules. Choosing a quote fills travel dates; confirm stay
                      nights separately.
                    </p>
                  )}
                  <p className="studio-chat-offer__muted">
                    {b.adults === null ? 'Adults to confirm' : `${b.adults} adults`}
                    {b.children === null
                      ? ' · children to confirm'
                      : b.children
                        ? ` + ${b.children} children`
                        : ' · no children'}
                    {dialog.kind === 'hotels' ? ` · ${b.hotelStandard} · ${b.hotelLocation}` : ''}
                  </p>
                  <div className="studio-chat-offers__search-grid">
                    {b.adults === null &&
                      input('adults', 'Adults for this trip', 'number', { min: 1, max: 100 })}
                    {b.children === null && (
                      <label className="studio-chat-offers__field">
                        <span>Children for this trip</span>
                        <TextField.Root
                          type="number"
                          min={0}
                          max={30}
                          required
                          value={d.children}
                          onChange={(event) => update('children', event.target.value)}
                        />
                        <button
                          className="studio-chat-offer__text-button"
                          type="button"
                          onClick={() => update('children', '0')}
                        >
                          No children
                        </button>
                      </label>
                    )}
                    {dialog.kind === 'hotels' &&
                      Number(d.children) > 0 &&
                      b.childAges.length !== Number(d.children) &&
                      input('childAges', 'Children’s ages · comma separated')}
                    {dialog.kind === 'hotels' ? (
                      <>
                        <label className="studio-chat-offers__field studio-chat-offers__field--wide">
                          <span>Destination for this stay</span>
                          <select
                            aria-label="Destination for this stay"
                            value={d.stopId}
                            onChange={(event) => update('stopId', event.target.value)}
                            required
                          >
                            {workspace.stops.map((stop) => (
                              <option key={stop.id} value={stop.id}>
                                {stop.name} · {readableDate(stop.arrivalDate)} –{' '}
                                {readableDate(stop.departureDate)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="studio-chat-offers__field studio-chat-offers__field--wide">
                          <span>Confirm guest nationality</span>
                          <select
                            aria-label="Confirm guest nationality"
                            value={d.nationality}
                            onChange={(event) => update('nationality', event.target.value)}
                            required
                          >
                            <option value="">Choose nationality</option>
                            {studioCountries.map((country) => (
                              <option key={country.code} value={country.code}>
                                {country.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!b.hotelStandard.trim() &&
                          input('hotelStandard', 'Hotel standard', 'text', { maxLength: 300 })}
                        {!b.hotelLocation.trim() &&
                          input('hotelLocation', 'Hotel location', 'text', { maxLength: 300 })}
                        {(!workspace.stops.find((stop) => stop.id === d.stopId)?.arrivalDate ||
                          !workspace.stops.find((stop) => stop.id === d.stopId)?.departureDate ||
                          !workspace.stops
                            .find((stop) => stop.id === d.stopId)
                            ?.country.trim()) && (
                          <Button
                            type="button"
                            onClick={() => {
                              setDialog(null);
                              props.onEditRoute();
                            }}
                          >
                            Set stay dates & country
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        {input('origin', 'Origin airport code', 'text', {
                          pattern: '[A-Za-z]{3}',
                          maxLength: 3,
                        })}
                        {input('destination', 'Destination airport code', 'text', {
                          pattern: '[A-Za-z]{3}',
                          maxLength: 3,
                        })}
                        {input('departureDate', 'Flight departure date', 'date')}
                        <label className="studio-chat-offers__field">
                          <span>Cabin for this search</span>
                          <select
                            aria-label="Cabin for this search"
                            value={d.cabin}
                            onChange={(event) => update('cabin', event.target.value)}
                            required
                          >
                            <option value="">Choose cabin</option>
                            <option value="economy">Economy</option>
                            <option value="premium_economy">Premium economy</option>
                            <option value="business">Business</option>
                            <option value="first">First</option>
                          </select>
                        </label>
                        <label className="studio-chat-offers__field">
                          <span>Flight journey</span>
                          <select
                            aria-label="Flight journey"
                            value={d.returnJourney}
                            onChange={(event) => update('returnJourney', event.target.value)}
                            required
                          >
                            <option value="">Choose journey</option>
                            <option value="one_way">One-way</option>
                            <option value="return">Outbound & return</option>
                          </select>
                        </label>
                        {d.returnJourney === 'return' &&
                          input('returnDate', 'Return departure date', 'date', {
                            min: d.departureDate || undefined,
                          })}
                        {d.returnJourney === 'return' && (
                          <p className="studio-chat-offer__muted studio-chat-offers__field--wide">
                            Return uses {d.destination.toUpperCase() || 'destination airport'} →{' '}
                            {d.origin.toUpperCase() || 'origin airport'}. Different return airports
                            need a reviewed supplier quote.
                          </p>
                        )}
                        {Number(d.children) > 0 && (
                          <p className="studio-chat-offers__error studio-chat-offers__field--wide">
                            Family flights need a reviewed supplier quote; automatic fares support
                            adults only.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  {error && (
                    <p role="alert" className="studio-chat-offers__error">
                      {error}
                    </p>
                  )}
                  <div className="studio-chat-offers__search-footer">
                    <Button
                      type="submit"
                      loading={working}
                      disabled={
                        busy || working || (dialog.kind === 'flights' && Number(d.children) > 0)
                      }
                    >
                      {dialog.kind === 'hotels'
                        ? 'Search available hotels'
                        : 'Search available flights'}
                    </Button>
                    {props.onAddManualService && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const kind = dialog.kind === 'hotels' ? 'hotel' : 'flight';
                          setDialog(null);
                          props.onAddManualService?.(kind);
                        }}
                      >
                        Use a supplier quote
                      </Button>
                    )}
                  </div>
                </>
              )}
            </fieldset>
          </form>
        </Modal>
      )}
      {flightDetails && (
        <FlightDetails offer={flightDetails} onClose={() => setFlightDetails(null)} />
      )}
    </section>
  );
}

export { StudioChatOffers };
