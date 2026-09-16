import type { ReactNode } from 'react';
import { FlaskConical, ArrowLeft, CircleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Box, Button, Callout, Container, Flex, Heading, Text } from '@radix-ui/themes';

export function bookingPrice(amount: number, currency: string) {
  if (!Number.isFinite(amount)) return 'Price unavailable';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function SandboxNotice() {
  return (
    <Callout.Root color="amber" role="note" size="2">
      <Callout.Icon>
        <FlaskConical size={20} />
      </Callout.Icon>
      <Callout.Text>
        <Text as="span" weight="bold">
          Sandbox booking
        </Text>
        <br />
        This is a provider test reservation. No real stay or flight is reserved, and no payment is
        collected.
      </Callout.Text>
    </Callout.Root>
  );
}

export function BookingPage({
  title,
  description,
  children,
  back = '/bookings',
  backLabel = 'Your bookings',
}: {
  title: string;
  description: string;
  children: ReactNode;
  back?: string;
  backLabel?: string;
}) {
  return (
    <Container size="4" px={{ initial: '4', sm: '5' }} py={{ initial: '5', sm: '6' }}>
      <Flex direction="column" gap="5">
        <Box>
          <Button asChild variant="ghost" color="gray" size="2">
            <Link to={back}>
              <ArrowLeft size={15} />
              {backLabel}
            </Link>
          </Button>
        </Box>
        <Box>
          <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '0.12em' }}>
            THE DETAILS, ALL TOGETHER
          </Text>
          <Heading as="h1" size={{ initial: '7', sm: '8' }} mt="2" mb="2">
            {title}
          </Heading>
          <Text as="p" size="3" color="gray" style={{ maxWidth: '65ch' }}>
            {description}
          </Text>
        </Box>
        <Flex direction="column" gap="4">
          {children}
        </Flex>
      </Flex>
    </Container>
  );
}

export function BookingError({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <Callout.Root color="red" role="alert" size="2">
      <Callout.Icon>
        <CircleAlert size={19} />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
      {children}
    </Callout.Root>
  );
}

export function BookingSteps({ current }: { current: number }) {
  return (
    <Flex asChild gap={{ initial: '3', sm: '6' }} wrap="wrap" align="center">
      <ol aria-label="Booking steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {['Review your quote', 'Guest details', 'Booking status'].map((label, index) => (
          <Flex asChild align="center" gap="2" key={label}>
            <li aria-current={index === current ? 'step' : undefined}>
              <Badge
                size="2"
                radius="full"
                variant={index <= current ? 'solid' : 'soft'}
                color={index <= current ? undefined : 'gray'}
              >
                {index + 1}
              </Badge>
              <Text
                size="2"
                color={index <= current ? undefined : 'gray'}
                weight={index === current ? 'medium' : 'regular'}
              >
                {label}
              </Text>
            </li>
          </Flex>
        ))}
      </ol>
    </Flex>
  );
}
