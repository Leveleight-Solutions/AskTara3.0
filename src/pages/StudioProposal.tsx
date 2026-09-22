import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Mail, Phone, Globe, Clock3, MapPin } from 'lucide-react';
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
  Link as ThemeLink,
  Separator,
  Text,
} from '@radix-ui/themes';
import { api } from '../api';
import { StudioItineraryContent } from '../components/StudioItineraryPanel';
import type { StudioClientProposal } from '../../shared/studio-proposals';
import { studioProposalIsStale, studioProposalMoney } from '../../shared/studio-proposals';

const dateLabel = (value: string) =>
  value
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'To be confirmed';

/**
 * Client-facing document. It renders only the published client payload: no private
 * chat, source documents, booking references, costs or margins reach this surface.
 */
export function StudioProposalDocument({
  proposal,
  pdfUrl,
  preview = false,
}: {
  proposal: StudioClientProposal;
  pdfUrl?: string;
  preview?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const stale = studioProposalIsStale(proposal, now);
  // Package pricing is a business rule: component prices never reach the client.
  const packageMode = proposal.pricing.mode === 'package';
  const accent = proposal.agency.accentColor;
  // Heading levels only. Standalone, the document owns the page: its title is the
  // h1. In preview it is embedded inside Studio, which already owns that route's
  // h1, so the whole outline shifts down one level to stay a single hierarchy.
  const [titleAs, sectionAs, itemAs] = preview
    ? (['h2', 'h3', 'h4'] as const)
    : (['h1', 'h2', 'h3'] as const);
  return (
    <Card asChild size="4">
      <article data-testid="client-proposal">
        <Flex direction="column" gap="6">
          {preview && (
            <Callout.Root color="blue" size="1">
              <Callout.Text>
                Private preview · Publish only when the client-facing details are ready.
              </Callout.Text>
            </Callout.Root>
          )}
          <Flex asChild align="center" justify="between" gap="4" wrap="wrap">
            <header data-testid="proposal-brand">
              <Flex align="center" gap="3">
                {proposal.agency.logoDataUrl && (
                  <img
                    src={proposal.agency.logoDataUrl}
                    alt=""
                    style={{ maxWidth: 140, maxHeight: 54, objectFit: 'contain' }}
                  />
                )}
                <Text size="5" weight="bold" style={{ color: accent }}>
                  {proposal.agency.name}
                </Text>
              </Flex>
              {pdfUrl && (
                <Button asChild variant="soft" size="3">
                  <a href={pdfUrl} download>
                    <Download size={17} /> Download PDF
                  </a>
                </Button>
              )}
            </header>
          </Flex>
          <Separator size="4" />
          <Box>
            <Text size="1" weight="bold" style={{ letterSpacing: '0.15em', color: accent }}>
              YOUR TRAVEL PROPOSAL
            </Text>
            <Heading
              as={titleAs}
              size={{ initial: '8', sm: '9' }}
              mt="3"
              mb="3"
              style={{ color: accent }}
            >
              {proposal.title}
            </Heading>
            {proposal.clientName && (
              <Text as="p" size="3" color="gray">
                Prepared for {proposal.clientName}
              </Text>
            )}
            <Flex gap="2" wrap="wrap" mt="4">
              <Badge size="2" variant="soft" color="gray">
                {dateLabel(proposal.trip.startDate)}
                {proposal.trip.endDate && ` – ${dateLabel(proposal.trip.endDate)}`}
              </Badge>
              {proposal.trip.adults !== null && (
                <Badge size="2" variant="soft" color="gray">
                  {proposal.trip.adults} adults
                </Badge>
              )}
              {proposal.trip.children !== null && proposal.trip.children > 0 && (
                <Badge size="2" variant="soft" color="gray">
                  {proposal.trip.children} children
                </Badge>
              )}
            </Flex>
          </Box>
          <Callout.Root color={stale ? 'amber' : 'gray'} size="2" role="status">
            <Callout.Icon>
              <Clock3 size={19} />
            </Callout.Icon>
            <Callout.Text>
              <Text as="span" weight="bold">
                {stale ? 'Prices need reconfirmation' : 'A proposal for your consideration'}
              </Text>
              <br />
              {stale
                ? 'The price validity period has passed. You can still explore the proposal; your agent will refresh prices and availability before you proceed.'
                : `Prices require reconfirmation after ${new Date(proposal.validUntil).toLocaleString('en-AU')}, or sooner if availability changes.`}
            </Callout.Text>
          </Callout.Root>
          <Box asChild>
            <section>
              <Heading as={sectionAs} size="7" mb="4" style={{ color: accent }}>
                Your route
              </Heading>
              <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                {proposal.stops.map((stop, index) => (
                  <Card key={stop.id} size="2" variant="surface">
                    <Flex gap="3" align="start">
                      <Badge size="2" radius="full" variant="soft" color="gray">
                        {index + 1}
                      </Badge>
                      <Box minWidth="0">
                        <Heading as={itemAs} size="4">
                          {stop.name}
                          {stop.country && (
                            <Text size="2" weight="regular">
                              , {stop.country}
                            </Text>
                          )}
                        </Heading>
                        <Text as="p" size="2" color="gray" mt="2">
                          {stop.nights === null ? 'Nights to confirm' : `${stop.nights} nights`} ·{' '}
                          {dateLabel(stop.arrivalDate)}
                          {stop.departureDate && ` – ${dateLabel(stop.departureDate)}`}
                        </Text>
                        {stop.neighbourhood && (
                          <Flex align="center" gap="1" mt="2">
                            <MapPin size={13} />
                            <Text size="2" color="gray">
                              {stop.neighbourhood}
                            </Text>
                          </Flex>
                        )}
                        {index < proposal.stops.length - 1 && (
                          <Text as="p" size="1" color="gray" mt="2">
                            Onward travel:{' '}
                            {stop.onwardTransport === 'undecided'
                              ? 'to be confirmed'
                              : stop.onwardTransport}
                          </Text>
                        )}
                      </Box>
                    </Flex>
                  </Card>
                ))}
              </Grid>
            </section>
          </Box>
          {proposal.itinerary && (
            <Box asChild>
              <section aria-label="Travel itinerary">
                <Heading as={sectionAs} size="7" mb="4" style={{ color: accent }}>
                  Your day-by-day itinerary
                </Heading>
                <StudioItineraryContent
                  itinerary={proposal.itinerary}
                  dayHeading={itemAs}
                  accent={accent}
                />
              </section>
            </Box>
          )}
          {proposal.items.length > 0 && (
            <Box asChild>
              <section>
                <Heading as={sectionAs} size="7" mb="4" style={{ color: accent }}>
                  Included services
                </Heading>
                <Grid
                  columns={{ initial: '1', sm: '2' }}
                  gap="4"
                  data-testid="proposal-service-grid"
                >
                  {proposal.items.map((item) => (
                    <Card asChild key={item.id} size="2" variant="surface">
                      <article>
                        <Flex direction="column" gap="2" align="start" height="100%">
                          <Text
                            size="1"
                            weight="bold"
                            style={{ letterSpacing: '0.12em', color: accent }}
                          >
                            {item.kind}
                          </Text>
                          <Heading as={itemAs} size="4">
                            {item.title}
                          </Heading>
                          {item.startDate && (
                            <Text as="p" size="1" color="gray">
                              {dateLabel(item.startDate)}
                              {item.endDate && ` – ${dateLabel(item.endDate)}`}
                            </Text>
                          )}
                          <Text
                            as="p"
                            size="2"
                            color="gray"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          >
                            {item.description}
                          </Text>
                          <Badge size="1" variant="soft" color="gray">
                            {item.status === 'externally_booked'
                              ? 'Externally booked · reported by your agent'
                              : item.status === 'placeholder'
                                ? 'Details to be confirmed'
                                : 'Proposed · not booked'}
                          </Badge>
                          <Box width="100%" mt="auto" pt="3">
                            <Separator size="4" mb="3" />
                            {!packageMode && item.price !== null && (
                              <Text as="div" size="4" weight="bold">
                                {studioProposalMoney(item.price, item.currency)}
                              </Text>
                            )}
                            <Text as="div" size="1" color="gray" mt="1">
                              {item.priceStatus === 'sandbox'
                                ? 'Sandbox test rate · excluded from totals'
                                : item.priceStatus === 'agent_estimate'
                                  ? 'Agent estimate · subject to confirmation'
                                  : item.priceStatus === 'supplier_quote'
                                    ? 'Supplier quote · subject to availability'
                                    : 'Price to be confirmed'}
                            </Text>
                          </Box>
                        </Flex>
                      </article>
                    </Card>
                  ))}
                </Grid>
              </section>
            </Box>
          )}
          {proposal.recommendations.length > 0 && (
            <Box asChild>
              <section>
                <Heading as={sectionAs} size="7" mb="2" style={{ color: accent }}>
                  Ideas to explore
                </Heading>
                <Text as="p" size="2" color="gray" mb="4">
                  A few suggestions to enjoy at your own pace.
                </Text>
                <Grid columns={{ initial: '1', sm: '2' }} gap="4">
                  {proposal.recommendations.map((item) => (
                    <Card asChild key={item.id} size="2" variant="surface">
                      <article>
                        <Flex direction="column" gap="2" align="start">
                          <Text
                            size="1"
                            weight="bold"
                            style={{ letterSpacing: '0.12em', color: accent }}
                          >
                            {proposal.stops.find((stop) => stop.id === item.stopId)?.name} ·{' '}
                            {item.category}
                          </Text>
                          <Heading as={itemAs} size="4">
                            {item.name}
                          </Heading>
                          <Text
                            as="p"
                            size="2"
                            color="gray"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          >
                            {item.description}
                          </Text>
                          {item.sources.length > 0 && (
                            <Box width="100%" pt="3">
                              <Separator size="4" mb="3" />
                              <Flex asChild direction="column" gap="2">
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                  {item.sources.map((source, index) => (
                                    <li key={`${source.url}-${index}`}>
                                      <ThemeLink
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        size="1"
                                        style={{ overflowWrap: 'anywhere', color: accent }}
                                      >
                                        {source.label}
                                      </ThemeLink>
                                      {source.checkedAt && (
                                        <Text size="1" color="gray">
                                          {' '}
                                          · Checked {dateLabel(source.checkedAt.slice(0, 10))}
                                        </Text>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </Flex>
                            </Box>
                          )}
                        </Flex>
                      </article>
                    </Card>
                  ))}
                </Grid>
              </section>
            </Box>
          )}
          <Card asChild size="3" variant="surface">
            <section data-testid="proposal-pricing">
              <Heading as={sectionAs} size="7" mb="4" style={{ color: accent }}>
                Proposal pricing
              </Heading>
              {packageMode ? (
                <>
                  <Text as="p" size="8" weight="bold" style={{ color: accent }}>
                    {proposal.pricing.packagePrice === null
                      ? 'Package price to be confirmed'
                      : studioProposalMoney(
                          proposal.pricing.packagePrice,
                          proposal.pricing.currency,
                        )}
                  </Text>
                  <Text as="p" size="2" color="gray" mt="2">
                    Package price set by your agent, subject to confirmation.
                  </Text>
                </>
              ) : (
                <>
                  {proposal.pricing.totals.map((total) => (
                    <Box key={total.currency} mb="3">
                      <Text as="p" size="8" weight="bold" style={{ color: accent }}>
                        {studioProposalMoney(total.amount, total.currency)}
                      </Text>
                      <Text as="p" size="2" color="gray" mt="2">
                        Priced items{total.containsEstimates ? ', including agent estimates' : ''}.
                      </Text>
                    </Box>
                  ))}
                  {!proposal.pricing.totals.length && (
                    <Text as="p" size="2" color="gray">
                      No confirmed priced items.
                    </Text>
                  )}
                  {proposal.pricing.totals.length > 1 && (
                    <Text as="p" size="2" color="gray" mt="2">
                      Currencies are shown separately. No exchange rate has been applied.
                    </Text>
                  )}
                  {proposal.pricing.unpricedCount > 0 && (
                    <Text as="p" size="2" color="gray" mt="2">
                      {proposal.pricing.unpricedCount}{' '}
                      {proposal.pricing.unpricedCount === 1
                        ? 'item still requires'
                        : 'items still require'}{' '}
                      pricing. These figures are not a complete trip total.
                    </Text>
                  )}
                </>
              )}
              {proposal.pricing.sandboxCount > 0 && (
                <Callout.Root color="amber" size="1" mt="4">
                  <Callout.Text>
                    {proposal.pricing.sandboxCount} services use sandbox test rates. These rates are
                    illustrative and excluded from item totals.
                  </Callout.Text>
                </Callout.Root>
              )}
              {proposal.pricing.notes && (
                <Text
                  as="p"
                  size="2"
                  color="gray"
                  mt="4"
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {proposal.pricing.notes}
                </Text>
              )}
            </section>
          </Card>
          <Separator size="4" />
          <Box asChild>
            <footer>
              <Text as="p" size="1" color="gray">
                {proposal.notice}
              </Text>
              {proposal.agency.disclaimer && (
                <Text as="p" size="1" color="gray" mt="2">
                  {proposal.agency.disclaimer}
                </Text>
              )}
              <Flex gap="4" wrap="wrap" py="4">
                {proposal.agency.email && (
                  <ThemeLink
                    href={`mailto:${proposal.agency.email}`}
                    size="2"
                    style={{ color: accent }}
                  >
                    <Flex align="center" gap="2">
                      <Mail size={15} />
                      {proposal.agency.email}
                    </Flex>
                  </ThemeLink>
                )}
                {proposal.agency.phone && (
                  <ThemeLink
                    href={`tel:${proposal.agency.phone}`}
                    size="2"
                    style={{ color: accent }}
                  >
                    <Flex align="center" gap="2">
                      <Phone size={15} />
                      {proposal.agency.phone}
                    </Flex>
                  </ThemeLink>
                )}
                {proposal.agency.website && (
                  <ThemeLink
                    href={proposal.agency.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="2"
                    style={{ color: accent }}
                  >
                    <Flex align="center" gap="2">
                      <Globe size={15} />
                      Visit our website
                    </Flex>
                  </ThemeLink>
                )}
              </Flex>
              <Text as="p" size="1" color="gray">
                Prepared {dateLabel(proposal.publishedAt.slice(0, 10))} · Read-only proposal
              </Text>
            </footer>
          </Box>
        </Flex>
      </article>
    </Card>
  );
}

export default function StudioProposal() {
  const { token = '' } = useParams();
  const [proposal, setProposal] = useState<StudioClientProposal | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProposal(null);
    setError('');
    api<{ proposal: StudioClientProposal }>(`/studio/proposals/${encodeURIComponent(token)}`)
      .then((result) => {
        if (active) setProposal(result.proposal);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <Box asChild style={{ minHeight: '100vh', background: 'var(--gray-2)' }}>
        <main>
          <Container size="3" px="4" py="9">
            <Flex direction="column" align="center" gap="3">
              <Heading as="h1" size="7" align="center">
                This proposal is unavailable
              </Heading>
              <Text as="p" size="3" color="gray" align="center">
                {error}
              </Text>
              <Text as="p" size="3" color="gray" align="center">
                Please contact your travel agent for the current link.
              </Text>
            </Flex>
          </Container>
        </main>
      </Box>
    );
  if (!proposal)
    return (
      <Box asChild style={{ minHeight: '100vh', background: 'var(--gray-2)' }}>
        <main role="status">
          <Container size="3" px="4" py="9">
            <Text as="p" size="3" color="gray" align="center">
              Opening your travel proposal…
            </Text>
          </Container>
        </main>
      </Box>
    );
  return (
    <Box asChild style={{ minHeight: '100vh', background: 'var(--gray-2)' }}>
      <main>
        <Container size="3" px={{ initial: '3', sm: '5' }} py={{ initial: '5', sm: '8' }}>
          <StudioProposalDocument
            proposal={proposal}
            pdfUrl={`/api/studio/proposals/${encodeURIComponent(token)}/pdf`}
          />
        </Container>
      </main>
    </Box>
  );
}
