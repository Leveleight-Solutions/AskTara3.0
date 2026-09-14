import { CalendarDays, Edit3, MapPin, Users, Wallet } from 'lucide-react';
import type { Trip } from '../../shared/types';
import { getConsultation } from '../../shared/consultation';
import { findDestination } from '../../shared/destinations';
import { money, readableDate } from '../api';
import { serviceLabels } from './PlanningDetails';

export function consultationBudget(trip: Trip) {
  const consultation = getConsultation(trip);
  if (!consultation.facts.budget) return 'Not discussed';
  if (consultation.facts.budget.valueState === 'flexible') return 'Flexible';
  return `${money(trip.budget, consultation.currency)} ${consultation.currency}`;
}

export default function ConsultationSummary({
  trip,
  onSettings,
  disabled,
}: {
  trip: Trip;
  onSettings?: () => void;
  disabled?: boolean;
}) {
  const consultation = getConsultation(trip);
  const destination =
    findDestination(trip.destinationId, trip)?.name ||
    consultation.route?.map((stop) => stop.name).join(' & ');
  return (
    <div className="consultation-summary">
      <span className="eyebrow">YOUR TRIP, TAKING SHAPE</span>
      <h2>{destination ? `Let’s plan ${destination}.` : 'Let’s make this your trip.'}</h2>
      <p>We’ll build your itinerary around the details you share.</p>
      <dl className="consultation-facts">
        <div>
          <dt>
            <MapPin size={16} /> Destination
          </dt>
          <dd>{destination || 'Still exploring'}</dd>
        </div>
        <div>
          <dt>
            <CalendarDays size={16} /> Dates
          </dt>
          <dd>
            {consultation.facts.dates
              ? consultation.facts.dates.valueState === 'flexible'
                ? 'Flexible'
                : readableDate(trip.startDate)
              : 'Not discussed'}
          </dd>
        </div>
        <div>
          <dt>Length of trip</dt>
          <dd>
            {consultation.facts.duration
              ? consultation.facts.duration.valueState === 'flexible'
                ? 'Flexible'
                : `${trip.days} days`
              : 'Not discussed'}
          </dd>
        </div>
        <div>
          <dt>
            <Users size={16} /> Travellers
          </dt>
          <dd>{consultation.facts.travelers ? `${trip.travelers} travellers` : 'Not discussed'}</dd>
        </div>
        <div>
          <dt>
            <Wallet size={16} /> Group budget
          </dt>
          <dd>{consultationBudget(trip)}</dd>
        </div>
        <div>
          <dt>Flights</dt>
          <dd>{serviceLabels[consultation.services.flights.status]}</dd>
        </div>
        <div>
          <dt>Accommodation</dt>
          <dd>{serviceLabels[consultation.services.hotels.status]}</dd>
        </div>
      </dl>
      {consultation.party?.hasChildren && (
        <p className="muted">
          Children travelling
          {consultation.party.childAges.length
            ? ` · ages ${consultation.party.childAges.join(', ')}`
            : ' · ages to confirm'}
          .
        </p>
      )}
      {onSettings && (
        <button
          className="button button-secondary"
          onClick={onSettings}
          disabled={disabled}
          aria-label="Edit trip details"
        >
          <Edit3 size={15} /> Add or edit details
        </button>
      )}
      <p className="consultation-next">
        Your conversation stays here. Once the essentials are clear, your day-by-day plan will
        appear alongside it.
      </p>
    </div>
  );
}
