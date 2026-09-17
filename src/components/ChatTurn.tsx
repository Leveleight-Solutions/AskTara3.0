import { type CSSProperties, type ReactNode } from 'react';
import { Box, Flex, VisuallyHidden } from '@radix-ui/themes';
import { TaraMark } from './ui';

/** Tara's mark, at the size a conversation uses it. The pane headers use the same treatment
    larger, so she looks like one person throughout. */
export function TaraAvatar({ size = 28 }: { size?: number }) {
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      style={{
        width: size,
        height: size,
        borderRadius: '100%',
        background: 'var(--accent-3)',
        color: 'var(--accent-11)',
      }}
    >
      <TaraMark size={Math.round(size * 0.64)} />
    </Flex>
  );
}

/* A soft brand tint rather than a solid: step 3 is a tinted surface, so it marks the agent's own
   words without the weight of a filled block, and it stays clear of accent-9 — the solid the
   primary buttons use — so a conversation never reads as a column of buttons. Scale steps, not
   hex, so it still inverts if the theme's appearance ever changes. Link colour needs no override
   at this step: accent-11 on accent-3 is the pairing Radix designs for. */
const userBubble: CSSProperties = {
  background: 'var(--accent-3)',
  color: 'var(--accent-12)',
  borderRadius: 'var(--radius-4)',
  overflowWrap: 'anywhere',
};

/* Tara gets no surface at all. Her replies run long and carry markdown, so they read better as
   text on the panel than as a blob, and leaving the tint to one speaker keeps the pane calm. */
const assistantBubble: CSSProperties = { overflowWrap: 'anywhere' };

/* One turn of a conversation. Who spoke is carried by side, colour and the avatar, so the role
   label that used to sit above every turn is gone from the page — but not from the accessible
   name. These turns live in a role="log" aria-live region: without the hidden label a screen
   reader would hear two undifferentiated paragraphs, because none of the things that replaced it
   are things it can see. */
export function ChatTurn({
  role,
  testId,
  children,
  after,
}: {
  role: 'user' | 'assistant';
  testId?: string;
  children: ReactNode;
  /** Anything that belongs with the turn but outside its bubble — reply chips, suggestions. */
  after?: ReactNode;
}) {
  const assistant = role === 'assistant';
  return (
    <Flex gap="2" align="start" justify={assistant ? 'start' : 'end'}>
      {assistant && <TaraAvatar />}
      <Flex
        direction="column"
        gap="1"
        align={assistant ? 'start' : 'end'}
        minWidth="0"
        /* Tara's replies run long and take markdown, so they get the full column; a typed turn
           hugs its own length, which is what makes a transcript scannable at a glance. */
        style={{ maxWidth: assistant ? '100%' : '85%' }}
      >
        <Box
          asChild
          px={assistant ? '0' : '3'}
          py={assistant ? '1' : '2'}
          data-testid={testId}
          style={assistant ? assistantBubble : userBubble}
        >
          <article>
            <VisuallyHidden>{assistant ? 'Tara said' : 'You said'}</VisuallyHidden>
            {children}
          </article>
        </Box>
        {after}
      </Flex>
    </Flex>
  );
}
