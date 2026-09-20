import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Box } from '@radix-ui/themes';

/**
 * The entrance itself, without a wrapper element.
 *
 * `RiseIn` below is the wrapper form, for content that can afford an extra `<div>`. Anything whose
 * element is load-bearing to its parent's layout — a grid child, say, where a wrapper would take
 * the track for itself — animates its own node through this instead.
 */
export function useRiseIn(
  host: RefObject<HTMLElement | null>,
  {
    originSelector,
    fallbackDistance = 120,
    durationMs = 620,
    delayMs = 60,
    enabled = true,
  }: {
    originSelector?: string;
    fallbackDistance?: number;
    durationMs?: number;
    delayMs?: number;
    enabled?: boolean;
  } = {},
) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = host.current;
    if (!el || typeof el.animate !== 'function') return;

    // Respect the OS setting: show the finished state rather than a faster animation.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    let distance = fallbackDistance;
    if (originSelector) {
      const origin = document.querySelector(originSelector);
      if (origin) {
        const gap = origin.getBoundingClientRect().top - el.getBoundingClientRect().top;
        // Only travel downward-to-up. A negative gap means the origin is above us, which is not
        // the effect being asked for, so fall back rather than animate the wrong way.
        if (gap > 0) distance = gap;
      }
    }

    const animation = el.animate(
      [
        { transform: `translate3d(0, ${Math.round(distance)}px, 0)`, opacity: 0 },
        { transform: 'translate3d(0, 0, 0)', opacity: 1 },
      ],
      {
        duration: durationMs,
        delay: delayMs,
        // Decelerating: quick off the mark, settles gently rather than arriving at speed.
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        // Holds the first keyframe through the delay, which is what lets several of these be
        // staggered without the later ones flashing in at full opacity first.
        fill: 'backwards',
      },
    );

    return () => animation.cancel();
  }, [host, originSelector, fallbackDistance, durationMs, delayMs, enabled]);
}

/**
 * Entrance animation: the wrapped content starts where another element sits and rises into its
 * own place as it fades in.
 *
 * The travel distance is measured at runtime rather than hardcoded, so the heading genuinely
 * starts at the composer's line whatever the viewport does to the gap between them — the hero is
 * fluid-sized and vertically centred, so a fixed offset would drift on every screen size.
 *
 * Uses the Web Animations API for the same reason AuroraBackground does: `@keyframes` cannot be
 * expressed inline, and this app keeps no app styling in the stylesheet.
 *
 * Stacking: this wrapper sits at z-index 0 so the origin element can be layered above it and
 * occlude the content on its way up. The origin must be positioned, above this, and opaque.
 */
export function RiseIn({
  children,
  /** CSS selector for the element to rise *from*. Falls back to `fallbackDistance` if not found. */
  originSelector,
  fallbackDistance = 120,
  durationMs = 620,
  delayMs = 60,
}: {
  children: ReactNode;
  originSelector?: string;
  fallbackDistance?: number;
  durationMs?: number;
  delayMs?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  useRiseIn(host, { originSelector, fallbackDistance, durationMs, delayMs });

  /* Positioned with an explicit z-index so the heading travels *behind* the composer rather than
     over it: a transformed element paints in the positioned layer, which would otherwise put it
     above an unpositioned sibling that comes later in the DOM. The composer carries a higher
     z-index and an opaque surface, so the text emerges from under it. */
  return (
    <Box ref={host} position="relative" style={{ zIndex: 0 }}>
      {children}
    </Box>
  );
}
