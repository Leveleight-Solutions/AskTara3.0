import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button, Flex, IconButton, Separator, Text } from '@radix-ui/themes';
import { MAX_ADULTS, MAX_CHILDREN, emptyParty, type TripParty } from '../../shared/trip-details';

/* The panel that hangs under the hero's "Who’s travelling?" chip.

   It asks for adults and children separately rather than one head count, because the two plan
   into different trips: four friends and a family of four want different rooms, different pacing
   and different evenings, and a single number cannot tell Tara which of them she is planning for.

   Unlike the one-tap panels beside it, this one commits on Apply. A stepper is pressed several
   times on the way to an answer, so closing on the first press would take the panel away
   mid-count; the draft below is what lets the user arrive at the number before it is spent. */

type RowProps = {
  label: string;
  /** The age band, spelled out because where a trip draws the line between the two is the
      client's question as often as it is ours. */
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  addLabel: string;
  removeLabel: string;
  /** What the bare numeral should read as out of context, e.g. `2 adults`. describeParty is the
      wrong tool here: it narrates a whole party, so a row would announce the count it is not
      changing alongside the one it is. */
  describe: (value: number) => string;
};

function CountRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  addLabel,
  removeLabel,
  describe,
}: RowProps) {
  return (
    <Flex align="center" justify="between" gap="3">
      <Flex direction="column">
        <Text size="2" weight="medium">
          {label}
        </Text>
        <Text size="1" color="gray">
          {hint}
        </Text>
      </Flex>
      <Flex align="center" gap="2">
        {/* Disabled at the limit rather than left to no-op, so the ceiling is visible on the
            control before it is reached instead of reading as a button that has stopped
            working. */}
        <IconButton
          type="button"
          size="1"
          variant="soft"
          color="gray"
          radius="full"
          aria-label={removeLabel}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus size={14} aria-hidden="true" />
        </IconButton>
        {/* The count sits between the two controls and is the only thing a press changes, so it
            announces itself: a screen reader user otherwise presses + and hears nothing back.
            Sizing it in `ch` stops the plus button shuffling sideways as the count crosses into
            double figures. */}
        <Text
          as="div"
          size="2"
          weight="medium"
          align="center"
          aria-live="polite"
          aria-label={describe(value)}
          style={{ minWidth: '2ch' }}
        >
          {value}
        </Text>
        <IconButton
          type="button"
          size="1"
          variant="soft"
          color="gray"
          radius="full"
          aria-label={addLabel}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus size={14} aria-hidden="true" />
        </IconButton>
      </Flex>
    </Flex>
  );
}

type Props = {
  /** Undefined when the chip has not been answered yet. */
  value: TripParty | undefined;
  /** Undefined stays in the type because the parent shares this signature with the date panel;
      this panel only ever calls it with the applied party. The parent closes the popover. */
  onApply: (value: TripParty | undefined) => void;
};

export function TripPartyPanel({ value, onApply }: Props) {
  /* The popover unmounts this panel between openings, so the initialiser is the whole of the
     sync: each opening reads the party the chip is currently holding, and a draft the user walked
     away from dies with the panel rather than being carried into the next opening. */
  const [draft, setDraft] = useState<TripParty>(value ?? emptyParty());
  /* A minimum rather than a width: the popover decides how wide the panel is, and this only keeps
     the two columns from collapsing onto each other when it has nothing else to go on. */
  return (
    <Flex direction="column" gap="3" minWidth="236px">
      <Text size="2" weight="medium">
        Who’s coming?
      </Text>
      <Flex direction="column" gap="2">
        {/* Adults floor at one because somebody is going: a party of nobody is not an answer the
            brief could do anything with, and zero adults with children is not one either. */}
        <CountRow
          label="Adults"
          hint="Aged 18+"
          value={draft.adults}
          min={1}
          max={MAX_ADULTS}
          onChange={(adults) => setDraft((party) => ({ ...party, adults }))}
          addLabel="Add an adult"
          removeLabel="Remove an adult"
          describe={(count) => `${count} ${count === 1 ? 'adult' : 'adults'}`}
        />
        <Separator size="4" />
        <CountRow
          label="Children"
          hint="Aged 0–17"
          value={draft.children}
          min={0}
          max={MAX_CHILDREN}
          onChange={(children) => setDraft((party) => ({ ...party, children }))}
          addLabel="Add a child"
          removeLabel="Remove a child"
          describe={(count) => `${count} ${count === 1 ? 'child' : 'children'}`}
        />
      </Flex>
      <Button type="button" size="2" style={{ width: '100%' }} onClick={() => onApply(draft)}>
        Apply
      </Button>
    </Flex>
  );
}
