import { useEffect, useRef } from 'react';
import { Box } from '@radix-ui/themes';
import { useApp } from '../context';

/**
 * Gemini-style soft glow behind a section.
 *
 * A pale, near-white ground with a single blurred ellipse of light blue centred behind the
 * composer — the glow sits under the content rather than washing the whole section, and the edges
 * stay near-white.
 *
 * The glow belongs to a signed-in session: when there is an account it grows out from the centre
 * to its resting size once and then holds still — on arriving at the page signed in, and again the
 * moment a sign-in completes (sign-in is a dialog, so the page does not remount). Signing out
 * shrinks it away. Signed-out visitors see the plain ground.
 *
 * The glow lives on one oversized layer (200% of the section, centred so it overhangs every edge),
 * blurred hard so the ellipse has no edge; the overhang keeps the blur's faded rim off-screen.
 *
 * Rendered with the Web Animations API rather than a CSS class: `@keyframes` cannot be expressed
 * inline, and the app's convention is that components carry no `className` and the stylesheet holds
 * no app styling. The inline style is always the end state, so reduced motion, or a browser without
 * `element.animate`, simply shows the glow already grown (or already gone).
 *
 * The palette is fixed rather than drawn from the Radix accent scale — it is the Gemini blue by
 * design. The app renders in the light appearance only, which these tints are chosen for.
 */

/** The page ground the glow fades into. */
const GROUND = '#f4f7fb';

/* Radii are shares of the layer (200% of the section), so 23% / 20% is roughly 46% of the
   section's width and 40% of its height either side of centre. Blue only, fading to transparent. */
const GLOW = [
  'radial-gradient(ellipse 23% 20% at 50% 51%,',
  '#b6dbfb 0%,',
  '#c2e7ff 30%,',
  'rgba(194, 231, 255, 0.6) 55%,',
  'rgba(194, 231, 255, 0.25) 78%,',
  'rgba(194, 231, 255, 0) 100%)',
].join(' ');

const HIDDEN = { opacity: 0, transform: 'scale(0.35)' };
/** The hero's resting state: one pool of light, gathered behind the composer. */
const FOCUSED = { opacity: 1, transform: 'scale(1)' };
/* The workspace's resting state. Deliberately the same ellipse rather than a different image:
   opened out far enough that its falloff reaches every edge, it stops reading as a spot behind the
   middle of the page and becomes an even field. Keeping one light source is also what makes the
   change between the two tweenable at all — `background-image` cannot be animated, a transform
   can. Slightly dimmer, because the same colour spread over four times the area is otherwise
   heavier than the hero's. */
const SPREAD = { opacity: 0.85, transform: 'scale(2.4)' };

export function AuroraBackground({ variant = 'focused' }: { variant?: 'focused' | 'spread' } = {}) {
  const { user } = useApp();
  const signedIn = Boolean(user);
  const layer = useRef<HTMLDivElement>(null);
  /* The last session state the effect saw. Shrinking only plays on a real sign-out, so arriving
     signed out (including StrictMode's second effect pass) never flashes the glow. */
  const wasSignedIn = useRef(false);

  const spread = variant === 'spread';

  useEffect(() => {
    const signedOutNow = wasSignedIn.current && !signedIn;
    wasSignedIn.current = signedIn;
    const el = layer.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    /* Arriving in the workspace, the light opens out from where the hero left it. Because the two
       pages share one geometry and the hand-off is immediate, the eye reads this as the same glow
       continuing rather than a second one starting — so it plays once on arrival, not on every
       change of session. Slower than the islands settling in front of it, so the ground is still
       moving while the work is already readable. */
    if (spread) {
      if (!signedIn) return;
      const opening = el.animate([FOCUSED, SPREAD], {
        duration: 1100,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
      return () => opening.cancel();
    }

    if (!signedIn && !signedOutNow) return;
    const animation = signedIn
      ? el.animate([HIDDEN, FOCUSED], {
          duration: 2200,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)', // Fast start, long settle: it swells, then eases to rest.
        })
      : el.animate([FOCUSED, HIDDEN], { duration: 500, easing: 'ease-in' });
    return () => animation.cancel();
  }, [signedIn, spread]);

  return (
    <Box
      aria-hidden="true"
      position="absolute"
      inset="0"
      overflow="hidden"
      style={{ pointerEvents: 'none', zIndex: 0, background: GROUND }}
    >
      <Box
        ref={layer}
        position="absolute"
        style={{
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background: GLOW,
          filter: 'blur(60px)',
          ...(signedIn ? (spread ? SPREAD : FOCUSED) : HIDDEN),
        }}
      />
    </Box>
  );
}
