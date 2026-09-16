import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Compass,
  Heart,
  Menu,
  MessageCircle,
  Plus,
  Sparkles,
  UserRound,
  X,
  LogIn,
  LogOut,
  Check,
  Luggage,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  SlidersHorizontal,
  Building2,
  TicketCheck,
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Container,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Separator,
  Text,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { api } from './api';
import type { Catalog, IntegrationStatus, SavedItem, User } from '../shared/types';
import { AppContext } from './context';
import { Modal, Spinner, TaraMark } from './components/ui';
import Home from './pages/Home';
import { Explore, DestinationDetail, Collection, Saved, NotFound } from './pages/Explore';
import { Planner, Trips, SharedTrip } from './pages/Planner';
import Flights from './pages/Flights';
import { Bookings, NewBooking, BookingDetail } from './pages/Bookings';
import { AccountDialog, PreferencesDialog } from './components/AccountDialogs';
import type { TravelProfile } from '../shared/account';
import type { StudioAgency, StudioWorkspace } from '../shared/studio';
import { AgencySettings } from './components/StudioProposalControls';
import Studio from './pages/Studio';
import StudioProposal from './pages/StudioProposal';

function AuthDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (user: User) => void;
}) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api<{ user: User }>(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(register ? { name } : {}) }),
      });
      onSuccess(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={register ? 'Your next chapter starts here.' : 'Welcome back, wanderer.'}
      onClose={onClose}
    >
      <Text as="p" size="2" color="gray" mb="4">
        Keep your plans, your favorite places, and a little inspiration all together.
      </Text>
      <form onSubmit={submit}>
        <Flex direction="column" gap="3">
          {register && (
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Your name
              </Text>
              <TextField.Root
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="What should Tara call you?"
              />
            </label>
          )}
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Email address
            </Text>
            <TextField.Root
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Password
            </Text>
            <TextField.Root
              required
              minLength={register ? 8 : 1}
              maxLength={128}
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={register ? 'At least 8 characters' : 'Your password'}
            />
          </label>
          {error && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Button size="3" disabled={busy} loading={busy}>
            {register ? 'Create your account' : 'Sign in'}
            <ArrowRight size={16} />
          </Button>
        </Flex>
      </form>
      <Flex align="center" justify="center" gap="2" mt="4">
        <Text size="2" color="gray">
          {register ? 'Already part of the journey?' : 'New around here?'}
        </Text>
        <Button
          variant="ghost"
          size="2"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Sign in' : 'Create an account'}
        </Button>
      </Flex>
    </Modal>
  );
}
/**
 * The Agency settings dialog is fetched on demand, so it has four states rather than a boolean:
 * shut, waiting on `GET /studio/agency`, holding the failure, or holding the record the form edits.
 */
type AgencyDialogState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; agency: StudioAgency };

export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/proposal/'))
    return (
      <Routes>
        <Route path="/proposal/:token" element={<StudioProposal />} />
        <Route path="/proposal/:slug/:token" element={<StudioProposal />} />
      </Routes>
    );
  return <ConnectedApp />;
}
function ConnectedApp() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  /* `user` starts null, which is also what a signed-out session looks like, so the panel cannot
     tell "nobody is signed in" from "we have not asked yet". This says which it is, and the foot
     and the primary action wait on it rather than drawing a guest and then correcting themselves.
     Nothing else about the fetch changes: /session is still the first request the shell makes. */
  const [sessionReady, setSessionReady] = useState(false);
  const [ownerVersion, setOwnerVersion] = useState(0);
  const [profile, setProfile] = useState<TravelProfile | null>(null);
  const ownerEpoch = useRef(0);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus>({
    ai: false,
    flights: false,
    hotels: false,
    activities: false,
    mode: 'local',
  });
  const [auth, setAuth] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [agencyDialog, setAgencyDialog] = useState<AgencyDialogState>({ status: 'closed' });
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [toastMessage, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  const pendingSaves = useRef(new Set<string>());
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  const refreshSaved = useCallback(async () => {
    const epoch = ownerEpoch.current;
    const result = await api<{ items: SavedItem[] }>('/saved');
    if (epoch === ownerEpoch.current) setSaved(result.items);
  }, []);
  const refreshProfile = useCallback(async () => {
    const epoch = ownerEpoch.current;
    const result = await api<{ profile: TravelProfile }>('/profile');
    if (epoch === ownerEpoch.current) setProfile(result.profile);
  }, []);
  const ownerChanged = useCallback(() => {
    ownerEpoch.current += 1;
    setOwnerVersion((value) => value + 1);
  }, []);
  const load = useCallback(async () => {
    setError('');
    try {
      const session = await api<{ user: User | null }>('/session');
      setUser(session.user);
      setSessionReady(true);
      const [data, status, saves, preferences] = await Promise.all([
        api<Catalog>('/catalog'),
        api<IntegrationStatus>('/integrations'),
        api<{ items: SavedItem[] }>('/saved'),
        api<{ profile: TravelProfile }>('/profile'),
      ]);
      setCatalog(data);
      setIntegrations(status);
      setSaved(saves.items);
      setProfile(preferences.profile);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      void load();
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    writeCollapsedPreference(collapsed);
  }, [collapsed]);
  const closeAuth = useCallback(() => setAuth(false), []);
  const closePrefs = useCallback(() => setPrefs(false), []);
  const closeAgency = useCallback(() => setAgencyDialog({ status: 'closed' }), []);
  /* The agency record belongs to Studio, not to every page, so the shell does not load it on
     start: the menu item fetches it when it is chosen, and the dialog carries the wait and the
     failure itself rather than opening on an empty form. */
  const openAgency = useCallback(async () => {
    setAgencyDialog({ status: 'loading' });
    try {
      const result = await api<{ agency: StudioAgency }>('/studio/agency');
      setAgencyDialog({ status: 'ready', agency: result.agency });
    } catch (cause) {
      setAgencyDialog({ status: 'error', message: (cause as Error).message });
    }
  }, []);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  async function toggleSave(type: SavedItem['type'], itemId: string) {
    const key = `${type}:${itemId}`;
    if (pendingSaves.current.has(key)) return;
    pendingSaves.current.add(key);
    try {
      const existing = saved.find((s) => s.type === type && s.itemId === itemId);
      if (existing) {
        await api(`/saved/${existing.id}`, { method: 'DELETE' });
        toast('Removed from your wishlist.');
      } else {
        await api('/saved', { method: 'POST', body: JSON.stringify({ type, itemId }) });
        toast('A little inspiration, saved to your wishlist.');
      }
      await refreshSaved();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      pendingSaves.current.delete(key);
    }
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      ownerChanged();
      setUser(null);
      setProfile(null);
      await Promise.all([refreshSaved(), refreshProfile()]);
      navigate('/');
      toast('You have been signed out.');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const isPlanner =
    location.pathname.startsWith('/chat') || location.pathname.startsWith('/studio');
  return (
    <AppContext.Provider
      value={{
        /* Only the routes read the catalog, and they are the one part of the shell that is held
           back until it has arrived (below), so no consumer ever sees this null. The shell
           around them — panel, drawer, footer — needs none of it and renders straight away. */
        catalog: catalog as Catalog,
        user,
        setUser,
        ownerVersion,
        profile,
        refreshProfile,
        saved,
        refreshSaved,
        toggleSave,
        isSaved: (type, id) => saved.some((s) => s.type === type && s.itemId === id),
        toast,
        openAuth: () => setAuth(true),
        integrations,
      }}
    >
      <Flex align="stretch" minHeight="100vh">
        <Sidebar
          user={user}
          savedCount={saved.length}
          ownerVersion={ownerVersion}
          sessionReady={sessionReady}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onAccount={() => setAccountOpen(true)}
          onPreferences={() => setPrefs(true)}
          onAgencySettings={() => void openAgency()}
          onSignIn={() => setAuth(true)}
          onSignOut={() => void logout()}
        />
        <Flex direction="column" flexGrow="1" minWidth="0">
          {/* Below `md` the panel is off-canvas: this bar is the only chrome above the content,
              and the hamburger inside it is what opens the drawer. */}
          <Box
            asChild
            display={{ initial: 'block', md: 'none' }}
            px="4"
            style={{
              borderBottom: '1px solid var(--gray-a5)',
              background: 'var(--color-background)',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <header>
              <Flex align="center" justify="between" gap="3" height={`${MOBILE_BAR_HEIGHT}px`}>
                <Link to="/" aria-label="Asktara home" style={{ textDecoration: 'none' }}>
                  <Flex align="center" gap="2" style={{ color: 'var(--accent-9)' }}>
                    <TaraMark size={28} />
                    <Text size="4" weight="bold" style={{ color: 'var(--gray-12)' }}>
                      ask<Text weight="light">tara</Text>
                    </Text>
                  </Flex>
                </Link>
                <IconButton
                  variant="soft"
                  color="gray"
                  size="3"
                  aria-label={mobile ? 'Close navigation' : 'Open navigation'}
                  aria-expanded={mobile}
                  onClick={() => setMobile(!mobile)}
                >
                  {mobile ? <X /> : <Menu />}
                </IconButton>
              </Flex>
            </header>
          </Box>
          {mobile && (
            <Box
              asChild
              p="3"
              display={{ initial: 'block', md: 'none' }}
              style={{ borderBottom: '1px solid var(--gray-a5)' }}
            >
              <nav aria-label="Mobile navigation">
                <Flex direction="column" gap="2">
                  <Button
                    asChild
                    size="3"
                    variant={user ? 'solid' : 'soft'}
                    color={user ? undefined : 'gray'}
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      fontSize: 'var(--font-size-2)',
                    }}
                  >
                    <Link to="/">
                      <Plus size={16} />
                      Create a proposal
                    </Link>
                  </Button>
                  {/* Same rhythm as the panel: the five nav rows stack with no gap between
                      them, while the buttons around them keep their 8px. */}
                  <Flex direction="column" gap="0">
                    <MobileNavItem
                      to="/studio"
                      icon={<MessageCircle size={18} />}
                      label="Agent Studio"
                    />
                    <MobileNavItem to="/explore" icon={<Compass size={18} />} label="Discover" />
                    <MobileNavItem to="/trips" icon={<Luggage size={18} />} label="My trips" />
                    <MobileNavItem
                      to="/bookings"
                      icon={<TicketCheck size={18} />}
                      label="Bookings"
                    />
                    <MobileNavItem to="/saved" icon={<Heart size={18} />} label="Wishlist" />
                  </Flex>
                  <Separator size="4" my="1" />
                  {user && (
                    <Button
                      variant="soft"
                      color="gray"
                      size="3"
                      aria-label="Manage account"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => {
                        setMobile(false);
                        setAccountOpen(true);
                      }}
                    >
                      <UserRound size={18} />
                      Manage account
                    </Button>
                  )}
                  {/* Deliberately NOT gated behind an account: a guest sets their preferences
                      here and they migrate into the account at sign-up. */}
                  <Button
                    variant="soft"
                    color="gray"
                    size="3"
                    aria-label="Travel preferences"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                    onClick={() => {
                      setMobile(false);
                      setPrefs(true);
                    }}
                  >
                    <Settings2 size={18} />
                    Travel preferences
                  </Button>
                  {user ? (
                    <Button
                      variant="soft"
                      color="gray"
                      size="3"
                      aria-label="Sign out"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                      onClick={() => {
                        setMobile(false);
                        void logout();
                      }}
                    >
                      <LogOut size={18} />
                      Sign out
                    </Button>
                  ) : (
                    <>
                      <Box px="2">
                        <Text as="div" size="1" color="gray">
                          Sign in to keep your trips, wishlist and proposals.
                        </Text>
                      </Box>
                      <Button
                        size="3"
                        aria-label="Sign in"
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                        onClick={() => {
                          setMobile(false);
                          setAuth(true);
                        }}
                      >
                        <LogIn size={18} />
                        Sign in
                      </Button>
                    </>
                  )}
                </Flex>
              </nav>
            </Box>
          )}
          <Box asChild flexGrow="1">
            <main id="main-content">
              {/* The shell above and beside this point is static, so it paints on the first frame
                  whatever the network is doing. Only the routes wait, because only they read the
                  catalog, and while they wait this region holds the viewport open so nothing
                  below it moves when they arrive. */}
              {error ? (
                <ShellError message={error} onRetry={() => void load()} />
              ) : !catalog ? (
                <ShellLoading />
              ) : (
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/studio" element={<Studio />} />
                  <Route path="/studio/:id" element={<Studio />} />
                  <Route path="/explore" element={<Explore />} />
                  <Route path="/destinations/:id" element={<DestinationDetail />} />
                  <Route path="/stays" element={<Collection kind="stays" />} />
                  <Route path="/experiences" element={<Collection kind="experiences" />} />
                  <Route path="/flights" element={<Flights />} />
                  <Route path="/saved" element={<Saved />} />
                  <Route path="/trips" element={<Trips />} />
                  <Route path="/bookings" element={<Bookings />} />
                  <Route path="/bookings/new" element={<NewBooking />} />
                  <Route path="/bookings/:id" element={<BookingDetail />} />
                  <Route path="/chat" element={<Planner />} />
                  <Route path="/chat/:id" element={<Planner />} />
                  <Route path="/shared/:token" element={<SharedTrip />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              )}
            </main>
          </Box>
          {!isPlanner && (
            <Box
              asChild
              px={{ initial: '4', md: '6' }}
              py="6"
              mt="8"
              style={{ borderTop: '1px solid var(--gray-a5)' }}
            >
              <footer>
                <Container size="4">
                  <Flex
                    direction={{ initial: 'column', sm: 'row' }}
                    justify="between"
                    gap="5"
                    align={{ initial: 'start', sm: 'center' }}
                  >
                    <Flex direction="column" gap="2">
                      <Link to="/">
                        <Flex align="center" gap="2" style={{ color: 'var(--accent-9)' }}>
                          <TaraMark size={22} />
                          <Text size="3" weight="bold" style={{ color: 'var(--gray-12)' }}>
                            asktara.
                          </Text>
                        </Flex>
                      </Link>
                      <Text size="2" color="gray">
                        A little wonder. A better way to travel.
                      </Text>
                    </Flex>
                    <Flex direction="column" gap="2" align={{ initial: 'start', sm: 'end' }}>
                      <Text size="2" color="gray">
                        Thoughtfully planned. Uniquely yours.
                      </Text>
                      <Flex align="center" gap="4" wrap="wrap">
                        <Link to="/explore">
                          <Text size="2">Explore the world</Text>
                        </Link>
                        <Link to="/studio">
                          <Flex align="center" gap="1">
                            <Text size="2">Agent Studio</Text>
                            <Sparkles size={12} />
                          </Flex>
                        </Link>
                        <Text size="2" color="gray">
                          © {new Date().getFullYear()} Asktara
                        </Text>
                      </Flex>
                    </Flex>
                  </Flex>
                </Container>
              </footer>
            </Box>
          )}
        </Flex>
      </Flex>
      {toastMessage && (
        <Box
          position="fixed"
          bottom="4"
          left="0"
          width="100%"
          px="4"
          // An explicit aria-live attribute (not just role="status") is what keeps the toast out
          // of the aria-hidden sweep Radix applies to everything outside an open dialog. Without
          // it, confirmations raised from inside a dialog are never announced.
          aria-live="polite"
          style={{ zIndex: 20, pointerEvents: 'none' }}
        >
          <Flex justify="center">
            <Card size="2" style={{ pointerEvents: 'auto', maxWidth: 480 }}>
              <Flex align="center" gap="3" role="status">
                <Box style={{ color: 'var(--accent-9)', flexShrink: 0 }}>
                  <Check size={17} />
                </Box>
                <Text size="2">{toastMessage}</Text>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  aria-label="Dismiss notification"
                  onClick={() => setToast('')}
                >
                  <X size={15} />
                </IconButton>
              </Flex>
            </Card>
          </Flex>
        </Box>
      )}
      {auth && (
        <AuthDialog
          onClose={closeAuth}
          onSuccess={(u) => {
            ownerChanged();
            setUser(u);
            setAuth(false);
            setProfile(null);
            void Promise.all([refreshSaved(), refreshProfile()]).catch((cause) =>
              toast(cause.message),
            );
            toast(`Welcome, ${u.name.split(' ')[0]}. Your next adventure awaits.`);
          }}
        />
      )}
      {prefs && <PreferencesDialog onClose={closePrefs} />}
      {agencyDialog.status !== 'closed' && (
        <Modal title="Agency settings" onClose={closeAgency} wide>
          {agencyDialog.status === 'loading' && <Spinner label="Opening your agency settings…" />}
          {agencyDialog.status === 'error' && (
            <Flex direction="column" align="start" gap="3" py="4">
              <Callout.Root color="red" size="1">
                <Callout.Text>{agencyDialog.message}</Callout.Text>
              </Callout.Root>
              <Button size="3" onClick={() => void openAgency()}>
                Try again
                <ArrowRight size={16} />
              </Button>
            </Flex>
          )}
          {agencyDialog.status === 'ready' && (
            <AgencySettings
              agency={agencyDialog.agency}
              onAgencyUpdate={(agency) => setAgencyDialog({ status: 'ready', agency })}
              onError={toast}
            />
          )}
        </Modal>
      )}
      {accountOpen && user && (
        <AccountDialog
          onClose={closeAccount}
          onPreferences={() => {
            setAccountOpen(false);
            setPrefs(true);
          }}
          onSessionChange={ownerChanged}
          onDeleted={async () => {
            ownerChanged();
            setUser(null);
            setAccountOpen(false);
            setProfile(null);
            navigate('/');
            await Promise.all([refreshSaved(), refreshProfile()]);
            toast('Your account and saved travel data have been deleted.');
          }}
        />
      )}
    </AppContext.Provider>
  );
}

/**
 * How long a wait has to last before it is worth telling anyone about. A loader that comes and
 * goes inside a few frames reads as a fault in the page, not as progress, and locally every one
 * of the shell's requests returns well inside this — so on a healthy machine nothing below ever
 * paints at all.
 */
const LOADER_DELAY = 300;

/** True once `LOADER_DELAY` has passed since mount; false for every wait shorter than that. */
function useSlowWait() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), LOADER_DELAY);
    return () => clearTimeout(timer);
  }, []);
  return slow;
}

/**
 * Fills the content column while the catalog is in flight. It always occupies the viewport, so
 * the footer stays below the fold and nothing jumps when the routes arrive; the line itself is
 * held at zero opacity until the wait is long enough to be worth naming. It stays mounted
 * throughout either way, so a screen reader still hears the wait announced even when the eye
 * never sees it.
 */
function ShellLoading() {
  const slow = useSlowWait();
  return (
    <Flex
      align="center"
      justify="center"
      p="6"
      style={{ minHeight: 'calc(100dvh - var(--app-header-height))' }}
    >
      <Text
        as="div"
        size="2"
        color="gray"
        align="center"
        role="status"
        style={{ opacity: slow ? 1 : 0, transition: 'opacity 200ms ease' }}
      >
        Your next adventure is taking shape…
      </Text>
    </Flex>
  );
}

/** The initial load failed. Same words and same retry as before; now inside the shell. */
function ShellError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="4"
      p="6"
      style={{ minHeight: 'calc(100dvh - var(--app-header-height))' }}
    >
      <Box style={{ color: 'var(--accent-9)' }}>
        <TaraMark size={52} />
      </Box>
      <Heading as="h1" size="7" align="center">
        A little pause in the journey.
      </Heading>
      <Text size="3" color="gray" align="center">
        We couldn’t load your travel plans. Give it a moment, then try again.
      </Text>
      <Callout.Root color="red" size="1">
        <Callout.Text>{message}</Callout.Text>
      </Callout.Root>
      <Button size="3" onClick={onRetry}>
        Try again
        <ArrowRight size={16} />
      </Button>
    </Flex>
  );
}

/**
 * The shell's measurements. Radix `size="3"` controls are 40px, which already clears the project's
 * target floor, so no Radix control here is hand-sized; NAV_ITEM_HEIGHT applies only to the custom
 * link rows, which are their own hover paint surface. The sidebar is persistent from `md` (1024px)
 * up and the content column starts at the top of the viewport beside it, so above `md` there is no
 * chrome above the content at all. Below `md` the panel is off-canvas and the only chrome is the
 * mobile bar: MOBILE_BAR_HEIGHT plus its 1px bottom border is what `--app-header-height` in
 * styles.css must equal there.
 */
const MOBILE_BAR_HEIGHT = 64;
const NAV_ITEM_HEIGHT = 40;
const SIDEBAR_WIDTH = 272;
const SIDEBAR_COLLAPSED_WIDTH = 72;

/** Five is enough to recognise last week's work and short enough to scan without a scroll. */
const RECENT_LIMIT = 5;
const SIDEBAR_STORAGE_KEY = 'asktara:sidebar-collapsed';

/**
 * localStorage throws outright in a storage-blocked or partitioned context and returns null when
 * nothing was ever written, so both paths fall back to the expanded panel — the state the app has
 * always had.
 */
function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsedPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* A browser that refuses storage still gets a working toggle, just not a remembered one. */
  }
}

type RecentProposals =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: { id: string; title: string }[] };

/**
 * Recent holds proposal workspaces, not trips: the panel's primary action creates a workspace, so
 * the list underneath it is the trail that action leaves, which is exactly the relationship
 * Gemini's Recent has to New chat. The endpoint already returns them newest-updated first. Studio
 * is the only place a workspace is created or renamed, so re-reading on each Studio navigation
 * keeps the list honest without polling from every other route.
 */
function useRecentProposals(signedIn: boolean, ownerVersion: number): RecentProposals {
  const location = useLocation();
  const studioKey = location.pathname.startsWith('/studio') ? location.pathname : '';
  const [state, setState] = useState<RecentProposals>({ status: 'loading' });
  useEffect(() => {
    if (!signedIn) {
      setState({ status: 'ready', items: [] });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    api<{ workspaces: StudioWorkspace[] }>('/studio/workspaces')
      .then((result) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          items: result.workspaces.slice(0, RECENT_LIMIT).map((workspace) => ({
            id: workspace.id,
            title: workspace.title.trim() || 'Untitled proposal',
          })),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, ownerVersion, studioKey]);
  return state;
}

/**
 * The persistent panel, from `md` up. One frame serves both sessions: brand and collapse toggle,
 * the primary action, the navigation, Recent, and the identity pinned to the foot. Signed out that
 * foot carries the reason to sign in instead of an account, and the primary action drops to a
 * neutral `soft` so the solid weight of the view belongs to Sign in.
 */
function Sidebar({
  user,
  savedCount,
  ownerVersion,
  sessionReady,
  collapsed,
  onToggleCollapsed,
  onAccount,
  onPreferences,
  onAgencySettings,
  onSignIn,
  onSignOut,
}: {
  user: User | null;
  savedCount: number;
  ownerVersion: number;
  sessionReady: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAccount: () => void;
  onPreferences: () => void;
  onAgencySettings: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const recent = useRecentProposals(!!user, ownerVersion);
  /* The two places that read differently signed in and signed out — the primary action's weight
     and the foot — wait for the session rather than drawing a guest and correcting themselves a
     frame later. The wait is capped at LOADER_DELAY: if the session is genuinely slow, a guest's
     panel is better than a hole in it, and the correction then costs one repaint instead of
     three hundred milliseconds of missing primary action. Everything else here — the brand, the
     collapse toggle, the whole navigation — needs no session and never waits. */
  const sessionIsSlow = useSlowWait();
  const identityKnown = sessionReady || sessionIsSlow;
  /* Whether the pointer or keyboard focus is on the collapsed mark, which is what swaps it for
     the expand glyph. Cleared when the rail expands, so a pointer that never left does not
     leave the expanded logo showing the wrong icon. */
  const [logoHover, setLogoHover] = useState(false);
  useEffect(() => {
    if (!collapsed) setLogoHover(false);
  }, [collapsed]);
  return (
    <Box
      asChild
      display={{ initial: 'none', md: 'block' }}
      flexShrink="0"
      style={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
        // The rail slides between its two widths instead of snapping. The global
        // prefers-reduced-motion rule in styles.css switches this off for anyone who asks.
        transition: 'width 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        // Sticky rather than fixed: the document still scrolls as one, so the existing
        // scroll-to-top on navigation and the pages' own dvh panels keep working.
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100dvh',
        borderRight: '1px solid var(--gray-a5)',
        background: 'var(--gray-2)',
        zIndex: 5,
      }}
    >
      <aside aria-label="Sidebar">
        {/* 8px between the panel's blocks rather than 12px. With the nav rows now stacked, the
            blocks are what carries the grouping, and at this size the brand, the primary action,
            the navigation and the foot still read as four things without the voids between them
            doing the work. */}
        <Flex direction="column" gap="2" p="3" height="100%">
          <Flex
            direction={collapsed ? 'column' : 'row'}
            align="center"
            justify="between"
            gap="2"
            flexShrink="0"
          >
            {collapsed ? (
              /* Collapsed, the mark is the way back out: pointing at it — or focusing it —
                 swaps the logo for the expand glyph, so the narrow rail carries one control
                 where it used to stack a logo above a button. The label is a Radix Tooltip
                 rather than a native title, so it reads like every other label in the app. */
              <Tooltip content="Expand sidebar">
                <IconButton
                  variant="soft"
                  color="gray"
                  size="3"
                  aria-label="Expand sidebar"
                  aria-expanded={false}
                  onClick={onToggleCollapsed}
                  onPointerEnter={() => setLogoHover(true)}
                  onPointerLeave={() => setLogoHover(false)}
                  onFocus={() => setLogoHover(true)}
                  onBlur={() => setLogoHover(false)}
                >
                  {logoHover ? (
                    <PanelLeftOpen size={18} />
                  ) : (
                    <Flex asChild align="center" style={{ color: 'var(--accent-9)' }}>
                      <span>
                        <TaraMark size={22} />
                      </span>
                    </Flex>
                  )}
                </IconButton>
              </Tooltip>
            ) : (
              <>
                <Link to="/" aria-label="Asktara home" style={{ textDecoration: 'none' }}>
                  <Flex
                    align="center"
                    gap="2"
                    px="1"
                    style={{ height: NAV_ITEM_HEIGHT, color: 'var(--accent-9)' }}
                  >
                    <TaraMark size={26} />
                    <Text size="4" weight="bold" style={{ color: 'var(--gray-12)' }}>
                      ask<Text weight="light">tara</Text>
                    </Text>
                  </Flex>
                </Link>
                <Tooltip content="Collapse sidebar">
                  <IconButton
                    variant="soft"
                    color="gray"
                    size="3"
                    aria-label="Collapse sidebar"
                    aria-expanded
                    onClick={onToggleCollapsed}
                  >
                    <PanelLeftClose size={18} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Flex>
          {/* The action's weight is the one thing about it that depends on who is here, so the
              row holds its height from the first frame and fills in once the session is known. */}
          {!identityKnown ? (
            <Box flexShrink="0" style={{ height: NAV_ITEM_HEIGHT }} />
          ) : collapsed ? (
            <Flex justify="center" flexShrink="0">
              <IconButton
                asChild
                size="3"
                variant={user ? 'solid' : 'soft'}
                color={user ? undefined : 'gray'}
                aria-label="Create a proposal"
                title="Create a proposal"
              >
                <Link to="/">
                  <Plus size={18} />
                </Link>
              </IconButton>
            </Flex>
          ) : (
            <Button
              asChild
              size="3"
              variant={user ? 'solid' : 'soft'}
              color={user ? undefined : 'gray'}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                fontSize: 'var(--font-size-2)',
              }}
            >
              <Link to="/">
                <Plus size={16} />
                Create a proposal
              </Link>
            </Button>
          )}
          {/* The one region that gives way when the viewport is short, so the brand, the primary
              action and the account stay put at both ends. */}
          <Box flexGrow="1" style={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            {/* No gap: the rows stack and each row's own 40px does the separating. See
                SidebarNavItem for why that is still the right call against the target rule. */}
            <Flex asChild direction="column" gap="0">
              <nav aria-label="Main navigation">
                <SidebarNavItem
                  to="/studio"
                  icon={<MessageCircle size={18} />}
                  label="Agent Studio"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/explore"
                  icon={<Compass size={18} />}
                  label="Discover"
                  collapsed={collapsed}
                />
                {/* Not gated on `user`: guest sessions have their own trips and wishlist, which
                    migrate into the account on registration. Hiding these signed out would cut a
                    visitor off from work they have already done. */}
                <SidebarNavItem
                  to="/trips"
                  icon={<Luggage size={18} />}
                  label="My trips"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/bookings"
                  icon={<TicketCheck size={18} />}
                  label="Bookings"
                  collapsed={collapsed}
                />
                <SidebarNavItem
                  to="/saved"
                  icon={<Heart size={18} />}
                  label="Wishlist"
                  collapsed={collapsed}
                  badge={savedCount}
                />
              </nav>
            </Flex>
            {user && !collapsed && (
              /* The break above the section label is what separates Recent from the navigation
                 now that neither list has gaps inside it; the label itself stays a step smaller
                 than the rows beneath it so it reads as their heading, not as one of them. */
              <Box mt="3">
                <Box px="3" pb="1">
                  <Text as="div" size="1" weight="medium" color="gray">
                    Recent proposals
                  </Text>
                </Box>
                <Flex direction="column" gap="0">
                  {recent.status === 'loading' && (
                    <SidebarNote>Looking up your recent work…</SidebarNote>
                  )}
                  {recent.status === 'error' && (
                    <SidebarNote>Recent proposals could not be loaded.</SidebarNote>
                  )}
                  {recent.status === 'ready' && recent.items.length === 0 && (
                    <SidebarNote>No proposals yet — the ones you create appear here.</SidebarNote>
                  )}
                  {recent.status === 'ready' &&
                    recent.items.map((item) => (
                      <SidebarNavItem
                        key={item.id}
                        to={`/studio/${item.id}`}
                        label={item.title}
                        collapsed={false}
                        end
                      />
                    ))}
                </Flex>
              </Box>
            )}
          </Box>
          {/* Held back with the primary action: the foot is a different shape signed in and
              signed out, so drawing the wrong one first would move the panel under the pointer. */}
          {identityKnown && (
            <Box flexShrink="0">
              <Separator size="4" mb="2" />
              {user ? (
                <Flex
                  direction={collapsed ? 'column' : 'row'}
                  align="center"
                  gap="2"
                  justify={collapsed ? 'center' : 'start'}
                >
                  {collapsed ? (
                    <IconButton
                      variant="soft"
                      color="gray"
                      size="3"
                      data-testid="account-button"
                      aria-label="Manage account"
                      title={user.name}
                      onClick={onAccount}
                    >
                      <Avatar
                        size="1"
                        radius="full"
                        fallback={user.name.slice(0, 1).toUpperCase()}
                      />
                    </IconButton>
                  ) : (
                    <Button
                      variant="soft"
                      color="gray"
                      size="3"
                      data-testid="account-button"
                      aria-label="Manage account"
                      title={user.name}
                      onClick={onAccount}
                      // Radix pins its buttons to `flex-shrink: 0`, which is right in a toolbar and
                      // wrong here: this one is the row's elastic member, so it takes the space the
                      // two icon buttons leave and gives its label somewhere to ellipse into.
                      style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'flex-start' }}
                    >
                      <Avatar
                        size="1"
                        radius="full"
                        fallback={user.name.slice(0, 1).toUpperCase()}
                        style={{ flexShrink: 0 }}
                      />
                      {/* A flex item's automatic minimum is its content, so without this the long
                        name would push the two icon buttons past the panel's edge instead of
                        ellipsing. `size="2"` overrides the 16px a size-3 Radix button gives its
                        label: the button stays 40px for the target rule, but the name now sits
                        at the same 14px as the rows above it instead of shouting over them. */}
                      <Text size="2" truncate style={{ minWidth: 0 }}>
                        {user.name}
                      </Text>
                    </Button>
                  )}
                  <SidebarSettingsMenu
                    signedIn
                    onPreferences={onPreferences}
                    onAgencySettings={onAgencySettings}
                    onAccount={onAccount}
                    onSignOut={onSignOut}
                  />
                </Flex>
              ) : (
                <Flex direction="column" gap="2" align={collapsed ? 'center' : 'stretch'}>
                  {/* Travel preferences stay reachable signed out on purpose: a guest's answers
                    migrate into the account at sign-up, so hiding them would lose that work. */}
                  {collapsed ? (
                    <>
                      <SidebarSettingsMenu
                        signedIn={false}
                        onPreferences={onPreferences}
                        onAgencySettings={onAgencySettings}
                        onAccount={onAccount}
                        onSignOut={onSignOut}
                      />
                      <Tooltip content="Sign in">
                        <IconButton size="3" aria-label="Sign in" onClick={onSignIn}>
                          <LogIn size={18} />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <Flex align="center" gap="2">
                        <SidebarSettingsMenu
                          signedIn={false}
                          onPreferences={onPreferences}
                          onAgencySettings={onAgencySettings}
                          onAccount={onAccount}
                          onSignOut={onSignOut}
                        />
                      </Flex>
                      <Box px="3" pt="1">
                        <Text as="div" size="1" color="gray">
                          Sign in to keep your trips, wishlist and proposals.
                        </Text>
                      </Box>
                      <Button
                        size="3"
                        aria-label="Sign in"
                        onClick={onSignIn}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                      >
                        <LogIn size={18} />
                        Sign in
                      </Button>
                    </>
                  )}
                </Flex>
              )}
            </Box>
          )}
        </Flex>
      </aside>
    </Box>
  );
}

/**
 * Gemini's arrangement: the avatar keeps its own direct route to the account — it is the foot's
 * primary target — and every setting sits behind the single gear beside it. Signed out the menu
 * carries Travel preferences alone: a guest's answers migrate into the account at sign-up, so they
 * stay reachable, while the account, the agency and signing out all need a session to mean
 * anything. Sign out is cut off from the rest by a separator and carries the destructive tint.
 */
function SidebarSettingsMenu({
  signedIn,
  onPreferences,
  onAgencySettings,
  onAccount,
  onSignOut,
}: {
  signedIn: boolean;
  onPreferences: () => void;
  onAgencySettings: () => void;
  onAccount: () => void;
  onSignOut: () => void;
}) {
  /* Every item here opens a dialog, and the shared Modal returns focus to whatever held it when
     it mounted. A menu item is gone by then, so the gear is put back under focus on the next
     frame — once the menu has finished unmounting — and only then does the dialog open. Closing
     it therefore lands back on the control that opened it, as it did when these were buttons. */
  const trigger = useRef<HTMLButtonElement>(null);
  const afterClose = (open: () => void) => () =>
    requestAnimationFrame(() => {
      trigger.current?.focus();
      open();
    });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton
          ref={trigger}
          variant="soft"
          color="gray"
          size="3"
          aria-label="Settings"
          title="Settings"
        >
          <Settings2 size={18} />
        </IconButton>
      </DropdownMenu.Trigger>
      {/* Anchored to the trigger's leading edge so the menu reads the same way on the 272px panel
          and on the 72px rail; Radix flips it above the foot when there is no room below. */}
      <DropdownMenu.Content size="2" align="start">
        <DropdownMenu.Item onSelect={afterClose(onPreferences)}>
          <SlidersHorizontal size={15} aria-hidden="true" /> Travel preferences
        </DropdownMenu.Item>
        {signedIn && (
          <>
            <DropdownMenu.Item onSelect={afterClose(onAgencySettings)}>
              <Building2 size={15} aria-hidden="true" /> Agency settings
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={afterClose(onAccount)}>
              <UserRound size={15} aria-hidden="true" /> Manage account
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item color="red" onSelect={afterClose(onSignOut)}>
              <LogOut size={15} aria-hidden="true" /> Sign out
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** One line of panel prose — the loading, empty and error voices of Recent. */
function SidebarNote({ children }: { children: ReactNode }) {
  return (
    /* Its own vertical padding, because the list it sits in no longer has a gap to give it. */
    <Box px="3" py="1">
      <Text as="div" size="1" color="gray">
        {children}
      </Text>
    </Box>
  );
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
function SidebarNavItem({
  to,
  icon,
  label,
  collapsed,
  badge,
  end,
}: {
  to: string;
  icon?: ReactNode;
  label: string;
  collapsed: boolean;
  badge?: number;
  end?: boolean;
}) {
  return (
    <NavLink
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
            borderRadius: 'var(--radius-4)',
            background: isActive ? 'var(--accent-4)' : 'transparent',
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

function MobileNavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Flex
          align="center"
          gap="3"
          px="3"
          style={{
            minHeight: NAV_ITEM_HEIGHT,
            borderRadius: 'var(--radius-3)',
            background: isActive ? 'var(--accent-4)' : 'transparent',
            boxShadow: isActive ? 'inset 0 0 0 1px var(--accent-a7)' : undefined,
            color: isActive ? 'var(--accent-11)' : 'var(--gray-12)',
            /* 14px, matching the panel's rows: the drawer is the same navigation at a narrower
               width, so it should not read a size larger than the rail it replaces. */
            fontSize: 'var(--font-size-2)',
            fontWeight: isActive ? 600 : 400,
          }}
        >
          {icon}
          {label}
        </Flex>
      )}
    </NavLink>
  );
}
