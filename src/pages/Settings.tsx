import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, LogIn, SlidersHorizontal, UserRound } from 'lucide-react';
import { Button, Callout, Card, Container, Flex, Heading, TabNav, Text } from '@radix-ui/themes';
import { api } from '../api';
import { useApp } from '../context';
import { AccountSettings, PreferencesSettings } from '../components/AccountSettings';
import { AgencySettings } from '../components/StudioProposalControls';
import { useRouteLoading } from '../components/TopLoadingBar';
import { Spinner } from '../components/ui';
import type { StudioAgency } from '../../shared/studio';

/**
 * Settings as a page in the app rather than a stack of dialogs: one narrow, centred column (the
 * way Gemini lays out its own settings), a tab strip for moving between the three sections, and
 * each section's content on a single card. Every section has its own address, so the sidebar menu,
 * the avatar and the mobile drawer all link straight to one, and the browser's back button works.
 *
 * Travel preferences stay reachable signed out — a guest's answers migrate into the account at
 * sign-up — so that tab is always shown. Agency and Account need a session; signed out, their
 * addresses explain that and offer sign-in instead of an empty form.
 */

export type SettingsSection = 'preferences' | 'agency' | 'account';

const SECTIONS: {
  key: SettingsSection;
  to: string;
  /** Short, so all three tabs fit side by side on a 400px phone. */
  label: string;
  icon: ReactNode;
  title: string;
  lead: string;
  needsAccount: boolean;
}[] = [
  {
    key: 'preferences',
    to: '/settings/preferences',
    label: 'Preferences',
    icon: <SlidersHorizontal size={16} />,
    title: 'Your kind of travel',
    lead: 'The starting point Tara uses for every new trip.',
    needsAccount: false,
  },
  {
    key: 'agency',
    to: '/settings/agency',
    label: 'Agency',
    icon: <Building2 size={16} />,
    title: 'Agency settings',
    lead: 'The details, branding and terms your client proposals carry.',
    needsAccount: true,
  },
  {
    key: 'account',
    to: '/settings/account',
    label: 'Account',
    icon: <UserRound size={16} />,
    title: 'Your account',
    lead: 'Your name, password, signed-in sessions and data.',
    needsAccount: true,
  },
];

export function SettingsPage({
  section,
  onAccountDeleted,
  onSessionChange,
}: {
  section: SettingsSection;
  onAccountDeleted: () => Promise<void>;
  onSessionChange: () => void;
}) {
  const { user } = useApp();
  const current = SECTIONS.find((item) => item.key === section)!;
  const locked = current.needsAccount && !user;
  return (
    <Container size="2" px={{ initial: '4', md: '6' }} pt={{ initial: '6', md: '8' }} pb="9">
      <Flex direction="column" gap="2">
        <Heading as="h1" size="7" weight="regular">
          Settings
        </Heading>
        <Text as="p" size="2" color="gray">
          {current.lead}
        </Text>
      </Flex>
      <TabNav.Root aria-label="Settings sections" mt="5" mb="5">
        {SECTIONS.filter((item) => !item.needsAccount || user).map((item) => {
          const active = item.key === section;
          return (
            <TabNav.Link key={item.key} asChild active={active}>
              <Link to={item.to} aria-current={active ? 'page' : undefined}>
                <Flex align="center" gap="2">
                  {item.icon}
                  {item.label}
                </Flex>
              </Link>
            </TabNav.Link>
          );
        })}
      </TabNav.Root>
      {/* Agency settings already groups its fields into cards of its own, so it sits on the page
          directly; the other sections get one card, so no card is ever nested in another. */}
      {!locked && section === 'agency' ? (
        <>
          <Heading as="h2" size="5" mb="3">
            {current.title}
          </Heading>
          <AgencySection />
        </>
      ) : (
        <Card size="3">
          <Heading as="h2" size="5" mb="3">
            {current.title}
          </Heading>
          {locked ? (
            <SignInPrompt section={current.label} />
          ) : section === 'preferences' ? (
            <PreferencesSettings />
          ) : (
            <AccountSettings onDeleted={onAccountDeleted} onSessionChange={onSessionChange} />
          )}
        </Card>
      )}
    </Container>
  );
}

function SignInPrompt({ section }: { section: string }) {
  const { openAuth } = useApp();
  return (
    <Flex direction="column" align="start" gap="3">
      <Text as="p" size="2" color="gray">
        Sign in to manage your {section.toLowerCase()} settings.
      </Text>
      <Button size="3" onClick={openAuth}>
        <LogIn size={16} />
        Sign in
      </Button>
    </Flex>
  );
}

type AgencyState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; agency: StudioAgency };

/**
 * The agency record belongs to Studio rather than to every page, so it is fetched when this
 * section opens, not when the app starts. Refetched per account, so switching accounts never
 * shows the previous agency's details.
 */
function AgencySection() {
  const { ownerVersion, toast } = useApp();
  const [state, setState] = useState<AgencyState>({ status: 'loading' });
  useRouteLoading(state.status === 'loading');
  const load = useCallback(() => {
    let active = true;
    setState({ status: 'loading' });
    api<{ agency: StudioAgency }>('/studio/agency')
      .then((result) => {
        if (active) setState({ status: 'ready', agency: result.agency });
      })
      .catch((cause: Error) => {
        if (active) setState({ status: 'error', message: cause.message });
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => load(), [load, ownerVersion]);
  if (state.status === 'loading') return <Spinner label="Opening your agency settings…" />;
  if (state.status === 'error')
    return (
      <Flex direction="column" align="start" gap="3">
        <Callout.Root color="red" size="1">
          <Callout.Text>{state.message}</Callout.Text>
        </Callout.Root>
        <Button size="3" onClick={() => load()}>
          Try again
          <ArrowRight size={16} />
        </Button>
      </Flex>
    );
  return (
    <AgencySettings
      agency={state.agency}
      onAgencyUpdate={(agency) => setState({ status: 'ready', agency })}
      onError={toast}
    />
  );
}
