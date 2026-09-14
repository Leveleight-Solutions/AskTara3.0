import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
  LogOut,
  Check,
  Luggage,
  Settings2,
  TicketCheck,
} from 'lucide-react';
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
      <p className="modal-intro">
        Keep your plans, your favorite places, and a little inspiration all together.
      </p>
      <form onSubmit={submit} className="stack-form">
        {register && (
          <label>
            Your name
            <input
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
          Email address
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
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
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary full-width" disabled={busy}>
          {busy ? 'One moment…' : register ? 'Create your account' : 'Sign in'}
          <ArrowRight size={16} />
        </button>
      </form>
      <p className="auth-switch">
        {register ? 'Already part of the journey?' : 'New around here?'}{' '}
        <button
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </Modal>
  );
}
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
  const [mobile, setMobile] = useState(false);
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
  const closeAuth = useCallback(() => setAuth(false), []);
  const closePrefs = useCallback(() => setPrefs(false), []);
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
  if (error)
    return (
      <div className="app-error">
        <TaraMark size={52} />
        <h1>A little pause in the journey.</h1>
        <p>We couldn’t load your travel plans. Give it a moment, then try again.</p>
        <p className="muted">{error}</p>
        <button className="button button-primary" onClick={() => void load()}>
          Try again
          <ArrowRight size={16} />
        </button>
      </div>
    );
  if (!catalog)
    return (
      <div className="app-loading">
        <TaraMark size={42} />
        <Spinner label="Your next adventure is taking shape…" />
      </div>
    );
  const isPlanner =
    location.pathname.startsWith('/chat') || location.pathname.startsWith('/studio');
  return (
    <AppContext.Provider
      value={{
        catalog,
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
      <div className={`app-shell ${isPlanner ? 'planner-shell' : ''}`}>
        <header className="site-header">
          <Link to="/" className="brand" aria-label="Asktara home">
            <TaraMark size={31} />
            <span>
              ask<span className="brand-light">tara</span>
              <span className="brand-period">.</span>
            </span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <NavLink to="/studio">Agent Studio</NavLink>
            <NavLink to="/explore">Discover</NavLink>
            <NavLink to="/trips">My trips</NavLink>
            <NavLink to="/bookings">Bookings</NavLink>
            <NavLink to="/saved">
              Wishlist {saved.length > 0 && <span className="nav-count">{saved.length}</span>}
            </NavLink>
          </nav>
          <div className="header-actions">
            <button
              className="icon-button preferences-button"
              aria-label="Travel preferences"
              onClick={() => setPrefs(true)}
            >
              <Settings2 size={18} />
            </button>
            {user ? (
              <>
                <button
                  className="account-button"
                  aria-label="Manage account"
                  onClick={() => setAccountOpen(true)}
                >
                  <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                  <span>{user.name.split(' ')[0]}</span>
                </button>
                <button
                  className="icon-button logout-button"
                  aria-label="Sign out"
                  onClick={() => void logout()}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button className="sign-in-button" onClick={() => setAuth(true)}>
                Sign in
                <ArrowUpRightIcon />
              </button>
            )}
            <Link className="button button-primary header-plan" to="/studio">
              <Plus size={16} />
              Create a proposal
            </Link>
            <button
              className="icon-button mobile-menu-button"
              aria-label={mobile ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobile}
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X /> : <Menu />}
            </button>
          </div>
        </header>
        {mobile && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            <NavLink to="/explore">
              <Compass size={18} />
              Discover
            </NavLink>
            <NavLink to="/trips">
              <Luggage size={18} />
              My trips
            </NavLink>
            <NavLink to="/saved">
              <Heart size={18} />
              Wishlist
            </NavLink>
            <NavLink to="/bookings">
              <TicketCheck size={18} />
              Bookings
            </NavLink>
            <NavLink to="/studio">
              <MessageCircle size={18} />
              Agent Studio
            </NavLink>
            {user && (
              <button
                onClick={() => {
                  setMobile(false);
                  setAccountOpen(true);
                }}
              >
                <UserRound size={18} />
                Manage account
              </button>
            )}
            <button
              onClick={() => {
                setMobile(false);
                setPrefs(true);
              }}
            >
              <Settings2 size={18} />
              Travel preferences
            </button>
            <button
              onClick={() => {
                setMobile(false);
                user ? void logout() : setAuth(true);
              }}
            >
              <UserRound size={18} />
              {user ? 'Sign out' : 'Sign in'}
            </button>
          </nav>
        )}
        <main id="main-content">
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
        </main>
        {!isPlanner && (
          <footer className="site-footer">
            <div>
              <Link to="/" className="brand">
                <TaraMark size={24} />
                <span>
                  ask<span className="brand-light">tara</span>.
                </span>
              </Link>
              <p>A little wonder. A better way to travel.</p>
            </div>
            <div className="footer-right">
              <span>Thoughtfully planned. Uniquely yours.</span>
              <div>
                <Link to="/explore">Explore the world</Link>
                <Link to="/studio">
                  Agent Studio <Sparkles size={12} />
                </Link>
                <span>© {new Date().getFullYear()} Asktara</span>
              </div>
            </div>
          </footer>
        )}
      </div>
      {toastMessage && (
        <div className="toast" role="status">
          <Check size={17} />
          {toastMessage}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
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
function ArrowUpRightIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}
