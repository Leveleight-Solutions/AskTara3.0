import { useEffect, useLayoutEffect, useState } from 'react';

/** Lines a stacked composer grows to before it scrolls; past this, expanding is the way to see more. */
const MAX_ROWS = 8;
/**
 * The expanded field takes the chat column's height, less the chrome that stays around it: the
 * workspace top bar, the pane header, the footer padding and the composer's own button row.
 */
const EXPANDED_HEIGHT = 'calc(100dvh - var(--app-header-height, 0px) - 250px)';

let canvas: HTMLCanvasElement | null = null;
function textWidth(text: string, style: CSSStyleDeclaration) {
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return Infinity;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}

/**
 * Gemini's composer behaviour for a message field inside a composer pill (`data-composer-pill`):
 *
 * - At rest the field is one line, sitting between the + and send buttons.
 * - Once the text wraps (or has a line break) the pill is `stacked`: the field takes the full width
 *   and grows with its content up to MAX_ROWS, and the buttons move to a row beneath it.
 * - Stacked, the field can be `expanded` to fill the column, and collapsed again.
 *
 * Going back to one line uses a slightly lower bar than leaving it (the text has to fit the
 * narrower row with room to spare), so a line that only just fits cannot flip the layout back and
 * forth as the field changes width between the two arrangements. Clearing the field — sending, for
 * instance — resets both states.
 */
export function useComposerLayout(value: string) {
  /* A callback ref held in state, so the layout is measured as soon as the field mounts — Studio
     calls this hook long before its workspace (and so the field) has loaded. */
  const [element, field] = useState<HTMLTextAreaElement | null>(null);
  const [stacked, setStacked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (!element) return;
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || 24;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const oneLine = Math.ceil(line + padding);
    const cap = Math.ceil(line * MAX_ROWS + padding);

    element.style.height = 'auto';
    const content = element.scrollHeight;

    let nextStacked: boolean;
    if (!value) nextStacked = false;
    else if (value.includes('\n')) nextStacked = true;
    else if (!stacked) nextStacked = content > oneLine + 2;
    else nextStacked = !fitsOnRow(element, value, style);

    if (nextStacked !== stacked) {
      // Measure again once the pill has rearranged; the field's width differs between layouts.
      setStacked(nextStacked);
      if (!nextStacked) setExpanded(false);
      return;
    }
    if (!value && expanded) setExpanded(false);

    if (expanded) {
      element.style.height = EXPANDED_HEIGHT;
      element.style.overflowY = 'auto';
    } else {
      element.style.height = `${stacked ? Math.min(content, cap) : oneLine}px`;
      element.style.overflowY = stacked && content > cap ? 'auto' : 'hidden';
    }
  }, [element, value, stacked, expanded, width]);

  return { field, stacked, expanded, setExpanded };
}

/** Whether the text fits on one line in the unstacked row, beside the + and send buttons. */
function fitsOnRow(element: HTMLTextAreaElement, value: string, style: CSSStyleDeclaration) {
  const pill = element.closest<HTMLElement>('[data-composer-pill]');
  if (!pill) return true;
  const pillStyle = getComputedStyle(pill);
  const gap = parseFloat(pillStyle.columnGap) || 8;
  const buttons = 40 * 2; // The + and send IconButtons, both size 3.
  const inner =
    pill.clientWidth - parseFloat(pillStyle.paddingLeft) - parseFloat(pillStyle.paddingRight);
  const fieldText =
    inner - buttons - gap * 2 - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  // 24px of slack: the hysteresis described above.
  return textWidth(value, style) < fieldText - 24;
}
