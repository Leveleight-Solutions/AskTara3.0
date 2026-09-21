import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Container, Flex, Heading } from '@radix-ui/themes';
import { useApp } from '../context';
import { AuroraBackground } from '../components/AuroraBackground';
import { RiseIn } from '../components/RiseIn';
import { StartComposer } from '../components/StartComposer';
import { TripDetailChips } from '../components/TripDetailChips';
import { buildTripPrompt } from '../../shared/trip-prompt';
import type { TripDates, TripParty } from '../../shared/trip-details';

/* The home page is the hero and nothing else. The destination, stay, experience and inspiration
   sections that used to follow it duplicated Discover (/explore), which is where browsing lives. */

export default function Home() {
  const { user } = useApp();
  /* Greet by first name once there is an account. Safe to read straight from context without
     guarding against a late swap: /session resolves before the catalog fetch, and the routes only
     mount once the catalog is in, so `user` is already settled by the time this renders — the
     heading never animates in and then rewrites itself. */
  const firstName = user?.name.trim().split(/\s+/)[0] ?? '';
  const [search] = useSearchParams();
  /* A brief can arrive in the URL — an inspiration card, or a forwarded /studio?q= link. Seed the
     composer with it rather than dropping it, and key the composer on it so a second card click
     replaces the text instead of leaving the first one in place. */
  const carriedBrief = search.get('q') || '';
  /* Undefined until a chip is answered, and left that way when the client says "not sure yet":
     an unanswered detail is never guessed at, it is simply not added to the brief. */
  const [party, setParty] = useState<TripParty | undefined>();
  const [dates, setDates] = useState<TripDates | undefined>();
  /* The hero fills exactly one screen below the app header: dvh (not vh) so mobile browsers'
     collapsing toolbars don't push its foot below the fold, and min-height (not height) so a short
     viewport lets the section grow and the page scroll rather than clipping. The header height is
     read from its variable rather than a literal, so this stays true when the top bar becomes a
     sidebar and the variable goes to 0px. justify="center" supplies the vertical rhythm that
     py="9" used to. */
  return (
    <Flex
      asChild
      direction="column"
      justify="center"
      position="relative"
      style={{
        background: 'var(--accent-2)',
        minHeight: 'calc(100dvh - var(--app-header-height, 0px))',
      }}
    >
      <section>
        {/* Clips itself to this section and paints at z-index 0, so it never adds scrollable
              area; the content below lifts above it. */}
        <AuroraBackground />
        {/* Radix gives .rt-Container flex-grow: 1, which would pin the content to the top of
              the now viewport-tall section; grow 0 lets justify="center" above do the centring,
              and shrink 0 keeps a taller-than-viewport hero at its natural height instead of
              squeezing it. The padding is only the minimum gutter for that overflow case. */}
        <Container
          size="4"
          px={{ initial: '4', md: '6' }}
          py={{ initial: '5', md: '6' }}
          flexGrow="0"
          flexShrink="0"
          position="relative"
          style={{ zIndex: 1 }}
        >
          {/* The only gap in the hero is the one between the question and the composer, so it
                carries all of the breathing room: 32px on a phone, 48px once there is height to
                spend. */}
          <Flex direction="column" align="center" gap={{ initial: '6', sm: '8' }}>
            {/* The h1 is the tallest item, so it is the first thing that gives when the
                  screen is short or narrow. A Radix size prop is width-responsive only, and the
                  constraint here is height as much as width, so the size-9 token is the ceiling
                  of a fluid value that the viewport's own height and width can pull down.
                  It arrives from the composer's line: RiseIn measures that distance at runtime
                  from the pill below, so the entrance holds at any viewport. */}
            <RiseIn originSelector="[data-hero-composer]">
              <Heading
                as="h1"
                size="9"
                weight="regular"
                align="center"
                wrap="balance"
                style={{
                  fontSize: 'clamp(var(--font-size-6), min(7vw, 7.2dvh), var(--font-size-9))',
                  lineHeight: 1.05,
                }}
              >
                {firstName ? `What are you planning, ${firstName}?` : 'What are you planning?'}
              </Heading>
            </RiseIn>
            {/* The composer and the two details it can borrow are one control: the pill is the
                primary field and the tray of chips is attached to its underside. The tray is
                handed to the composer rather than placed after it, because the composer's own
                feedback (a source it could not read, a failed send) renders below the pill — and
                a tray placed after the composer would tuck itself behind that instead. */}
            <StartComposer
              key={carriedBrief}
              heroAnchor
              initialMessage={carriedBrief}
              prepareMessage={(text) => buildTripPrompt(text, { party, dates })}
              tray={
                <TripDetailChips
                  party={party}
                  onParty={setParty}
                  dates={dates}
                  onDates={setDates}
                />
              }
            />
          </Flex>
        </Container>
      </section>
    </Flex>
  );
}
