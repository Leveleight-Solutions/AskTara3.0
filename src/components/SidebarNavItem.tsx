import { useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Badge, Flex, Text } from '@radix-ui/themes';

/** Radix `size="3"` controls are 40px; the custom link rows match them. */
export const NAV_ITEM_HEIGHT = 40;

/**
 * The one curve the panel collapses and expands on. Everything that changes with the panel — its
 * width, each row's width, a button narrowing to an icon button, a label fading — runs on this
 * duration and easing, so the collapse reads as one gesture rather than a width animation with
 * content swapping inside it. The prefers-reduced-motion rule in styles.css switches all of it off,
 * which is why every element here is laid out to be right at either end with no animation at all.
 */
const RAIL_MOTION = '220ms cubic-bezier(0.32, 0.72, 0, 1)';

/** A `transition` value that moves the named properties with the panel. */
export function railTransition(...properties: string[]) {
  return properties.map((property) => `${property} ${RAIL_MOTION}`).join(', ');
}

/**
 * What an expanded-only element does while the panel narrows: it fades on the panel's own curve,
 * so the panel's edge sweeping over it reads as it leaving rather than being cut off, and it
 * arrives the same way on the way back.
 */
export function fadeWithRail(collapsed: boolean): CSSProperties {
  return { opacity: collapsed ? 0 : 1, transition: railTransition('opacity') };
}

/**
 * Takes an expanded-only element out of reach while the panel is collapsed, where it is still in
 * the page but behind the panel's edge. `inert` stops it being focused or clicked. `aria-hidden`
 * says the same thing to the accessibility tree: Chrome already drops inert content from it, but
 * not every engine does yet (Playwright's own role engine does not), and a collapsed row must be
 * named exactly once — by its `aria-label`, not also by the label text it is hiding.
 */
export function hiddenOnRail(collapsed: boolean) {
  return { inert: collapsed, 'aria-hidden': collapsed || undefined };
}

/**
 * The leading column every glyph in the panel sits in. Its width is `--rail-slot`, which the
 * Sidebar in App.tsx sets to exactly the collapsed rail's content width — so a glyph centred here
 * is already centred on the collapsed rail, and when the panel narrows around it, it has nowhere
 * to go. That is the whole of what stops the icons moving during a collapse.
 */
export function RailSlot({ children }: { children: ReactNode }) {
  return (
    <Flex align="center" justify="center" flexShrink="0" style={{ width: 'var(--rail-slot)' }}>
      {children}
    </Flex>
  );
}

/**
 * Hover for a row painted with inline styles, which cannot express `:hover` — and the app's
 * convention keeps classNames and app rules out of the stylesheet. Mouse and pen only: a touch
 * fires pointerenter without a matching leave, which would strand the tint on the row just tapped.
 */
export function useRowHover() {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    handlers: {
      onPointerEnter: (event: PointerEvent) => {
        if (event.pointerType !== 'touch') setHovered(true);
      },
      onPointerLeave: () => setHovered(false),
    },
  };
}

/**
 * The resting, hovered and active fills of a navigation row. Hover is the neutral gray wash — the
 * accent tint stays reserved for "you are here", so a hovered row never reads as selected.
 */
export function rowFill(isActive: boolean, hovered: boolean) {
  if (isActive) return 'var(--accent-4)';
  return hovered ? 'var(--gray-a3)' : 'transparent';
}

/**
 * A panel row: 40px tall, stacked directly against its neighbours with no gap between them.
 *
 * The project holds targets to >=40px with >=8px of separation, and these rows deliberately have
 * none. That rule exists to stop mis-taps between small adjacent targets; WCAG 2.5.8 is met by a
 * target's own size, and a full-width row 40px tall and 248px wide is an unambiguous one — there
 * is no sliver of it that a thumb could mistake for its neighbour. Stacked full-width list rows
 * are the standard pattern, and the gap was what made the panel read airy.
 *
 * This applies to full-width stacked rows and nothing else. Every other control in the panel —
 * the account button beside the settings gear, the collapse toggle, the icon buttons on the
 * collapsed rail — still keeps 40px with 8px between them.
 *
 * The active state is a filled, outlined pill plus a heavier weight — the outline and the
 * weight carry it if the tint is not perceived, and every token flips with the appearance.
 * Collapsed, the label leaves the page but not the accessibility tree: it becomes the row's
 * `aria-label` and its tooltip, so the name a test or a screen reader hears is unchanged.
 *
 * The label is not unmounted when the row collapses, because content that leaves the DOM on the
 * first frame cannot animate — it is what made the icons jump while the panel was still wide. It
 * stays, clipped by the narrowing row and faded, and is hidden from the accessibility tree (see
 * hiddenOnRail) at the same moment the `aria-label` takes over: the name is only ever exposed
 * once. The row itself narrows from full width to the rail slot on the panel's curve,
 * so the active pill shrinks with the panel instead of snapping to a square.
 */
export function SidebarNavItem({
  to,
  icon,
  label,
  collapsed,
  badge,
  end,
  forceHover = false,
  trailingSpace = false,
}: {
  to: string;
  icon?: ReactNode;
  label: string;
  collapsed: boolean;
  badge?: number;
  end?: boolean;
  /** Keeps the hover tint while the pointer is on a control laid over the row (Recent's menu). */
  forceHover?: boolean;
  /** Leaves room at the trailing edge for that control, so a long label ellipses before it. */
  trailingSpace?: boolean;
}) {
  const { hovered, handlers } = useRowHover();
  const showBadge = badge !== undefined && badge > 0;
  const badgeElement = showBadge && (
    <Badge radius="full" variant="solid" style={{ flexShrink: 0 }}>
      {badge}
    </Badge>
  );
  return (
    <NavLink
      {...handlers}
      to={to}
      end={end}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      style={{
        display: 'block',
        textDecoration: 'none',
        width: collapsed ? 'var(--rail-slot)' : '100%',
        transition: railTransition('width'),
      }}
    >
      {({ isActive }) => (
        <Flex
          align="center"
          justify="between"
          gap={icon ? '0' : '2'}
          px={icon ? '0' : '3'}
          style={{
            height: NAV_ITEM_HEIGHT,
            paddingRight: trailingSpace ? NAV_ITEM_HEIGHT + 4 : undefined,
            borderRadius: 'var(--radius-4)',
            backgroundColor: rowFill(isActive, hovered || forceHover),
            transition: 'background-color 120ms ease-out',
            boxShadow: isActive ? 'inset 0 0 0 1px var(--accent-a7)' : undefined,
            color: isActive ? 'var(--accent-11)' : 'var(--gray-11)',
            fontSize: 'var(--font-size-2)',
            fontWeight: isActive ? 600 : 400,
          }}
        >
          {icon ? (
            <>
              <RailSlot>{icon}</RailSlot>
              <Flex
                flexGrow="1"
                minWidth="0"
                {...hiddenOnRail(collapsed)}
                style={{ overflow: 'clip', ...fadeWithRail(collapsed) }}
              >
                {/* Sized against the navigation's own width (its container, which never
                    animates) rather than the row's, which does. The label and the badge are laid
                    out once at their expanded positions and the narrowing row only clips them —
                    so the text never re-wraps or re-ellipses mid-collapse and the badge does not
                    slide across it. */}
                <Flex
                  align="center"
                  justify="between"
                  gap="2"
                  pr="3"
                  flexShrink="0"
                  style={{ width: 'calc(100cqw - var(--rail-slot))' }}
                >
                  <Text truncate>{label}</Text>
                  {badgeElement}
                </Flex>
              </Flex>
            </>
          ) : (
            /* Recent's rows: no icon and never collapsed — that list leaves with the panel as a
               whole — so they keep the plain padded layout. */
            <>
              <Flex align="center" minWidth="0">
                <Text truncate>{label}</Text>
              </Flex>
              {badgeElement}
            </>
          )}
        </Flex>
      )}
    </NavLink>
  );
}
