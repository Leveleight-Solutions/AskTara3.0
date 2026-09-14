import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Plane, Luggage } from 'lucide-react';
import type { FlightOffer, FlightSegment } from '../../shared/types';
import {
  flightDate,
  flightDuration,
  flightExpiry,
  flightPrice,
  flightTime,
} from '../../shared/flights';
import { Modal } from './ui';
import './flight-details.css';

function carrierLabel(segment: FlightSegment) {
  const carrier = segment.marketingCarrier || segment.operatingCarrier;
  const number = segment.marketingCarrier
    ? segment.marketingFlightNumber
    : segment.operatingFlightNumber;
  return `${carrier?.name || 'Airline unavailable'}${number ? ` · ${carrier?.code || ''}${number}` : ''}`;
}
export default function FlightDetails({
  offer,
  onClose,
}: {
  offer: FlightOffer;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const expiry = flightExpiry(offer.expiresAt, now);
  const journeys = offer.journeys || [];
  const incomplete = offer.requestedJourneyCount && journeys.length < offer.requestedJourneyCount;
  return (
    <Modal title="Flight details" onClose={onClose} wide>
      <div className="flight-details">
        <div className="flight-detail-total">
          <div>
            <span className="eyebrow">
              {offer.liveMode === false ? 'Simulated offer' : 'Flight quote'}
            </span>
            <h3>
              {offer.origin} <ArrowRight size={20} /> {offer.destination}
            </h3>
          </div>
          <div>
            <strong>{flightPrice(offer)}</strong>
            <span>
              {offer.currency} · total
              {offer.passengerCount
                ? ` for ${offer.passengerCount} traveler${offer.passengerCount === 1 ? '' : 's'}`
                : ' for all travelers'}
            </span>
          </div>
        </div>
        <p
          className={`flight-detail-expiry ${expiry.state === 'expired' ? 'expired' : ''}`}
          role="status"
        >
          <Clock3 size={16} />
          {expiry.label}
        </p>
        <p className="flight-detail-intro">
          Total covers all requested journeys and travelers, including taxes. Optional extras are
          excluded. No reservation has been made. Times below are local to each airport.
        </p>
        {!!incomplete && (
          <p className="notice">
            The provider returned details for {journeys.length} of {offer.requestedJourneyCount}{' '}
            requested journeys. Search again before relying on this option.
          </p>
        )}
        {journeys.length === 0 && (
          <div className="flight-detail-legacy">
            <p>
              {flightDate(offer.departure)} · {flightTime(offer.departure)} {offer.origin} →{' '}
              {flightTime(offer.arrival)} {offer.destination}
            </p>
            <p>
              Segment and return details were not saved with this quote. Search again for a complete
              flight breakdown.
            </p>
          </div>
        )}
        {journeys.map((journey, journeyIndex) => (
          <section
            className="flight-detail-journey"
            key={journey.id}
            aria-label={
              journeyIndex === 0
                ? 'Outbound journey'
                : journeyIndex === 1 && journeys.length === 2
                  ? 'Return journey'
                  : `Journey ${journeyIndex + 1}`
            }
          >
            <div className="flight-detail-journey-heading">
              <div>
                <span className="eyebrow">
                  {journeyIndex === 0
                    ? 'Outbound'
                    : journeyIndex === 1 && journeys.length === 2
                      ? 'Return'
                      : `Journey ${journeyIndex + 1}`}
                </span>
                <h3>
                  {journey.origin.code} <ArrowRight size={16} /> {journey.destination.code}
                </h3>
              </div>
              <span>
                {flightDuration(journey.duration)} ·{' '}
                {journey.stops === 0
                  ? 'Nonstop'
                  : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
              </span>
            </div>
            {journey.segments.map((segment, segmentIndex) => (
              <div key={segment.id}>
                {segmentIndex > 0 && (
                  <p className="flight-detail-connection">
                    {journey.segments[segmentIndex - 1].destination.code === segment.origin.code
                      ? `Connection at ${segment.origin.name || segment.origin.code}`
                      : `Airport change: ${journey.segments[segmentIndex - 1].destination.code} to ${segment.origin.code}`}
                    . Next departure {flightDate(segment.departure)},{' '}
                    {flightTime(segment.departure)}.
                  </p>
                )}
                <article className="flight-detail-segment">
                  <h4>
                    <Plane size={15} />
                    {carrierLabel(segment)}
                  </h4>
                  {segment.operatingCarrier &&
                    segment.marketingCarrier &&
                    (segment.operatingCarrier.name !== segment.marketingCarrier.name ||
                      segment.operatingFlightNumber !== segment.marketingFlightNumber) && (
                      <p className="flight-detail-operated">
                        Operated by {segment.operatingCarrier.name}
                        {segment.operatingFlightNumber
                          ? ` · ${segment.operatingCarrier.code || ''}${segment.operatingFlightNumber}`
                          : ''}
                      </p>
                    )}
                  <div className="flight-detail-airports">
                    <div>
                      <strong>{flightTime(segment.departure)}</strong>
                      <span>{flightDate(segment.departure)}</span>
                      <b>
                        {segment.origin.code} · {segment.origin.name || 'Airport name unavailable'}
                      </b>
                      {segment.originTerminal && <small>Terminal {segment.originTerminal}</small>}
                    </div>
                    <ArrowRight size={18} />
                    <div>
                      <strong>{flightTime(segment.arrival)}</strong>
                      <span>{flightDate(segment.arrival)}</span>
                      <b>
                        {segment.destination.code} ·{' '}
                        {segment.destination.name || 'Airport name unavailable'}
                      </b>
                      {segment.destinationTerminal && (
                        <small>Terminal {segment.destinationTerminal}</small>
                      )}
                    </div>
                  </div>
                  <p className="flight-detail-duration">{flightDuration(segment.duration)}</p>
                  {segment.stops?.map((stop, index) => (
                    <p className="flight-detail-operated" key={`${stop.airport.code}-${index}`}>
                      Intermediate stop at {stop.airport.name || stop.airport.code}
                      {stop.duration ? ` · ${flightDuration(stop.duration)}` : ''}. Check the
                      airline’s instructions for this stop.
                    </p>
                  ))}
                  <div className="flight-detail-baggage">
                    <Luggage size={15} />
                    <div>
                      {segment.passengers?.length ? (
                        segment.passengers.map((passenger, index) => (
                          <p key={`${passenger.passengerId}-${index}`}>
                            <strong>Traveler {index + 1}</strong>
                            {passenger.cabin ? ` · ${passenger.cabin.replaceAll('_', ' ')}` : ''}
                            <span>
                              {passenger.baggages?.length
                                ? passenger.baggages
                                    .map(
                                      (bag) =>
                                        `${bag.quantity} ${bag.type.replaceAll('_', '-')} bag${bag.quantity === 1 ? '' : 's'}`,
                                    )
                                    .join(' · ')
                                : 'Baggage allowance not supplied'}
                            </span>
                          </p>
                        ))
                      ) : (
                        <p>Baggage allowance not supplied</p>
                      )}
                    </div>
                  </div>
                </article>
              </div>
            ))}
          </section>
        ))}
        <p className="flight-detail-intro">
          Fare conditions and baggage may change when the airline reprices the offer. Flight
          purchase and ticketing are not available in Asktara yet.
        </p>
        <button className="button" onClick={onClose}>
          Back to planning
        </button>
      </div>
    </Modal>
  );
}
