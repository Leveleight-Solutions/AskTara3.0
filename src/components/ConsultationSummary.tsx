import type { ReactNode } from 'react';
import { CalendarDays, Edit3, MapPin, Users, Wallet } from 'lucide-react';
import { Button, Card, DataList, Flex, Heading, Text } from '@radix-ui/themes';
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

function FactLabel({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Flex align="center" gap="1" asChild>
      <span>
        {icon}
        {children}
      </span>
    </Flex>
  );
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
    <Card size="3" m="4" data-testid="consultation-summary">
      <Flex direction="column" gap="3" align="start">
        <Text size="1" color="gray" weight="medium">
          YOUR TRIP, TAKING SHAPE
        </Text>
        <Heading size="6" as="h2">
          {destination ? `Let’s plan ${destination}.` : 'Let’s make this your trip.'}
        </Heading>
        <Text as="p" size="2" color="gray">
          We’ll build your itinerary around the details you share.
        </Text>
        <DataList.Root size="2" orientation={{ initial: 'vertical', sm: 'horizontal' }} my="2">
          <DataList.Item>
            <DataList.Label minWidth="160px">
              <FactLabel icon={<MapPin size={16} />}>Destination</FactLabel>
            </DataList.Label>
            <DataList.Value>{destination || 'Still exploring'}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">
              <FactLabel icon={<CalendarDays size={16} />}>Dates</FactLabel>
            </DataList.Label>
            <DataList.Value>
              {consultation.facts.dates
                ? consultation.facts.dates.valueState === 'flexible'
                  ? 'Flexible'
                  : readableDate(trip.startDate)
                : 'Not discussed'}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">Length of trip</DataList.Label>
            <DataList.Value>
              {consultation.facts.duration
                ? consultation.facts.duration.valueState === 'flexible'
                  ? 'Flexible'
                  : `${trip.days} days`
                : 'Not discussed'}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">
              <FactLabel icon={<Users size={16} />}>Travellers</FactLabel>
            </DataList.Label>
            <DataList.Value>
              {consultation.facts.travelers ? `${trip.travelers} travellers` : 'Not discussed'}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">
              <FactLabel icon={<Wallet size={16} />}>Group budget</FactLabel>
            </DataList.Label>
            <DataList.Value>{consultationBudget(trip)}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">Flights</DataList.Label>
            <DataList.Value>{serviceLabels[consultation.services.flights.status]}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="160px">Accommodation</DataList.Label>
            <DataList.Value>{serviceLabels[consultation.services.hotels.status]}</DataList.Value>
          </DataList.Item>
        </DataList.Root>
        {consultation.party?.hasChildren && (
          <Text as="p" size="2" color="gray">
            Children travelling
            {consultation.party.childAges.length
              ? ` · ages ${consultation.party.childAges.join(', ')}`
              : ' · ages to confirm'}
            .
          </Text>
        )}
        {onSettings && (
          <Button
            variant="soft"
            size="3"
            onClick={onSettings}
            disabled={disabled}
            aria-label="Edit trip details"
          >
            <Edit3 size={15} /> Add or edit details
          </Button>
        )}
        <Text as="p" size="1" color="gray">
          Your conversation stays here. Once the essentials are clear, your day-by-day plan will
          appear alongside it.
        </Text>
      </Flex>
    </Card>
  );
}
