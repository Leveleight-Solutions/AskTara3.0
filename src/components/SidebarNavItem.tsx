import { useState, type PointerEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Badge, Flex, Text } from '@radix-ui/themes';

/** Radix `size="3"` controls are 40px; the custom link rows match them. */
export const NAV_ITEM_HEIGHT = 40;

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
  return (
    <NavLink
      {...handlers}
      to={to}
      end={end}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      style={{ textDecoration: 'none' }}
    >
      {({ isActive }) => (
        <Flex
          align="center"
          justify={collapsed ? 'center' : 'between'}
          gap="2"
          px={collapsed ? '0' : '3'}
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
          <Flex align="center" gap="3" minWidth="0">
            {icon}
            {!collapsed && <Text truncate>{label}</Text>}
          </Flex>
          {!collapsed && badge !== undefined && badge > 0 && (
            <Badge radius="full" variant="solid" style={{ flexShrink: 0 }}>
              {badge}
            </Badge>
          )}
        </Flex>
      )}
    </NavLink>
  );
}
