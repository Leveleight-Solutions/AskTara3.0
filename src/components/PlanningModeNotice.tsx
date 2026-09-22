import { Callout, Text } from '@radix-ui/themes';
import { useApp } from '../context';

export function PlanningModeNotice() {
  const { integrations } = useApp();
  if (integrations.ai) return null;
  return (
    <Callout.Root size="1" color="amber" role="note" aria-label="Basic planning mode">
      <Callout.Text>
        <Text weight="medium">Basic planning mode.</Text> AI chat is not connected. You can enter
        explicit trip details and edit proposals manually.
      </Callout.Text>
    </Callout.Root>
  );
}
