import { useEffect, useRef } from 'react';
import { Box } from '@radix-ui/themes';

/**
 * A slow, glowing gradient that drifts behind a section.
 *
 * Three soft radial blobs on the accent scale, heavily blurred and overlapping, each drifting on
 * its own long, prime-ish duration so the composite never visibly loops. Rendered with the Web
 * Animations API rather than CSS classes: `@keyframes` cannot be expressed inline, and the app's
 * convention is that components carry no `className` and the stylesheet holds no app styling.
 *
 * Colour comes from the Radix accent alpha scale, so it re-tints with the theme and sits correctly
 * on both light and dark backgrounds without a hardcoded value.
 */

type Drift = {
  /** Start position as a share of the container, so the blobs spread rather than stack. */
  top: string;
  left: string;
  /** Capped against the viewport's short edge: a rem-only size is wider than a phone screen,
   *  which turns the glow into a full-bleed wash instead of a bloom. */
  size: string;
  colorVar: string;
  /** Peak opacity; kept low so text contrast above it is never at risk. */
  opacity: number;
  durationMs: number;
  /** Travel in px. Small relative to the blur radius, which is what makes it read as a glow. */
  dx: number;
  dy: number;
  scale: number;
};

const BLOBS: Drift[] = [
  {
    top: '18%',
    left: '22%',
    size: 'min(46rem, 90vmin)',
    colorVar: '--accent-a5',
    opacity: 0.85,
    durationMs: 29000,
    dx: 90,
    dy: -60,
    scale: 1.14,
  },
  {
    top: '34%',
    left: '58%',
    size: 'min(38rem, 75vmin)',
    colorVar: '--accent-a4',
    opacity: 0.8,
    durationMs: 37000,
    dx: -110,
    dy: 70,
    scale: 1.2,
  },
  {
    top: '8%',
    left: '46%',
    size: 'min(30rem, 60vmin)',
    colorVar: '--accent-a3',
    opacity: 0.9,
    durationMs: 43000,
    dx: 60,
    dy: 90,
    scale: 0.88,
  },
];

export function AuroraBackground() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (!root || typeof root.animate !== 'function') return;

    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const animations: Animation[] = [];

    const start = () => {
      stop();
      if (query?.matches) return; // Static glow is the reduced-motion fallback, not a blank panel.
      root.querySelectorAll<HTMLElement>('[data-blob]').forEach((el, index) => {
        const { dx, dy, scale, durationMs } = BLOBS[index];
        animations.push(
          el.animate(
            [
              { transform: 'translate3d(0, 0, 0) scale(1)' },
              { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})` },
              { transform: 'translate3d(0, 0, 0) scale(1)' },
            ],
            {
              duration: durationMs,
              iterations: Infinity,
              easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
              // Offsetting the start keeps the three from swelling in unison.
              delay: -index * 4000,
            },
          ),
        );
      });
    };

    const stop = () => {
      animations.splice(0).forEach((animation) => animation.cancel());
    };

    start();
    query?.addEventListener?.('change', start);
    return () => {
      query?.removeEventListener?.('change', start);
      stop();
    };
  }, []);

  return (
    <Box
      ref={host}
      aria-hidden="true"
      position="absolute"
      inset="0"
      overflow="hidden"
      style={{ pointerEvents: 'none', zIndex: 0 }}
    >
      {BLOBS.map((blob, index) => (
        <Box
          key={index}
          data-blob=""
          position="absolute"
          style={{
            top: blob.top,
            left: blob.left,
            width: blob.size,
            height: blob.size,
            marginTop: `calc(${blob.size} / -2)`,
            marginLeft: `calc(${blob.size} / -2)`,
            opacity: blob.opacity,
            background: `radial-gradient(circle at center, var(${blob.colorVar}) 0%, transparent 68%)`,
            filter: 'blur(72px)',
            willChange: 'transform',
          }}
        />
      ))}
    </Box>
  );
}
