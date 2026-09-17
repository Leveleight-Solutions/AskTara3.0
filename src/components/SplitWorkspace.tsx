import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Box, Flex, Grid, Tabs } from '@radix-ui/themes';
import { useRiseIn } from './RiseIn';

export type PaneTab = 'primary' | 'secondary';

type PaneTabLabel = { label: string; icon?: ReactNode; badge?: ReactNode };

type SplitWorkspaceProps = {
  /* A strip spanning both panes, above them. Studio puts its stage bar and its error callout here;
     the concierge planner has no such chrome and passes nothing. It sits inside the shell, so it
     must not be added to --app-header-height. */
  topBar?: ReactNode;
  /* Below `md` there is only room for one pane, so the two become tabs. The state lives with the
     caller rather than in here: Studio has to be able to drive it, because an action in the right
     pane (import a source, ask for another route) targets an element in the left one.

     The hidden pane is hidden with `display: none` and never with Tabs.Content. Tabs.Content
     unmounts what it is not showing, which would silently discard a half-typed message every time
     the agent glanced at the canvas. */
  tab: PaneTab;
  onTabChange: (tab: PaneTab) => void;
  tabs: { primary: PaneTabLabel; secondary: PaneTabLabel };
  tabsLabel: string;
  /* `aside` is complementary, `section` is region. The conversation is an aside beside the canvas
     it is driving; the canvas is the region. */
  primaryAs?: 'aside' | 'section';
  primaryLabel: string;
  /* Fixed above the scroll region, and fixed below it — the pane's identity and its composer stay
     put while the body between them scrolls. Each band brings its own padding and border: the
     shell only stops them from shrinking. */
  primaryHeader?: ReactNode;
  primary: ReactNode;
  primaryFooter?: ReactNode;
  primaryPadding?: '0' | '3' | '4';
  primaryBodyTestId?: string;
  secondaryLabel: string;
  secondaryHeader?: ReactNode;
  secondary: ReactNode;
  secondaryPadding?: '0' | '3' | '4';
  secondaryBackground?: string;
  /* Wraps the right pane's header and body in one provider. Studio needs it so its Tabs.Root can
     enclose both: the Tabs.List stays pinned as the pane header while Tabs.Content scrolls. */
  secondaryWrap?: (bands: ReactNode) => ReactNode;
  /* 43/57 suits a list of itinerary days. A denser right pane can ask for more room. */
  columns?: { initial: string; md: string };
  /* `flush` is the original: panes meeting edge to edge, divided by a rule. `islands` floats the
     top bar and each pane as a rounded card over `background`, so a page can carry its own ground
     through the workspace instead of the workspace painting over it. Opt-in, because rounding a
     pane also clips it — anything sticky inside one would stop sticking. */
  surface?: 'flush' | 'islands';
  /* Painted behind the panes in `islands` mode. Absolutely positioned; the shell hosts it. */
  background?: ReactNode;
};

/* The full-height two-pane workspace: a fixed shell whose panes scroll independently, so neither
   one drags the other around. Both the concierge planner and Agent Studio render through this.

   Every descendant of the viewport-height box needs `minHeight: 0` — a flex or grid child defaults
   to min-height:auto, which refuses to shrink below its content and pushes the overflow onto the
   page instead of into the pane. */
export function SplitWorkspace({
  topBar,
  tab,
  onTabChange,
  tabs,
  tabsLabel,
  primaryAs = 'section',
  primaryLabel,
  primaryHeader,
  primary,
  primaryFooter,
  primaryPadding = '4',
  primaryBodyTestId,
  secondaryLabel,
  secondaryHeader,
  secondary,
  secondaryPadding = '0',
  secondaryBackground = 'var(--gray-2)',
  secondaryWrap,
  columns,
  surface = 'flush',
  background,
}: SplitWorkspaceProps) {
  const islands = surface === 'islands';
  const panes = useRef<Partial<Record<PaneTab, HTMLElement | null>>>({});
  /* Separate handles from `panes`, which is keyed by tab and exists for focus. These are what the
     entrance animates, and they have to be real ref objects for the hook. */
  const topBarRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLElement | null>(null);
  const secondaryRef = useRef<HTMLElement | null>(null);
  /* Arriving all at once reads as a page load; arriving in sequence reads as the workspace
     assembling. Short travel — these settle into place, they do not fly in. */
  useRiseIn(topBarRef, { enabled: islands, fallbackDistance: 20, delayMs: 0, durationMs: 420 });
  useRiseIn(primaryRef, { enabled: islands, fallbackDistance: 20, delayMs: 80, durationMs: 420 });
  useRiseIn(secondaryRef, {
    enabled: islands,
    fallbackDistance: 20,
    delayMs: 160,
    durationMs: 420,
  });
  const card: CSSProperties = islands
    ? {
        borderRadius: 'var(--radius-4)',
        background: 'var(--color-panel-solid)',
        boxShadow: 'var(--shadow-2)',
        /* Clips the panes' own content to the rounded corner. Safe only because `islands` is
           opt-in and no caller using it has anything sticky inside a pane. */
        overflow: 'hidden',
      }
    : {};
  const shownTab = useRef(tab);
  /* Switching tabs on a narrow screen hides the pane the keyboard was in, which would otherwise
     drop focus to <body>. Hand it to the pane that just appeared — but only when the tab actually
     changed, and only when that pane is really on screen. Comparing the previous value rather than
     tracking "have I mounted" is what keeps StrictMode's second effect pass from grabbing focus on
     load, and it costs nothing in production. */
  useEffect(() => {
    if (shownTab.current === tab) return;
    shownTab.current = tab;
    const pane = panes.current[tab];
    if (pane && getComputedStyle(pane).display !== 'none') pane.focus({ preventScroll: true });
  }, [tab]);

  const primaryBands = (
    <>
      {primaryHeader && <Box flexShrink="0">{primaryHeader}</Box>}
      <Box
        flexGrow="1"
        minHeight="0"
        p={primaryPadding}
        data-testid={primaryBodyTestId}
        style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}
      >
        {primary}
      </Box>
      {primaryFooter && <Box flexShrink="0">{primaryFooter}</Box>}
    </>
  );
  const secondaryBands = (
    <>
      {secondaryHeader && <Box flexShrink="0">{secondaryHeader}</Box>}
      <Box
        flexGrow="1"
        minHeight="0"
        p={secondaryPadding}
        style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}
      >
        {secondary}
      </Box>
    </>
  );

  return (
    <Flex
      direction="column"
      position={islands ? 'relative' : 'static'}
      p={islands ? '4' : '0'}
      gap={islands ? '4' : '0'}
      style={{ height: 'calc(100dvh - var(--app-header-height))', minHeight: 0 }}
    >
      {/* Gutters are padding on this box rather than margins on the cards, so the islands can
          never add up to more than the viewport and put a horizontal scrollbar on the page. */}
      {islands && background}
      {/* The ground is absolutely positioned, so everything over it has to be positioned too —
          otherwise it paints above its unpositioned siblings and hides the workspace. */}
      {topBar && (
        <Box
          ref={topBarRef}
          flexShrink="0"
          position={islands ? 'relative' : 'static'}
          style={islands ? { ...card, zIndex: 1 } : undefined}
        >
          {topBar}
        </Box>
      )}
      <Box
        display={{ initial: 'block', md: 'none' }}
        flexShrink="0"
        position={islands ? 'relative' : 'static'}
        style={islands ? { zIndex: 1 } : undefined}
      >
        <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value as PaneTab)}>
          <Tabs.List size="2" justify="center" aria-label={tabsLabel}>
            {(['primary', 'secondary'] as const).map((value) => (
              <Tabs.Trigger key={value} value={value}>
                <Flex align="center" gap="2">
                  {tabs[value].icon}
                  {tabs[value].label}
                  {tabs[value].badge}
                </Flex>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </Box>
      <Grid
        columns={columns ?? { initial: '1', md: 'minmax(350px, 43%) minmax(0, 57%)' }}
        flexGrow="1"
        gap={islands ? '4' : '0'}
        position={islands ? 'relative' : 'static'}
        style={{ minHeight: 0, width: '100%', ...(islands ? { zIndex: 1 } : {}) }}
      >
        <Flex
          asChild
          direction="column"
          minHeight="0"
          minWidth="0"
          display={{ initial: tab === 'secondary' ? 'none' : 'flex', md: 'flex' }}
          style={islands ? card : { borderRight: '1px solid var(--gray-a5)' }}
        >
          {/* tabIndex -1 makes the pane a focus target for the mobile switcher without putting it
              in the tab order. Both branches are written out so the ref stays typed. */}
          {primaryAs === 'aside' ? (
            <aside
              ref={(el) => {
                panes.current.primary = el;
                primaryRef.current = el;
              }}
              aria-label={primaryLabel}
              tabIndex={-1}
            >
              {primaryBands}
            </aside>
          ) : (
            <section
              ref={(el) => {
                panes.current.primary = el;
                primaryRef.current = el;
              }}
              aria-label={primaryLabel}
              tabIndex={-1}
            >
              {primaryBands}
            </section>
          )}
        </Flex>
        <Flex
          asChild
          direction="column"
          minHeight="0"
          minWidth="0"
          display={{ initial: tab === 'primary' ? 'none' : 'flex', md: 'flex' }}
          style={islands ? card : { background: secondaryBackground }}
        >
          <section
            ref={(el) => {
              panes.current.secondary = el;
              secondaryRef.current = el;
            }}
            aria-label={secondaryLabel}
            tabIndex={-1}
          >
            {secondaryWrap ? secondaryWrap(secondaryBands) : secondaryBands}
          </section>
        </Flex>
      </Grid>
    </Flex>
  );
}
