import { useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  SegmentedControl,
  Separator,
  Text,
} from '@radix-ui/themes';
import { describeMonth, readDay, type TripDates } from '../../shared/trip-details';

/* The panel behind the hero's "Add dates" chip.

   A client answering this question is in one of two states, and they are not the same question. One
   knows the days and wants a calendar; the other knows only that it is "somewhere around spring" and
   would be forced to invent a date by a calendar. A segmented control at the top lets them say which
   they are rather than making the precise answer the only answer, which is why the flexible side
   collects whole months and the brief can carry them honestly.

   Both sides ask the same thing — when you leave and when you come back — and differ only in how
   finely the answer is known, so both are picked with one gesture over keys that sort as strings:
   `extendSpan` and `spanRole` below serve the calendar and the month grid alike. The flexible side
   is a span and never a list of candidates: December 2026 to January 2027 is one trip across the
   new year, not a choice between two trips.

   Everything here is drawn from Radix tokens rather than a stylesheet of its own: the app ships a
   light and a dark theme, and a fill written as a literal would only be legible in one of them. */

const WEEKDAY_INITIALS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];

/** How far ahead the flexible side looks. A year is the horizon a client can actually picture, and
    twelve cards still fit a phone without becoming a scroller inside a popover. */
const FLEXIBLE_MONTHS = 12;

const pad = (value: number) => String(value).padStart(2, '0');

/* Both keys are built from the local calendar fields rather than toISOString, which converts to UTC
   first and so names yesterday's day (and, on the first of a month, last month) anywhere east or
   west far enough of Greenwich. */
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const monthKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

/** Month arithmetic on the `YYYY-MM` key, leaning on Date's own rollover so December + 1 becomes
    January of the next year without a special case here. */
function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  return monthKey(new Date(year, index - 1 + by, 1));
}

/** The cells of one month, Sunday first, with leading blanks so the 1st sits under its own weekday.
    Day 0 of the following month is the last day of this one, which is how the length is found. */
function monthCells(month: string): (string | null)[] {
  const [year, index] = month.split('-').map(Number);
  const leading = new Date(year, index - 1, 1).getDay();
  const length = new Date(year, index, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= length; day += 1) cells.push(`${month}-${pad(day)}`);
  return cells;
}

/* A bare numeral says nothing out of the grid's context, so the accessible name spells the date out.
   Assembled from two calls because the one-shot formats put the weekday and the day either side of
   the locale's own comma rules, and the day-month-year order is what this app's copy uses. */
function describeDay(day: string): string {
  const date = readDay(day);
  const weekday = date.toLocaleDateString('en-AU', { weekday: 'long' });
  const rest = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${weekday}, ${rest}`;
}

/** A span at either grain: `YYYY-MM-DD` days on the calendar side, `YYYY-MM` months on the flexible
    one. `end` stays empty until the return is picked, which is a complete answer in itself. */
type Span = { start: string; end: string };

/** What a cell is doing in the current span: an edge is one the client tapped, between is the run
    the two edges imply. */
type SpanRole = 'edge' | 'between' | 'plain';

/* One rule for both grids. A first tap always opens a fresh span, and so does a tap on or before
   the start — dragging the opening date earlier is far commoner than wanting a return before the
   departure, so treating it as a restart means a mis-tap never leaves an inverted span to undo. */
function extendSpan(span: Span, key: string): Span {
  return span.start === '' || key <= span.start ? { start: key, end: '' } : { ...span, end: key };
}

/* Both key formats are fixed-width and zero-padded, so a plain string comparison orders them and
   the whole question — is this cell an end, is it inside — needs no parsed Date at all. */
function spanRole(key: string, span: Span): SpanRole {
  if (key === span.start || (span.end !== '' && key === span.end)) return 'edge';
  return span.end !== '' && key > span.start && key < span.end ? 'between' : 'plain';
}

/** How much of a cell's own box the band has to cover to reach its neighbours: straight through the
    middle of the span, or the half of an end cell that faces the other end. */
type BandSide = 'through' | 'forward' | 'back' | 'none';

/* Membership is settled once, in spanRole, and only the direction is decided here: a departure with
   no return yet is a circle standing on its own, so a span that is still a single point gets no band
   at all — and the same guard covers a stored span whose two ends are the same key. */
function bandFor(key: string, span: Span): BandSide {
  if (span.end === '' || span.end === span.start) return 'none';
  const role = spanRole(key, span);
  if (role === 'between') return 'through';
  if (role !== 'edge') return 'none';
  return key === span.start ? 'forward' : 'back';
}

/* Every cell is drawn in two layers: a square box carrying the band, and a face inside it carrying
   the fill. The band is what makes a span read as one stretch rather than a row of tiles — it is
   painted to the cell's own edges, so with no column gap the tint of one day meets the next with no
   seam, and under the two end cells it is a half box that runs out from behind the circle towards
   the rest of the span. That half is why the circles are not left marooned: the face's curve would
   otherwise cut a notch out of the band at each end.

   An end cell's band is a gradient rather than a narrower box because the fill has to reach the
   cell's edge on one side and stop dead at its centre on the other, which no single background
   colour can do. Nothing is painted on the leading blanks of a month, so a span that begins or ends
   against a row edge simply stops there rather than bleeding into empty cells. */
const bandLayer = (side: BandSide) =>
  side === 'through'
    ? 'var(--accent-3)'
    : side === 'forward'
      ? 'linear-gradient(to right, transparent 50%, var(--accent-3) 50%)'
      : side === 'back'
        ? 'linear-gradient(to left, transparent 50%, var(--accent-3) 50%)'
        : /* Spelled out rather than left unset: an unstyled button keeps the user agent's own grey
             buttonface, which put a tile behind every day in the grid. */
          'transparent';

/** A true circle, which `var(--radius-full)` cannot give: Radix defines that token as 0px under
    every theme radius but "full", so it would square off the ends on this app's theme. */
const CIRCLE = '50%';

/* The outer box of a day: square and gapless so the band it carries is continuous, with the 32px
   rhythm of the grid unchanged. */
function dayCellStyle(side: BandSide, disabled: boolean): CSSProperties {
  return {
    width: 'var(--space-6)',
    height: 'var(--space-6)',
    display: 'inline-flex',
    padding: 0,
    border: 'none',
    borderRadius: 0,
    /* A bare button keeps the user agent's own font, which is not the one the rest of the hero is
       set in. */
    font: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    background: bandLayer(side),
  };
}

/* The face of a day, where the span shows what it is worth: step 9 is the solid fill Radix pairs
   with --accent-contrast, step 3 the tint it keeps behind --accent-12, and both flip with the theme
   so the span survives dark mode without a second set of values. The two ends are circles, which is
   the shape that says "this day, exactly" against a band that says "and everything through here";
   the days between keep no face of their own and let the band show. */
function dayFaceStyle(
  role: SpanRole,
  disabled: boolean,
  hovered: boolean,
  today: boolean,
): CSSProperties {
  const color =
    role === 'edge'
      ? 'var(--accent-contrast)'
      : role === 'between'
        ? 'var(--accent-12)'
        : disabled
          ? 'var(--gray-a8)'
          : 'var(--gray-12)';
  return {
    width: '100%',
    height: '100%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: role === 'edge' ? CIRCLE : 'var(--radius-2)',
    background:
      role === 'edge' ? 'var(--accent-9)' : hovered && !disabled ? 'var(--gray-a3)' : 'transparent',
    color,
    /* Today is outlined rather than filled: it is the grid's landmark, not a selection, and it is
       one of the days that cannot be picked. */
    boxShadow: today && role === 'plain' ? 'inset 0 0 0 1px var(--gray-a7)' : undefined,
  };
}

type MonthProps = {
  month: string;
  span: Span;
  /** Today's key, which is also the floor: a trip cannot start in the past or this morning. */
  today: string;
  onPick: (day: string) => void;
};

function MonthGrid({ month, span, today, onPick }: MonthProps) {
  /* Hover lives in state because these cells are styled from tokens inline and so have no rule of
     their own to hang a :hover on. It is scoped to the month the pointer is in, so moving across one
     grid never re-renders the other. */
  const [hovered, setHovered] = useState('');
  return (
    <Flex direction="column" gap="1" align="center">
      <Grid columns="repeat(7, var(--space-6))" mb="1">
        {WEEKDAY_INITIALS.map((initial) => (
          <Text key={initial} size="1" color="gray" align="center" aria-hidden="true">
            {initial}
          </Text>
        ))}
      </Grid>
      {/* Gapless on purpose: a column gap would cut the band into seven pieces a row, and the space
          a span needs to breathe is already inside each cell, between its 32px box and the circle
          inscribed in it.

          A group rather than role="grid": the cells are ordinary buttons a screen reader can tab
          through, and claiming the grid role without the row and cell roles under it would promise
          a two-dimensional widget that is not there. */}
      <Grid
        columns="repeat(7, var(--space-6))"
        gap="0"
        role="group"
        aria-label={describeMonth(month)}
      >
        {monthCells(month).map((day, index) =>
          day === null ? (
            <Box key={`blank-${index}`} />
          ) : (
            <DayCell
              key={day}
              day={day}
              span={span}
              today={today}
              hovered={hovered === day}
              onHover={setHovered}
              onPick={onPick}
            />
          ),
        )}
      </Grid>
    </Flex>
  );
}

type DayProps = {
  day: string;
  span: Span;
  today: string;
  hovered: boolean;
  onHover: (day: string) => void;
  onPick: (day: string) => void;
};

function DayCell({ day, span, today, hovered, onHover, onPick }: DayProps) {
  const disabled = day <= today;
  const role = spanRole(day, span);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={describeDay(day)}
      /* The tinted days between the two ends are part of the answer, so they read as pressed too —
         a reader that announced only the two edges would describe a trip with a hole in it. */
      aria-pressed={role !== 'plain'}
      onClick={() => onPick(day)}
      onMouseEnter={() => onHover(day)}
      onMouseLeave={() => onHover('')}
      style={dayCellStyle(bandFor(day, span), disabled)}
    >
      <span style={dayFaceStyle(role, disabled, hovered, day === today)}>
        <Text size="2">{Number(day.slice(8))}</Text>
      </span>
    </button>
  );
}

type MonthCardProps = {
  month: string;
  role: SpanRole;
  band: BandSide;
  onPick: (month: string) => void;
};

function MonthCard({ month, role, band, onPick }: MonthCardProps) {
  /* describeMonth is the one place a month is turned into words, so the card takes its two lines
     from that string rather than keeping a second table of month names that could drift from it. */
  const [name, year] = describeMonth(month).split(' ');
  return (
    <button
      type="button"
      /* A month between the two ends is as much part of the trip as the ends are — a span that
         announced only its edges would read as two separate answers. */
      aria-pressed={role !== 'plain'}
      aria-label={describeMonth(month)}
      onClick={() => onPick(month)}
      /* The same two layers as a day, for the same reason: the band belongs to the square box so a
         run of months meets edge to edge, and the card keeps its own rounded shape on the face
         above it. Cards are the wrong shape to make circles of — a month is a stretch of time, not
         a point — so only the calendar's ends are round. */
      style={{
        /* The gap between two cards is inset here rather than taken out of the grid: a column gap
           would cut the band as well, and the band is the one thing that has to survive the join.
           The box stays edge to edge and the face steps back from its sides, so unselected months
           read as separate cards again while the tint passes behind the space between them. */
        padding: '0 var(--space-1)',
        border: 'none',
        borderRadius: 0,
        font: 'inherit',
        cursor: 'pointer',
        background: bandLayer(band),
      }}
    >
      <span
        style={{
          display: 'flex',
          width: '100%',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-3)',
          /* A month inside the span carries no face of its own, so the band runs through it whole
             rather than showing as a tint in the corners the card's radius leaves over. */
          background:
            role === 'edge'
              ? 'var(--accent-9)'
              : role === 'between'
                ? 'transparent'
                : 'var(--gray-a3)',
          /* Set once on the face so both lines inherit it; the contrast token is the only colour
             Radix guarantees against step 9 in either theme. */
          color:
            role === 'edge'
              ? 'var(--accent-contrast)'
              : role === 'between'
                ? 'var(--accent-12)'
                : 'var(--gray-12)',
        }}
      >
        <Flex direction="column" align="center" gap="0" flexGrow="1">
          <Text size="1" style={{ opacity: 0.7 }}>
            {year}
          </Text>
          <Text size="2" weight="medium">
            {name}
          </Text>
        </Flex>
      </span>
    </button>
  );
}

/* The switch at the top is the one control here that says which KIND of answer is being given, so
   its chosen side carries the accent — but in the label, not in the fill. The thumb keeps Radix's
   own panel colour, the same white the composer and its notices are made of, and the chosen side's
   text turns --accent-11.

   Two fills were tried first and neither belonged. A tinted thumb (accent-3, then accent-4) sat
   inside Radix's grey ring, so one small shape carried two hue families, and directly above the grey
   month cards the tint read as lavender rather than as the app's blue. A solid --accent-9 thumb was
   louder than the answer it governs: the largest block of saturated colour on the panel, sinking the
   32px circles below it, and in the same fill as Apply, which is the panel's only commit. Colour in
   the text says "this one" at the weight of a mode.

   Set per item rather than on the root because only the chosen side is blue; the other stays on
   Radix's grey. The thumb's white against the track and Radix's own weight change still mark the
   live side, so it is never told apart by colour alone. --accent-11 is the accent's accessible text
   step and clears 4.5:1 on the white thumb. */
const modeItemStyle = (chosen: boolean): CSSProperties => ({
  color: chosen ? 'var(--accent-11)' : undefined,
});

type Props = {
  /** Undefined until the chip has been answered. */
  value: TripDates | undefined;
  /** Apply hands back the dates and the parent closes the popover. The undefined in the signature is
      the parent's own vocabulary for a cleared chip, which both detail panels share; this one has no
      clear of its own, so it only ever passes a span. */
  onApply: (value: TripDates | undefined) => void;
};

export function TripDatePanel({ value, onApply }: Props) {
  const today = dayKey(new Date());
  const thisMonth = today.slice(0, 7);

  /* Every piece of state is seeded once from the answer already on the chip. The popover unmounts
     when it closes, so the next opening re-runs these initialisers with the applied value — an
     effect that copied the prop into state would only fire on a mount that has already happened. */
  const [mode, setMode] = useState<TripDates['mode']>(value?.mode ?? 'specific');
  /* The two grains are kept as two drafts rather than one converted between them, because the
     conversion lies in both directions: a month span asked for exact days would invent the 1st and
     the 31st, and exact days flattened to months would quietly widen the answer to the whole month
     at each end. Switching the segmented control therefore shows what that side was last told, and
     only the side on screen is what Apply hands back. */
  const [daySpan, setDaySpan] = useState<Span>(() =>
    value?.mode === 'specific' ? { start: value.start, end: value.end } : { start: '', end: '' },
  );
  const [monthSpan, setMonthSpan] = useState<Span>(() =>
    value?.mode === 'flexible' ? { start: value.start, end: value.end } : { start: '', end: '' },
  );
  /* The window opens on the month being edited, but never behind the current one: a date already
     applied can age past today while the chip sits there unanswered for a week. */
  const [anchor, setAnchor] = useState(() => {
    const seed = daySpan.start.slice(0, 7);
    return seed > thisMonth ? seed : thisMonth;
  });

  const flexibleMonths = Array.from({ length: FLEXIBLE_MONTHS }, (_, index) =>
    shiftMonth(thisMonth, index),
  );

  const pickDay = (day: string) => setDaySpan((current) => extendSpan(current, day));
  const pickMonth = (month: string) => setMonthSpan((current) => extendSpan(current, month));

  const span = mode === 'specific' ? daySpan : monthSpan;

  const draft: TripDates =
    mode === 'specific'
      ? { mode: 'specific', start: daySpan.start, end: daySpan.end }
      : { mode: 'flexible', start: monthSpan.start, end: monthSpan.end };

  /* A departure on its own is a complete answer — a client who knows when they fly out and not when
     they come back is the ordinary case — so only a span with no beginning at all is unanswerable,
     and only on the side currently showing. */
  const canApply = span.start !== '';

  /* The hint carries the instruction until it can carry the answer, which is the one moment the
     panel has to teach a two-tap gesture. Read back in full month names rather than the chip's
     abbreviations: there is room here, and the year is the whole point of a span like this one. */
  const hint =
    mode === 'flexible'
      ? monthSpan.start === ''
        ? 'Tap the month you would leave, then the month you would come back'
        : monthSpan.end === '' || monthSpan.end === monthSpan.start
          ? `${describeMonth(monthSpan.start)} — tap a later month to come back`
          : `${describeMonth(monthSpan.start)} – ${describeMonth(monthSpan.end)}`
      : daySpan.start === ''
        ? 'Choose the day you would like to travel'
        : daySpan.end === ''
          ? 'Add a return day, or apply just the one'
          : 'Tap a day to start again';

  return (
    <Flex direction="column" gap="3">
      <SegmentedControl.Root
        size="1"
        value={mode}
        onValueChange={(next) => setMode(next as TripDates['mode'])}
        aria-label="How firm are the dates?"
      >
        <SegmentedControl.Item value="specific" style={modeItemStyle(mode === 'specific')}>
          Specific dates
        </SegmentedControl.Item>
        <SegmentedControl.Item value="flexible" style={modeItemStyle(mode === 'flexible')}>
          Flexible dates
        </SegmentedControl.Item>
      </SegmentedControl.Root>

      {mode === 'specific' ? (
        <Flex direction="column" gap="2">
          {/* The chevrons sit outside the captions so they stay put as the months change under
              them, and the caption row mirrors the grid below it column for column. */}
          <Flex align="center" gap="2">
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Previous month"
              disabled={anchor <= thisMonth}
              onClick={() => setAnchor(shiftMonth(anchor, -1))}
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </IconButton>
            <Grid columns={{ initial: '1', sm: '2' }} gap="4" flexGrow="1">
              {/* Both captions are blocks so align="center" has a box to centre within; a bare
                  inline span would shrink to its text and sit wherever the grid put it. */}
              <Text as="p" size="2" weight="medium" align="center">
                {describeMonth(anchor)}
              </Text>
              <Box display={{ initial: 'none', sm: 'block' }}>
                <Text as="p" size="2" weight="medium" align="center">
                  {describeMonth(shiftMonth(anchor, 1))}
                </Text>
              </Box>
            </Grid>
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              aria-label="Next month"
              onClick={() => setAnchor(shiftMonth(anchor, 1))}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </IconButton>
          </Flex>
          {/* Two months are a luxury of width, not of information: the second is dropped below the
              small breakpoint so a 390px phone shows one month whole rather than two squeezed or a
              panel that scrolls sideways. A responsive prop does this at the same breakpoint the
              rest of the app uses, which a JS media query would have to guess at. */}
          <Grid columns={{ initial: '1', sm: '2' }} gap="4">
            <MonthGrid month={anchor} span={daySpan} today={today} onPick={pickDay} />
            <Box display={{ initial: 'none', sm: 'block' }}>
              <MonthGrid
                month={shiftMonth(anchor, 1)}
                span={daySpan}
                today={today}
                onPick={pickDay}
              />
            </Box>
          </Grid>
        </Flex>
      ) : (
        /* No column gap, for the calendar's reason: a December-to-January answer has to read as one
           stretch across the row rather than as two cards that happen to share a colour. The rows
           are still held apart, since nothing runs between them. */
        <Grid columns={{ initial: '2', sm: '3' }} gapX="0" gapY="2">
          {flexibleMonths.map((month) => (
            <MonthCard
              key={month}
              month={month}
              role={spanRole(month, monthSpan)}
              band={bandFor(month, monthSpan)}
              onPick={pickMonth}
            />
          ))}
        </Grid>
      )}

      <Separator size="4" />
      {/* Apply is the panel's only commit. Leaving the chip alone already says "not sure yet", so a
          button that said it again would be a second way to do nothing, sitting where the eye looks
          for the way forward. */}
      <Flex align="center" justify="between" gap="3">
        <Text size="1" color="gray">
          {hint}
        </Text>
        <Button type="button" size="1" disabled={!canApply} onClick={() => onApply(draft)}>
          Apply
        </Button>
      </Flex>
    </Flex>
  );
}
