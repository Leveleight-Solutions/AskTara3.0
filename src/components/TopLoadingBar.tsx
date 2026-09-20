import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Box } from '@radix-ui/themes';

/**
 * A thin progress strip across the top of the window while a page waits on its data.
 *
 * The progress is simulated, as it is in Gemini, YouTube and GitHub: a small JSON response reports
 * no real progress, so the bar creeps towards 80% on a decelerating curve and runs to the end when
 * the data lands. It only appears if the wait passes SHOW_DELAY_MS — a load that is already over
 * by then would otherwise flash a bar for a single frame, which is the flicker this exists to hide.
 *
 * Pages opt in with `useRouteLoading(loading)` instead of the bar listening to `api()`: a brief
 * review or a planning poll runs for many seconds and has its own labelled progress, and the bar
 * would sit there the whole time. Any number of callers can be loading at once; the bar runs until
 * the last one is done.
 *
 * Rendered with the Web Animations API, like AuroraBackground and RiseIn, because this app keeps
 * `@keyframes` and classNames out of the stylesheet. `aria-hidden`: every page that opts in already
 * announces its own loading state, and a second, wordless one would only be noise.
 */

const SHOW_DELAY_MS = 150;
const CREEP_MS = 8000;

let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const isLoading = () => active > 0;

/** Holds the top bar open for as long as `loading` is true and the calling component is mounted. */
export function useRouteLoading(loading: boolean) {
  useEffect(() => {
    if (!loading) return;
    active += 1;
    emit();
    return () => {
      active -= 1;
      emit();
    };
  }, [loading]);
}

export function TopLoadingBar() {
  const loading = useSyncExternalStore(subscribe, isLoading, () => false);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    const trackEl = track.current;
    const fillEl = fill.current;
    if (!trackEl || !fillEl || typeof fillEl.animate !== 'function') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cancelAll = () => {
      trackEl.getAnimations().forEach((animation) => animation.cancel());
      fillEl.getAnimations().forEach((animation) => animation.cancel());
    };

    if (loading) {
      const timer = window.setTimeout(() => {
        cancelAll();
        shown.current = true;
        trackEl.animate([{ opacity: 1 }], { duration: 0, fill: 'forwards' });
        fillEl.animate(
          reduced
            ? [{ transform: 'scaleX(0.8)' }]
            : [{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.8)' }],
          {
            duration: reduced ? 0 : CREEP_MS,
            // Most of the travel happens early, then it all but stalls near the end.
            easing: 'cubic-bezier(0.08, 0.7, 0.2, 1)',
            fill: 'forwards',
          },
        );
      }, SHOW_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    if (!shown.current) return;
    shown.current = false;
    // Finish from wherever the creep had got to, not from zero.
    const from = getComputedStyle(fillEl).transform;
    cancelAll();
    trackEl.animate([{ opacity: 1 }], { duration: 0, fill: 'forwards' });
    const complete = fillEl.animate([{ transform: from }, { transform: 'scaleX(1)' }], {
      duration: reduced ? 0 : 200,
      easing: 'ease-out',
      fill: 'forwards',
    });
    complete.onfinish = () => {
      // A new load may already have taken the bar over.
      if (shown.current) return;
      const fade = trackEl.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 250,
        easing: 'ease-in',
        fill: 'forwards',
      });
      fade.onfinish = () => {
        if (!shown.current) cancelAll();
      };
    };
  }, [loading]);

  return (
    <Box
      ref={track}
      aria-hidden="true"
      position="fixed"
      left="0"
      width="100%"
      style={{
        top: 'env(safe-area-inset-top, 0px)',
        height: 3,
        background: 'var(--gray-a4)',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <Box
        ref={fill}
        height="100%"
        style={{
          background: 'var(--accent-9)',
          transform: 'scaleX(0)',
          transformOrigin: 'left center',
        }}
      />
    </Box>
  );
}
