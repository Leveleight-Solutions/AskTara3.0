import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { CalendarDays, ChevronDown, Users } from 'lucide-react';
import { Button, Flex, Popover, Text } from '@radix-ui/themes';
import { TripDatePanel } from './TripDatePanel';
import { TripPartyPanel } from './TripPartyPanel';
import {
  describeDates,
  describeParty,
  type TripDates,
  type TripParty,
} from '../../shared/trip-details';

/* The two optional details the home composer can borrow — who is coming and when.

   They are a toolbar under the composer, not a form: one grey bar holding two quiet chips, each
   opening its own panel beneath itself. The modal they used to share was the wrong instrument
   twice over. It darkened the hero and took focus for what is a couple of taps, and it bundled two
   unrelated questions behind one button, so the chip you pressed was never the field you landed
   on. Anchoring each panel to its own chip keeps the question where the answer will show. */

type ChipProps = {
  icon: ReactNode;
  label: string;
  /** Whether it has been answered: a set chip keeps the raised fill, so the bar reads back what
      the composer already knows without a panel being open. */
  set: boolean;
  /** Wide enough for what is inside, and never wider than the phone it is on. The party panel is a
      narrow card; the calendar wants two months side by side when there is room. */
  contentWidth: string;
  /** The chip whose leading edge every panel lines up on — the first one in the tray. Given to the
      chips that are not it, so their panel starts on that same line instead of under themselves. */
  lead?: RefObject<HTMLButtonElement | null>;
  /** Set on the lead chip so the others can measure it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: (close: () => void) => ReactNode;
};

function DetailChip({ icon, label, set, contentWidth, lead, triggerRef, children }: ChipProps) {
  const [open, setOpen] = useState(false);
  const self = useRef<HTMLButtonElement>(null);
  /* How far this chip sits from the line the panels share. Measured when the panel opens rather
     than assumed, because the lead chip's width is its answer: "Who’s travelling?" and "3 adults"
     are different lengths, so the distance is not a constant anyone could write down here. */
  const [alignOffset, setAlignOffset] = useState(0);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next && lead?.current && self.current)
          setAlignOffset(
            lead.current.getBoundingClientRect().left - self.current.getBoundingClientRect().left,
          );
        setOpen(next);
      }}
    >
      <Popover.Trigger>
        {/* One variant throughout, with .chip in src/styles.css carrying the fixed geometry and
            the fill for rest, hover, open and answered. Popover.Trigger sets data-state on the
            button, so open needs no state of its own in CSS; `set` is passed down beside it so
            both fills come from the same rule. */}
        {/* No radius prop: Radix's radius props rescale --radius-1..6 on the element they are set
            on, so the .chip rule's "tray corner less the gap" would have been measured against a
            larger scale than the tray's own and come out too round. The class owns the corner. */}
        <Button
          ref={(node: HTMLButtonElement | null) => {
            self.current = node;
            if (triggerRef) triggerRef.current = node;
          }}
          type="button"
          size="2"
          color="gray"
          variant="ghost"
          className="chip"
          data-chip-set={set}
        >
          {icon}
          {/* The label sets its own colour rather than inheriting the button's, because the two
              want different steps of the same scale: the chip's colour dresses the icons at step
              11, and the label takes step 12, the scale's high-contrast text step. The tray is
              translucent over the hero's glow and composites out dark enough that step 11, the
              scale's low-contrast text step, measures 4.26:1 under a resting label and 3.52:1
              under a hovered one — under the floor for something that has to be read. Step 12
              measures 11.77:1 and 9.71:1 on the same two grounds.

              What none of this reaches is the dark appearance. AuroraBackground paints the hero a
              fixed light hex whichever appearance is on, so a translucent tray stays pale there
              while this label goes near-white: 1.05:1, with nothing in the scale's text steps able
              to fix it. The chips that are open or answered are fine, because they sit on the
              opaque panel colour. It is unreachable today — the Theme in main.tsx takes Radix's
              "inherit", which does not follow prefers-color-scheme — but it is the hero's ground
              that has to change before this file can be held to anything there. */}
          <Text size="2" color="gray" highContrast weight={set ? 'medium' : 'regular'}>
            {label}
          </Text>
          {/* No opacity on the chevron. Fading it to 0.55 put it at 2.05:1 against the tray, which
              is not a mark anyone can rely on seeing; at full strength it is 4.26:1 and stays
              quieter than the leading icon by being smaller, which costs nothing legible. */}
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      {/* Every panel starts on the same line: the leading edge of the first chip in the tray, which
          is also the line the tray's own content starts on. Hanging each panel under its own chip
          instead would give the two panels two different left edges, and opening one after the
          other would shift the whole reading position sideways. Radix slides a panel back into view
          on a screen too narrow to hold it, which is the only case where it leaves that line. */}
      <Popover.Content
        size="1"
        align="start"
        alignOffset={alignOffset}
        sideOffset={8}
        style={{ width: contentWidth, maxWidth: 'calc(100vw - var(--space-5))' }}
      >
        {children(() => setOpen(false))}
      </Popover.Content>
    </Popover.Root>
  );
}

type Props = {
  party: TripParty | undefined;
  onParty: (value: TripParty | undefined) => void;
  dates: TripDates | undefined;
  onDates: (value: TripDates | undefined) => void;
};

export function TripDetailChips({ party, onParty, dates, onDates }: Props) {
  const lead = useRef<HTMLButtonElement>(null);
  return (
    /* A tray on the underside of the composer, inset from its edges and running its width, which is
       what ties the two chips to the field they qualify instead of leaving them floating in the
       hero. The chips sit at its leading edge and are free to wrap onto a second line on a narrow
       phone rather than being squeezed; .chip-bar in src/styles.css carries the shape.

       12px between them, down from 24px. The 24px came from a reference whose actions are text
       with no box around them, where that is the distance between two labels; ours carry 12px of
       padding each, so the same 24px put 48px between the two labels and left the pair reading as
       two loose controls rather than one set of details. 12px holds them together and still clears
       the 8px minimum between two targets. */
    <Flex align="center" gap="3" wrap="wrap" justify="start" className="chip-bar">
      <DetailChip
        icon={<Users size={15} aria-hidden="true" />}
        label={party ? describeParty(party) : 'Who’s travelling?'}
        set={party !== undefined}
        contentWidth="280px"
        triggerRef={lead}
      >
        {(close) => (
          <TripPartyPanel
            value={party}
            onApply={(value) => {
              onParty(value);
              close();
            }}
          />
        )}
      </DetailChip>
      <DetailChip
        icon={<CalendarDays size={15} aria-hidden="true" />}
        label={dates ? describeDates(dates) : 'Add dates'}
        set={dates !== undefined}
        contentWidth="620px"
        lead={lead}
      >
        {(close) => (
          <TripDatePanel
            value={dates}
            onApply={(value) => {
              onDates(value);
              close();
            }}
          />
        )}
      </DetailChip>
    </Flex>
  );
}
