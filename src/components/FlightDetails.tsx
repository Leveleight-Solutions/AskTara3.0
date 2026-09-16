import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, Plane, Luggage } from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Separator,
  Text,
} from '@radix-ui/themes';
import type { FlightOffer, FlightSegment } from '../../shared/types';
import {
  flightDate,
  flightDuration,
  flightExpiry,
  flightPrice,
  flightTime,
} from '../../shared/flights';
import { Modal } from './ui';

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
      <Flex direction="column" gap="4" mt="3">
        <Flex align="end" justify="between" gap="4" wrap="wrap">
          <Box>
            {offer.liveMode === false ? (
              <Badge size="2" color="amber" variant="solid">
                Simulated offer
              </Badge>
            ) : (
              <Text size="1" color="gray">
                Flight quote
              </Text>
            )}
            <Heading size="6" as="h3" mt="2">
              <Flex align="center" gap="2">
                {offer.origin} <ArrowRight size={20} /> {offer.destination}
              </Flex>
            </Heading>
          </Box>
          <Flex direction="column" align={{ initial: 'start', sm: 'end' }}>
            <Text size="6" weight="bold">
              {flightPrice(offer)}
            </Text>
            <Text size="1" color="gray">
              {offer.currency} · total
              {offer.passengerCount
                ? ` for ${offer.passengerCount} traveler${offer.passengerCount === 1 ? '' : 's'}`
                : ' for all travelers'}
            </Text>
          </Flex>
        </Flex>
        <Callout.Root color={expiry.state === 'expired' ? 'red' : 'amber'} role="status" size="1">
          <Callout.Icon>
            <Clock3 size={16} />
          </Callout.Icon>
          <Callout.Text>{expiry.label}</Callout.Text>
        </Callout.Root>
        <Text as="p" size="2" color="gray">
          Total covers all requested journeys and travelers, including taxes. Optional extras are
          excluded. No reservation has been made. Times below are local to each airport.
        </Text>
        {!!incomplete && (
          <Callout.Root color="amber">
            <Callout.Text>
              The provider returned details for {journeys.length} of {offer.requestedJourneyCount}{' '}
              requested journeys. Search again before relying on this option.
            </Callout.Text>
          </Callout.Root>
        )}
        {journeys.length === 0 && (
          <Card>
            <Text as="p" size="2">
              {flightDate(offer.departure)} · {flightTime(offer.departure)} {offer.origin} →{' '}
              {flightTime(offer.arrival)} {offer.destination}
            </Text>
            <Text as="p" size="2" color="gray" mt="2">
              Segment and return details were not saved with this quote. Search again for a complete
              flight breakdown.
            </Text>
          </Card>
        )}
        {journeys.map((journey, journeyIndex) => (
          <Flex direction="column" gap="3" asChild key={journey.id}>
            <section
              aria-label={
                journeyIndex === 0
                  ? 'Outbound journey'
                  : journeyIndex === 1 && journeys.length === 2
                    ? 'Return journey'
                    : `Journey ${journeyIndex + 1}`
              }
            >
              <Flex align="end" justify="between" gap="3" wrap="wrap">
                <Box>
                  <Text size="1" color="gray">
                    {journeyIndex === 0
                      ? 'Outbound'
                      : journeyIndex === 1 && journeys.length === 2
                        ? 'Return'
                        : `Journey ${journeyIndex + 1}`}
                  </Text>
                  <Heading size="4" as="h3" mt="1">
                    <Flex align="center" gap="2">
                      {journey.origin.code} <ArrowRight size={16} /> {journey.destination.code}
                    </Flex>
                  </Heading>
                </Box>
                <Text size="2" color="gray">
                  {flightDuration(journey.duration)} ·{' '}
                  {journey.stops === 0
                    ? 'Nonstop'
                    : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
                </Text>
              </Flex>
              {journey.segments.map((segment, segmentIndex) => (
                <Box key={segment.id}>
                  {segmentIndex > 0 && (
                    <Text as="p" size="1" color="gray" mb="2">
                      {journey.segments[segmentIndex - 1].destination.code === segment.origin.code
                        ? `Connection at ${segment.origin.name || segment.origin.code}`
                        : `Airport change: ${journey.segments[segmentIndex - 1].destination.code} to ${segment.origin.code}`}
                      . Next departure {flightDate(segment.departure)},{' '}
                      {flightTime(segment.departure)}.
                    </Text>
                  )}
                  <Card asChild>
                    <article>
                      <Flex direction="column" gap="3">
                        <Heading size="3" as="h4">
                          <Flex align="center" gap="2">
                            <Plane size={15} />
                            {carrierLabel(segment)}
                          </Flex>
                        </Heading>
                        {segment.operatingCarrier &&
                          segment.marketingCarrier &&
                          (segment.operatingCarrier.name !== segment.marketingCarrier.name ||
                            segment.operatingFlightNumber !== segment.marketingFlightNumber) && (
                            <Text as="p" size="1" color="gray">
                              Operated by {segment.operatingCarrier.name}
                              {segment.operatingFlightNumber
                                ? ` · ${segment.operatingCarrier.code || ''}${segment.operatingFlightNumber}`
                                : ''}
                            </Text>
                          )}
                        <Flex align="center" gap="4" wrap="wrap">
                          <Flex direction="column" gap="1" minWidth="0">
                            <Text size="5" weight="bold">
                              {flightTime(segment.departure)}
                            </Text>
                            <Text size="1" color="gray">
                              {flightDate(segment.departure)}
                            </Text>
                            <Text size="2" weight="medium">
                              {segment.origin.code} ·{' '}
                              {segment.origin.name || 'Airport name unavailable'}
                            </Text>
                            {segment.originTerminal && (
                              <Text size="1" color="gray">
                                Terminal {segment.originTerminal}
                              </Text>
                            )}
                          </Flex>
                          <ArrowRight size={18} />
                          <Flex direction="column" gap="1" minWidth="0">
                            <Text size="5" weight="bold">
                              {flightTime(segment.arrival)}
                            </Text>
                            <Text size="1" color="gray">
                              {flightDate(segment.arrival)}
                            </Text>
                            <Text size="2" weight="medium">
                              {segment.destination.code} ·{' '}
                              {segment.destination.name || 'Airport name unavailable'}
                            </Text>
                            {segment.destinationTerminal && (
                              <Text size="1" color="gray">
                                Terminal {segment.destinationTerminal}
                              </Text>
                            )}
                          </Flex>
                        </Flex>
                        <Text as="p" size="2" color="gray">
                          {flightDuration(segment.duration)}
                        </Text>
                        {segment.stops?.map((stop, index) => (
                          <Text as="p" size="1" color="gray" key={`${stop.airport.code}-${index}`}>
                            Intermediate stop at {stop.airport.name || stop.airport.code}
                            {stop.duration ? ` · ${flightDuration(stop.duration)}` : ''}. Check the
                            airline’s instructions for this stop.
                          </Text>
                        ))}
                        <Separator size="4" />
                        <Flex gap="2" align="start">
                          <Box style={{ color: 'var(--gray-11)', flexShrink: 0 }} mt="1">
                            <Luggage size={15} />
                          </Box>
                          <Flex direction="column" gap="1">
                            {segment.passengers?.length ? (
                              segment.passengers.map((passenger, index) => (
                                <Text as="p" size="2" key={`${passenger.passengerId}-${index}`}>
                                  <Text weight="bold">Traveler {index + 1}</Text>
                                  {passenger.cabin
                                    ? ` · ${passenger.cabin.replaceAll('_', ' ')}`
                                    : ''}
                                  <Text as="span" color="gray">
                                    {' '}
                                    {passenger.baggages?.length
                                      ? passenger.baggages
                                          .map(
                                            (bag) =>
                                              `${bag.quantity} ${bag.type.replaceAll('_', '-')} bag${bag.quantity === 1 ? '' : 's'}`,
                                          )
                                          .join(' · ')
                                      : 'Baggage allowance not supplied'}
                                  </Text>
                                </Text>
                              ))
                            ) : (
                              <Text as="p" size="2" color="gray">
                                Baggage allowance not supplied
                              </Text>
                            )}
                          </Flex>
                        </Flex>
                      </Flex>
                    </article>
                  </Card>
                </Box>
              ))}
            </section>
          </Flex>
        ))}
        <Text as="p" size="2" color="gray">
          Fare conditions and baggage may change when the airline reprices the offer. Flight
          purchase and ticketing are not available in Asktara yet.
        </Text>
        <Flex justify="start">
          <Button size="3" variant="soft" color="gray" onClick={onClose}>
            Back to planning
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
}
