import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Heart, ArrowUpRight, ArrowRight, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Card,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Inset,
  Spinner as RadixSpinner,
  Text,
} from '@radix-ui/themes';
import { useApp } from '../context';
import type { Destination, Experience, Stay } from '../../shared/types';
import { money } from '../api';

export function TaraMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 3C26.6 15.2 32.8 21.4 45 24C32.8 26.6 26.6 32.8 24 45C21.4 32.8 15.2 26.6 3 24C15.2 21.4 21.4 15.2 24 3Z"
        fill="currentColor"
      />
      <path
        d="M39 2C39.6 5.3 41.7 7.4 45 8C41.7 8.6 39.6 10.7 39 14C38.4 10.7 36.3 8.6 33 8C36.3 7.4 38.4 5.3 39 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Consumers mount this conditionally, so an instance existing means "open". Radix Dialog owns
 * focus trapping, scroll locking and Escape.
 *
 * Focus restore is ours, deliberately. Radix restores focus from FocusScope's unmount cleanup,
 * but because callers unmount the whole `Dialog.Root` in the same tick that `onClose` fires,
 * that cleanup never lands and focus falls to `<body>` — verified against the running app.
 * Losing the opener's focus strands keyboard and screen reader users at the top of the document,
 * so we capture it on mount and put it back after the dialog has actually left the DOM.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const opener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const element = opener.current;
      if (!(element instanceof HTMLElement)) return;
      requestAnimationFrame(() => {
        const anotherDialogOpen = document.querySelector(
          '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]',
        );
        if (element.isConnected && !anotherDialogOpen) element.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        maxWidth={wide ? '900px' : '480px'}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Flex justify="between" align="start" gap="3" mb="2">
          <Dialog.Title mb="0">{title}</Dialog.Title>
          <Dialog.Close>
            <IconButton variant="soft" color="gray" size="3" aria-label="Close dialog">
              <X size={18} />
            </IconButton>
          </Dialog.Close>
        </Flex>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function SaveButton({
  type,
  id,
  label,
}: {
  type: 'destination' | 'stay' | 'experience';
  id: string;
  label: string;
}) {
  const { isSaved, toggleSave } = useApp();
  const saved = isSaved(type, id);
  return (
    <IconButton
      size="3"
      variant={saved ? 'solid' : 'soft'}
      color={saved ? 'crimson' : 'gray'}
      aria-label={`${saved ? 'Unsave' : 'Save'} ${label}`}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleSave(type, id);
      }}
    >
      <Heart size={17} fill={saved ? 'currentColor' : 'none'} strokeWidth={1.7} />
    </IconButton>
  );
}

/** Photo + overlaid save control, shared by all three card types. */
function CardPhoto({
  src,
  alt,
  tag,
  save,
}: {
  src: string;
  alt: string;
  tag: string;
  save: ReactNode;
}) {
  return (
    <Inset clip="padding-box" side="top" pb="current">
      <Box position="relative">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={{ display: 'block', width: '100%', height: 180, objectFit: 'cover' }}
        />
        <Box position="absolute" top="2" left="2">
          <Badge variant="solid" highContrast>
            {tag}
          </Badge>
        </Box>
        <Box position="absolute" top="2" right="2">
          {save}
        </Box>
      </Box>
    </Inset>
  );
}

export function DestinationCard({ destination: d }: { destination: Destination }) {
  return (
    <Card asChild size="2">
      <article data-testid="destination-card">
        <CardPhoto
          src={d.image}
          alt={`${d.name}, ${d.country}`}
          tag={d.tags[0]}
          save={<SaveButton type="destination" id={d.id} label={d.name} />}
        />
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            {d.country}
          </Text>
          <Link to={`/destinations/${d.id}`}>
            <Flex align="center" gap="1">
              <Heading as="h3" size="4">
                {d.name}
              </Heading>
              <ArrowUpRight size={17} />
            </Flex>
          </Link>
          <Text size="2" color="gray">
            {d.description}
          </Text>
        </Flex>
      </article>
    </Card>
  );
}

export function StayCard({ stay: s, onSelect }: { stay: Stay; onSelect: () => void }) {
  const { catalog } = useApp();
  return (
    <Card asChild size="2">
      <article data-testid="stay-card">
        <CardPhoto
          src={s.image}
          alt={s.name}
          tag={s.style}
          save={<SaveButton type="stay" id={s.id} label={s.name} />}
        />
        <Flex direction="column" gap="1" align="start">
          <Text size="1" color="gray">
            {catalog.destinations.find((d) => d.id === s.destinationId)?.name}
          </Text>
          <Button variant="ghost" onClick={onSelect}>
            <Heading as="h3" size="4">
              {s.name}
            </Heading>
          </Button>
          <Text size="2" color="gray">
            {s.description}
          </Text>
          <Flex align="center" justify="between" width="100%" mt="2">
            <Text size="2">
              From <Text weight="bold">{money(s.price)}</Text>
              <Text color="gray"> / night</Text>
            </Text>
            <Badge color="gray" variant="soft">
              Sample stay
            </Badge>
          </Flex>
        </Flex>
      </article>
    </Card>
  );
}

export function ExperienceCard({
  experience: e,
  onSelect,
}: {
  experience: Experience;
  onSelect: () => void;
}) {
  const { catalog } = useApp();
  return (
    <Card asChild size="2">
      <article data-testid="experience-card">
        <CardPhoto
          src={e.image}
          alt={e.name}
          tag={e.category}
          save={<SaveButton type="experience" id={e.id} label={e.name} />}
        />
        <Flex direction="column" gap="1" align="start">
          <Text size="1" color="gray">
            {catalog.destinations.find((d) => d.id === e.destinationId)?.name} · {e.duration}
          </Text>
          <Button variant="ghost" onClick={onSelect}>
            <Heading as="h3" size="4">
              {e.name}
            </Heading>
          </Button>
          <Flex align="center" justify="between" width="100%" mt="2">
            <Text size="2">
              Estimate <Text weight="bold">{money(e.price)}</Text>
              <Text color="gray"> / person</Text>
            </Text>
            <ArrowUpRight size={17} />
          </Flex>
        </Flex>
      </article>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  to,
  onAction,
}: {
  title: string;
  description: string;
  action: string;
  /** Omit when `onAction` handles the recovery in place (e.g. clearing filters). */
  to?: string;
  onAction?: () => void;
}) {
  return (
    <Flex direction="column" align="center" gap="3" py="9" px="4">
      <Flex
        align="center"
        justify="center"
        style={{
          width: 64,
          height: 64,
          borderRadius: '100%',
          background: 'var(--accent-3)',
          color: 'var(--accent-11)',
        }}
      >
        <Sparkles size={28} />
      </Flex>
      <Heading as="h2" size="5" align="center">
        {title}
      </Heading>
      <Text size="2" color="gray" align="center" style={{ maxWidth: '42ch' }}>
        {description}
      </Text>
      {onAction ? (
        <Button size="3" mt="2" onClick={onAction}>
          {action}
          <ArrowRight size={16} />
        </Button>
      ) : (
        <Button asChild size="3" mt="2">
          <Link to={to ?? '/'}>
            {action}
            <ArrowRight size={16} />
          </Link>
        </Button>
      )}
    </Flex>
  );
}

export function Spinner({ label = 'Finding a little inspiration…' }: { label?: string }) {
  return (
    <Flex direction="column" align="center" gap="3" py="8" role="status">
      <RadixSpinner size="3" />
      <Text size="2" color="gray">
        {label}
      </Text>
    </Flex>
  );
}
