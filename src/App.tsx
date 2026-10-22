import { AsyncButton, ProviderLogo, Spinner } from './components';
import React, { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type Activity,
  type Provider,
  type Session,
  type Status,
  type Transfer,
} from './api';

const names = { igpsport: 'iGPSPORT', garmin: 'Garmin Connect', compare: 'Compare' };
const providers: Provider[] = ['igpsport', 'garmin'];
const COMPARE_PAGES = 5;
// Suggestion thresholds: same or adjacent day, close distance, close duration.
const dayMoment = (a: Activity) => {
  const raw = a.sourceDateTime;
  if (!raw) return null;
  const time = new Date(raw.slice(0, 10).replaceAll('.', '-') + 'T12:00:00').getTime();
  return Number.isNaN(time) ? null : time / 86400000;
};
const rideSeconds = (a: Activity) => a.timerSeconds ?? a.movingSeconds ?? a.elapsedSeconds ?? null;
const dayGap = (a: Activity, b: Activity) => {
  const from = dayMoment(a);
  const to = dayMoment(b);
  if (from == null || to == null) return 99;
  return Math.abs(Math.floor(from + 0.5) - Math.floor(to + 0.5));
};
const distanceGap = (a: Activity, b: Activity) =>
  a.distanceMeters == null || b.distanceMeters == null
    ? null
    : Math.abs(a.distanceMeters - b.distanceMeters);
const minuteGap = (a: Activity, b: Activity) => {
  const diff = Math.abs((rideSeconds(a) ?? 0) - (rideSeconds(b) ?? 0));
  return diff < 60 ? 'same duration' : `${Math.round(diff / 60)} min apart`;
};
// A pair suggests itself when the numbers plausibly describe the same ride.
const looksLikeSameRide = (a: Activity, b: Activity) => {
  const days = dayGap(a, b);
  if (days > 1) return false;
  let distance = distanceGap(a, b);
  if (distance == null) return false;
  if (distance > Math.max((a.distanceMeters || 0) * 0.03, 300)) return false;
  const from = rideSeconds(a);
  const to = rideSeconds(b);
  if (from != null && to != null && Math.abs(from - to) > Math.max(from * 0.12, 240)) return false;
  return true;
};
const metric = (value: number | null | undefined, factor = 1, digits = 1) =>
  value == null
    ? '—'
    : (value * factor).toLocaleString(undefined, { maximumFractionDigits: digits });
const duration = (a: Activity) => {
  const seconds = a.movingSeconds ?? a.timerSeconds ?? a.elapsedSeconds;
  if (seconds == null) return '—';
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const durationLabel = (a: Activity) =>
  a.movingSeconds != null
    ? 'Moving time'
    : a.timerSeconds != null
      ? 'Timer duration'
      : 'Elapsed time';
const dateLabel = (a: Activity) => {
  const source = a.sourceDateTime;
  if (!source) return 'Date unavailable';
  const date = new Date(source.slice(0, 10).replaceAll('.', '-') + 'T12:00:00');
  return Number.isNaN(date.getTime())
    ? source
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const syncLabel = (state: string) =>
  ({
    confirmed: 'Synced',
    existing: 'Already in Garmin',
    unconfirmed: 'Check status',
    received: 'Check status',
    unknown: 'Not checked',
  })[state] || state;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
type ComparePair = { igp: Activity; garmin: Activity };
type Compare = {
  pairs: ComparePair[];
  fresh: Activity[];
  igpTotal: number;
  garminTotal: number;
  capped: boolean;
};
const buildCompare = (igpList: Activity[], garList: Activity[], capped: boolean): Compare => {
  // Only rides with no recorded outcome need a suggestion; the rest of the Hub already knows.
  const taken = new Set<string>();
  const pairs: ComparePair[] = [];
  const fresh: Activity[] = [];
  const unknown = [...igpList]
    .filter((a) => a.syncStatus === 'unknown')
    .sort((a, b) => (dayMoment(b) ?? 0) - (dayMoment(a) ?? 0));
  for (const igpRide of unknown) {
    let best: ComparePair | undefined;
    let bestScore = Infinity;
    for (const garminRide of garList) {
      if (taken.has(garminRide.id) || !looksLikeSameRide(igpRide, garminRide)) continue;
      const score = dayGap(igpRide, garminRide) * 1e6 + (distanceGap(igpRide, garminRide) ?? 0);
      if (score < bestScore) {
        bestScore = score;
        best = { igp: igpRide, garmin: garminRide };
      }
    }
    if (best) {
      taken.add(best.garmin.id);
      pairs.push(best);
    } else fresh.push(igpRide);
  }
  return { pairs, fresh, igpTotal: igpList.length, garminTotal: garList.length, capped };
};

function ConnectionState({ session }: { session?: Session }) {
  const labels = {
    connected: 'Connected',
    disconnected: 'Not connected',
    error: 'Unable to check',
    unavailable: 'Unavailable',
  };
  return (
    <span className={`status ${session?.state || 'checking'}`}>
      <span className="dot" aria-hidden="true" />
      {session ? labels[session.state] : 'Checking connection'}
    </span>
  );
}

function Modal({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else closeRef.current();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [tab, setTab] = useState<'home' | 'compare' | Provider>('home');
  const [status, setStatus] = useState<Status>();
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rows, setRows] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [unsyncedOnly, setUnsyncedOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Activity>();
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [login, setLogin] = useState<Provider>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [disconnect, setDisconnect] = useState<Provider>();
  const [confirm, setConfirm] = useState<Activity[]>([]);
  const [compare, setCompare] = useState<Compare>();
  const [compareLoading, setCompareLoading] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<Transfer>();
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem('apex-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const requestVersion = useRef(0);
  const detailVersion = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('apex-theme', theme);
  }, [theme]);
  async function refreshStatus() {
    setChecking(true);
    try {
      const next = await api<Status>('/status');
      setStatus(next);
      return next;
    } catch (e) {
      setError(errorMessage(e));
      setStatus((previous) =>
        previous
          ? {
              ...previous,
              sessions: {
                igpsport: { state: 'error', message: 'Unable to check. Retry when connected.' },
                garmin: { state: 'error', message: 'Unable to check. Retry when connected.' },
              },
            }
          : previous,
      );
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    void refreshStatus();
  }, []);
  async function loadActivities(provider: Provider, target = 1, append = false) {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const data = await api<{ activities: Activity[]; hasMore: boolean }>(
        `/${provider}/activities?page=${target}`,
      );
      if (version !== requestVersion.current) return;
      setRows((previous) => (append ? [...previous, ...data.activities] : data.activities));
      setMore(data.hasMore);
      setPage(target);
      setStatus((s) =>
        s
          ? {
              ...s,
              sessions: {
                ...s.sessions,
                [provider]: { state: 'connected', checkedAt: Date.now() / 1000 },
              },
            }
          : s,
      );
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(errorMessage(e));
      const rejected = e instanceof ApiError && (e.status === 401 || e.code === 'RECONNECT');
      setStatus((s) =>
        s
          ? {
              ...s,
              sessions: {
                ...s.sessions,
                [provider]: {
                  state: rejected ? 'disconnected' : 'error',
                  message: errorMessage(e),
                },
              },
            }
          : s,
      );
      if (rejected) {
        setRows([]);
        setSelected([]);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  async function fetchProviderList(provider: Provider) {
    let list: Activity[] = [];
    let page = 1;
    let more = true;
    while (more && page <= COMPARE_PAGES) {
      const data = await api<{ activities: Activity[]; hasMore: boolean }>(
        `/${provider}/activities?page=${page}`,
      );
      list = [...list, ...data.activities];
      more = data.hasMore;
      page++;
    }
    return { list, capped: more };
  }
  async function loadCompare() {
    const version = ++requestVersion.current;
    setCompareLoading(true);
    setError('');
    try {
      const [igp, gar] = await Promise.all([
        fetchProviderList('igpsport'),
        fetchProviderList('garmin'),
      ]);
      if (version !== requestVersion.current) return;
      // Keep the prompt honest: say so when the lists were cut short.
      setCompare(buildCompare(igp.list, gar.list, igp.capped || gar.capped));
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(errorMessage(e));
    } finally {
      if (version === requestVersion.current) setCompareLoading(false);
    }
  }
  function navigate(next: typeof tab) {
    ++requestVersion.current;
    setTab(next);
    setRows([]);
    setQuery('');
    setSelected([]);
    setUnsyncedOnly(false);
    setError('');
    setNotice('');
    setLoading(false);
    if (next === 'compare') {
      const bothConnected =
        status?.sessions.igpsport.state === 'connected' &&
        status.sessions.garmin.state === 'connected';
      if (bothConnected) void loadCompare();
    } else if (next !== 'home' && status?.sessions[next].state === 'connected') {
      void loadActivities(next);
    }
  }
  function openLogin(provider: Provider) {
    setLogin(provider);
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setCode('');
    setMfa(false);
    setLoginError('');
  }
  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!login || loginBusy) return;
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await api<{ needsMfa?: boolean }>(
        `/${login}/login`,
        mfa ? { code } : { username, password },
      );
      setPassword('');
      if (response.needsMfa) {
        setMfa(true);
        return;
      }
      const provider = login;
      setLogin(undefined);
      await refreshStatus();
      setNotice(`${names[provider]} connected. Your session is remembered in this browser.`);
      if (tab === provider) await loadActivities(provider);
    } catch (e) {
      setLoginError(errorMessage(e));
      setPassword('');
      if (e instanceof ApiError && e.code === 'MFA_EXPIRED') {
        setMfa(false);
        setCode('');
      }
    } finally {
      setLoginBusy(false);
    }
  }
  async function showDetail(activity: Activity) {
    const version = ++detailVersion.current;
    setDetail(activity);
    setDetailBusy(true);
    setDetailError('');
    setResult(undefined);
    try {
      const data = await api<Activity>(`/${activity.provider}/detail/${activity.id}`);
      if (version === detailVersion.current)
        setDetail({ ...activity, ...data, syncStatus: activity.syncStatus });
    } catch (e) {
      if (version === detailVersion.current) setDetailError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) void refreshStatus();
    } finally {
      if (version === detailVersion.current) setDetailBusy(false);
    }
  }
  function prepare(activities: Activity[]) {
    if (status?.sessions.garmin.state !== 'connected') {
      openLogin('garmin');
      return;
    }
    setDetail(undefined);
    ++detailVersion.current;
    setConfirm(activities);
  }
  async function transfer(activities: Activity[], check = false) {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      for (let index = 0; index < activities.length; index++) {
        const activity = activities[index];
        setProgress(
          `${check ? 'Checking Garmin' : 'Transferring and verifying'} · ${index + 1} of ${activities.length} · ${activity.title}`,
        );
        const next = await api<Transfer>(`/igpsport/${check ? 'check' : 'transfer'}`, {
          id: activity.id,
        });
        setResult(next);
        if (next.state === 'unconfirmed' || next.state === 'received') {
          setNotice(
            'Upload received, but not yet confirmed. Use Check status before sending again.',
          );
          break;
        }
      }
      setSelected([]);
      setConfirm([]);
      await refreshStatus();
      if (tab === 'igpsport') await loadActivities(tab);
      else if (tab === 'garmin') await loadActivities(tab);
      else if (tab === 'compare') await loadCompare();
    } catch (e) {
      setError(
        errorMessage(e) + ' If the request was interrupted, check Garmin before trying again.',
      );
      setConfirm([]);
      await refreshStatus();
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function disconnectAccount() {
    if (!disconnect) return;
    setBusy(true);
    try {
      await api(`/${disconnect}/disconnect`, {});
      setDisconnect(undefined);
      setRows([]);
      setSelected([]);
      await refreshStatus();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const filtered = rows.filter((a) =>
    `${a.title} ${a.sourceDateTime || ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const eligible = (a: Activity) =>
    !['confirmed', 'existing', 'received', 'unconfirmed'].includes(a.syncStatus);
  const visible = unsyncedOnly ? filtered.filter(eligible) : filtered;
  const connected = status
    ? providers.filter((p) => status.sessions[p].state === 'connected').length
    : 0;
  const missing = status ? providers.filter((p) => status.sessions[p].state !== 'connected') : [];

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button className="brand" onClick={() => navigate('home')} aria-label="iGPSPORT Hub home">
          <span>
            iGPSPORT <strong>Hub</strong>
          </span>
        </button>
        <div className="top-actions">
          <span className="environment">v{__APP_VERSION__}</span>
          <button
            className="icon-button theme"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
      </header>
      <div className="shell">
        <main id="main" className={tab === 'home' ? '' : 'activity-page'}>
          <nav className="tabs" aria-label="Main navigation">
            {(['home', ...providers, 'compare'] as const).map((item) => (
              <button
                key={item}
                className={tab === item ? 'nav active' : 'nav'}
                aria-current={tab === item ? 'page' : undefined}
                onClick={() => navigate(item)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {item === 'home' ? (
                    '⌂'
                  ) : item === 'compare' ? (
                    '⇄'
                  ) : (
                    <ProviderLogo provider={item} />
                  )}
                </span>
                <span>
                  {item === 'home' ? 'Home' : item === 'compare' ? 'Compare' : names[item]}
                </span>
                {(item === 'igpsport' || item === 'garmin') && (
                  <span
                    aria-label={status?.sessions[item].state || 'checking'}
                    className={`dot ${status?.sessions[item].state || ''}`}
                  />
                )}
              </button>
            ))}
          </nav>
          {status?.mode === 'cloud-preview' && (
            <div className="banner">
              Interface preview. Account connections and transfers are available in the local app;
              the Cloudflare integration is not configured yet.
            </div>
          )}
          {error && (
            <div className="alert" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="banner" role="status">
              {notice}
              <button className="text-button" onClick={() => setNotice('')}>
                Dismiss
              </button>
            </div>
          )}
          {busy && (
            <div className="banner" role="status">
              <Spinner />
              {progress || 'Updating connection…'} Keep this page open.
            </div>
          )}
          {result && !busy && (
            <div className="result" role="status">
              <div>
                <strong>
                  {result.state === 'confirmed'
                    ? 'Your ride is in Garmin.'
                    : result.state === 'existing'
                      ? 'This ride is already in Garmin.'
                      : 'Upload needs a status check.'}
                </strong>
                <p>{result.title}</p>
              </div>
              {['unconfirmed', 'received'].includes(result.state) && (
                <AsyncButton
                  busy={busy}
                  busyLabel="Checking Garmin…"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void transfer([{ id: result.sourceId, title: result.title } as Activity], true)
                  }
                >
                  Check status
                </AsyncButton>
              )}
              {result.activityId && (
                <a
                  href={`https://connect.garmin.com/modern/activity/${result.activityId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View in Garmin ↗
                </a>
              )}
            </div>
          )}
          {tab === 'home' ? (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">Activity transfer</p>
                  <h1>Your ride connections.</h1>
                  <p className="subtitle">
                    Bring the rides you choose from iGPSPORT to Garmin Connect.
                  </p>
                </div>
                <AsyncButton
                  busy={checking}
                  busyLabel="Checking…"
                  className="secondary"
                  disabled={checking || busy}
                  onClick={() => {
                    setError('');
                    void refreshStatus();
                  }}
                >
                  {checking ? 'Checking…' : 'Check connections'}
                </AsyncButton>
              </div>
              {status && !checking && missing.length > 0 && (
                <div className="callout" role="status">
                  <div>
                    <strong>
                      {missing.length === 2
                        ? 'Connect both accounts to transfer rides.'
                        : `Connect ${names[missing[0]]} to keep transferring.`}
                    </strong>
                    <p>
                      {missing.length === 2
                        ? 'Sign in with your existing accounts. No iGPSPORT Hub registration needed.'
                        : `${names[missing[0]]} is the ${
                            missing[0] === 'igpsport' ? 'ride source' : 'transfer destination'
                          }. ${status.sessions[missing[0]].message || ''}`}
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={status.sessions[missing[0]].state === 'unavailable'}
                    onClick={() =>
                      status.sessions[missing[0]].state === 'error'
                        ? void refreshStatus()
                        : openLogin(missing[0])
                    }
                  >
                    {status.sessions[missing[0]].state === 'error'
                      ? 'Retry connection'
                      : `Connect ${names[missing[0]]}`}
                  </button>
                </div>
              )}
              <p className="howto-hint">
                First time here?
                <button className="text-button" onClick={() => setHelp(true)}>
                  See how it works
                </button>
              </p>
              <section className="connections-section" aria-labelledby="connections-title">
                <div className="section-head">
                  <h2 id="connections-title">Your connections</h2>
                  <span>{checking ? 'Checking sessions' : `${connected} of 2 connected`}</span>
                </div>
                <div className="connection-grid">
                  {providers.map((provider, index) => (
                    <article className="connection-card" key={provider}>
                      <div className="connection-top">
                        <span className="step-chip">Step {index + 1}</span>
                        <ConnectionState session={status?.sessions[provider]} />
                      </div>
                      <h3 className="provider-heading">
                        <ProviderLogo provider={provider} />
                        {names[provider]}
                      </h3>
                      <p>
                        {provider === 'igpsport'
                          ? 'Choose the rides you want to bring across.'
                          : 'Your destination for selected rides.'}
                      </p>
                      <div className="connection-bottom">
                        <AsyncButton
                          busy={checking}
                          busyLabel="Checking…"
                          className={
                            status?.sessions[provider].state === 'connected'
                              ? 'primary'
                              : 'secondary'
                          }
                          disabled={
                            checking || busy || status?.sessions[provider].state === 'unavailable'
                          }
                          onClick={() =>
                            status?.sessions[provider].state === 'connected'
                              ? navigate(provider)
                              : status?.sessions[provider].state === 'error'
                                ? void refreshStatus()
                                : openLogin(provider)
                          }
                        >
                          {status?.sessions[provider].state === 'connected'
                            ? 'View activities'
                            : status?.sessions[provider].state === 'error'
                              ? 'Retry connection'
                              : 'Connect account'}
                        </AsyncButton>
                        {status?.sessions[provider].state === 'connected' && (
                          <button className="text-button" onClick={() => setDisconnect(provider)}>
                            Disconnect
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="history-section">
                <div className="section-head">
                  <h2>Recent transfers</h2>
                  <span>iGPSPORT to Garmin</span>
                </div>
                {status?.history.length ? (
                  <div className="history-list">
                    {status.history.map((h, index) => (
                      <article key={`${h.sourceId}-${index}`}>
                        <span className="history-symbol" aria-hidden="true">
                          ↗
                        </span>
                        <div>
                          <strong>{h.title}</strong>
                          <p>{new Date(h.at * 1000).toLocaleString()}</p>
                        </div>
                        <span className="sync-label">{syncLabel(h.state)}</span>
                        {h.activityId ? (
                          <a
                            href={`https://connect.garmin.com/modern/activity/${h.activityId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View ride ↗
                          </a>
                        ) : (
                          <AsyncButton
                            busy={busy}
                            busyLabel="Checking Garmin…"
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void transfer([{ id: h.sourceId, title: h.title } as Activity], true)
                            }
                          >
                            Check status
                          </AsyncButton>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty history-empty">
                    <span className="empty-symbol" aria-hidden="true">
                      ↗
                    </span>
                    <h3>No transfers yet.</h3>
                    <p>
                      Choose an iGPSPORT activity to make your first transfer.
                      <br />
                      Confirmed transfers will appear here.
                    </p>
                    <button className="text-button" onClick={() => navigate('igpsport')}>
                      Browse iGPSPORT activities →
                    </button>
                  </div>
                )}
              </section>
              <footer>
                <span>No automatic syncing. You’re in control.</span>
                <span>iGPSPORT Hub v{__APP_VERSION__} · Unofficial integration</span>
              </footer>
            </>
          ) : tab === 'compare' ? (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">
                    <span aria-hidden="true">⇄</span> Suggestions
                  </p>
                  <h1>Compare rides</h1>
                  <p className="subtitle">
                    Guess which rides may have left iGPSPORT without the Hub, and which may already
                    be in Garmin.
                  </p>
                </div>
                <div className="connection-stack">
                  {providers.map((provider) => (
                    <ConnectionState key={provider} session={status?.sessions[provider]} />
                  ))}
                </div>
              </div>
              {!status || connected < 2 ? (
                <div className="empty connect-empty">
                  <span className="provider-mark" aria-hidden="true">
                    ⇄
                  </span>
                  <h2>Connect both sides</h2>
                  <p>A comparison reads rides from both of your accounts.</p>
                  {status && missing.length > 0 && (
                    <div className="connect-actions">
                      {missing.map((provider) => (
                        <button
                          key={provider}
                          className="primary"
                          disabled={status.sessions[provider].state === 'unavailable'}
                          onClick={() =>
                            status.sessions[provider].state === 'error'
                              ? void refreshStatus()
                              : openLogin(provider)
                          }
                        >
                          {status.sessions[provider].state === 'error'
                            ? `Retry ${names[provider]}`
                            : `Connect ${names[provider]}`}
                        </button>
                      ))}
                    </div>
                  )}
                  <small>Suggestions only. No new accounts needed.</small>
                </div>
              ) : compareLoading && !compare ? (
                <div className="empty" role="status">
                  <Spinner />
                  <p>Reading both activity lists…</p>
                </div>
              ) : compare ? (
                <>
                  <div className="toolbar">
                    <AsyncButton
                      busy={compareLoading}
                      busyLabel="Comparing…"
                      className="secondary"
                      disabled={compareLoading || busy}
                      onClick={() => void loadCompare()}
                    >
                      {compareLoading ? 'Comparing…' : '↻ Compare again'}
                    </AsyncButton>
                  </div>
                  <div className="list-meta">
                    <span>
                      {compare.igpTotal} iGPSPORT rides · {compare.garminTotal} Garmin rides
                      compared
                    </span>
                    {compare.capped && <span>Compared the newest 5 pages from each side</span>}
                  </div>
                  <section className="compare-section" aria-labelledby="fresh-title">
                    <div className="section-head">
                      <h2 id="fresh-title">Not yet seen in Garmin</h2>
                      <span>{compare.fresh.length} rides</span>
                    </div>
                    {!compare.fresh.length ? (
                      <div className="empty">
                        <h3>All caught up</h3>
                        <p>
                          None of the compared iGPSPORT rides stand alone. Check back after new
                          rides import.
                        </p>
                      </div>
                    ) : (
                      <div className="compare-grid">
                        {compare.fresh.map((activity) => (
                          <article className="compare-card" key={activity.id}>
                            <strong className="ride-name">{activity.title}</strong>
                            <span className="ride-meta">
                              {dateLabel(activity)} · {metric(activity.distanceMeters, 0.001, 2)} km
                              · {duration(activity)}
                            </span>
                            <button
                              className="primary"
                              disabled={busy || !status?.capabilities.transfer}
                              onClick={() => prepare([activity])}
                            >
                              Send to Garmin
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                  <section className="compare-section" aria-labelledby="pair-title">
                    <div className="section-head">
                      <h2 id="pair-title">Likely already in Garmin</h2>
                      <span>{compare.pairs.length} guesses</span>
                    </div>
                    {!compare.pairs.length ? (
                      <div className="empty">
                        <h3>No close matches</h3>
                        <p>
                          Nothing in Garmin Connect lines up with the remaining rides on date,
                          distance and time.
                        </p>
                      </div>
                    ) : (
                      <div className="compare-grid">
                        {compare.pairs.map((pair) => (
                          <article className="compare-pair" key={pair.igp.id}>
                            <div className="match-side">
                              <strong>{pair.igp.title}</strong>
                              <span>
                                {dateLabel(pair.igp)} · {metric(pair.igp.distanceMeters, 0.001, 2)}{' '}
                                km · {duration(pair.igp)}
                              </span>
                            </div>
                            <span className="match-eq" aria-hidden="true">
                              ≈
                            </span>
                            <div className="match-side">
                              <strong>{pair.garmin.title}</strong>
                              <span>
                                {dateLabel(pair.garmin)} ·{' '}
                                {metric(pair.garmin.distanceMeters, 0.001, 2)} km ·{' '}
                                {duration(pair.garmin)}
                              </span>
                            </div>
                            <p className="match-note">
                              {dayGap(pair.igp, pair.garmin) === 0 ? 'Same day' : 'One day apart'} ·{' '}
                              {((distanceGap(pair.igp, pair.garmin) ?? 0) / 1000).toLocaleString(
                                undefined,
                                {
                                  maximumFractionDigits: 2,
                                },
                              )}{' '}
                              km apart · {minuteGap(pair.igp, pair.garmin)}
                            </p>
                            <a
                              className="text-button"
                              href={`https://connect.garmin.com/modern/activity/${pair.garmin.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Garmin ↗
                            </a>
                          </article>
                        ))}
                      </div>
                    )}
                    <p className="form-note">
                      Suggestions read date, distance and time only. A matched pair is not proof:
                      open the ride in Garmin Connect to be sure before you skip it.
                    </p>
                  </section>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow provider-heading">
                    <ProviderLogo provider={tab} />
                    {names[tab]}
                  </p>
                  <h1>Your activities</h1>
                  <p className="subtitle">
                    {tab === 'igpsport'
                      ? 'Choose a ride. Keep the original data. Send it to Garmin.'
                      : 'Browse the activities in your Garmin account.'}
                  </p>
                </div>
                <ConnectionState session={status?.sessions[tab]} />
              </div>
              {status?.sessions[tab].state !== 'connected' ? (
                <div className="empty connect-empty">
                  <span className={`provider-mark ${tab}`} aria-hidden="true">
                    <ProviderLogo provider={tab} />
                  </span>
                  <h2>
                    {status?.sessions[tab].state === 'error'
                      ? 'Connection unavailable'
                      : `Connect ${names[tab]}`}
                  </h2>
                  <p>
                    {status?.sessions[tab].message ||
                      'Sign in with your existing account to see your activities.'}
                  </p>
                  <AsyncButton
                    busy={loading}
                    busyLabel="Loading activities…"
                    className="primary"
                    disabled={!status?.capabilities.login || checking || loading}
                    onClick={() =>
                      status?.sessions[tab].state === 'error'
                        ? void loadActivities(tab)
                        : openLogin(tab)
                    }
                  >
                    {loading
                      ? 'Checking…'
                      : status?.sessions[tab].state === 'error'
                        ? 'Retry connection'
                        : 'Connect account'}
                  </AsyncButton>
                  <small>No iGPSPORT Hub registration needed.</small>
                </div>
              ) : (
                <>
                  {tab === 'igpsport' &&
                    status &&
                    !checking &&
                    status.sessions.garmin.state !== 'connected' && (
                      <div className="callout" role="status">
                        <div>
                          <strong>
                            {status.sessions.garmin.state === 'error'
                              ? 'Garmin connection needs a check.'
                              : 'Garmin Connect isn’t connected yet.'}
                          </strong>
                          <p>
                            Connect Garmin Connect before sending rides; that’s where your selection
                            ends up.
                          </p>
                        </div>
                        <button
                          className="primary"
                          disabled={status.sessions.garmin.state === 'unavailable'}
                          onClick={() =>
                            status.sessions.garmin.state === 'error'
                              ? void refreshStatus()
                              : openLogin('garmin')
                          }
                        >
                          {status.sessions.garmin.state === 'error'
                            ? 'Check connection'
                            : 'Connect Garmin Connect'}
                        </button>
                      </div>
                    )}
                  <div className="toolbar">
                    <label className="search">
                      <span aria-hidden="true">⌕</span>
                      <input
                        aria-label="Search loaded activities"
                        placeholder="Search loaded activities"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <AsyncButton
                      busy={loading}
                      busyLabel="Loading activities…"
                      className="secondary"
                      disabled={loading || busy}
                      onClick={() => void loadActivities(tab)}
                    >
                      {loading ? 'Refreshing…' : '↻ Refresh'}
                    </AsyncButton>
                    {tab === 'igpsport' && (
                      <button
                        className="secondary"
                        aria-pressed={unsyncedOnly}
                        disabled={loading || busy}
                        onClick={() => setUnsyncedOnly(!unsyncedOnly)}
                      >
                        Unsynced only
                      </button>
                    )}
                  </div>
                  <div className="list-meta">
                    <span>
                      {visible.length} {visible.length === 1 ? 'activity' : 'activities'}
                      {query ? ' matching' : unsyncedOnly ? ' unsynced' : ' loaded'}
                    </span>
                    {tab === 'igpsport' && (
                      <button
                        className="text-button"
                        disabled={loading || busy || !filtered.some(eligible)}
                        onClick={() =>
                          setSelected(
                            filtered
                              .filter(eligible)
                              .slice(0, 10)
                              .map((a) => a.id),
                          )
                        }
                      >
                        Select unsynced
                      </button>
                    )}
                    {status?.sessions[tab].checkedAt && (
                      <span>
                        Updated{' '}
                        {new Date(status.sessions[tab].checkedAt! * 1000).toLocaleTimeString(
                          undefined,
                          { hour: '2-digit', minute: '2-digit', second: '2-digit' },
                        )}
                      </span>
                    )}
                    {tab === 'igpsport' && <span>Select up to 10 rides</span>}
                  </div>
                  {loading && !rows.length ? (
                    <div className="empty" role="status">
                      <Spinner />
                      <p>Loading your activities…</p>
                    </div>
                  ) : !visible.length ? (
                    <div className="empty">
                      <h3>
                        {query
                          ? 'No matching activities'
                          : unsyncedOnly
                            ? 'All caught up'
                            : 'No activities yet'}
                      </h3>
                      <p>
                        {query
                          ? 'Try a different name or date.'
                          : unsyncedOnly
                            ? 'Every loaded ride is already synced or awaiting its status check.'
                            : 'Activities will appear here after they are available in your account.'}
                      </p>
                      {(query || unsyncedOnly) && (
                        <button
                          className="secondary"
                          onClick={() => (query ? setQuery('') : setUnsyncedOnly(false))}
                        >
                          {query ? 'Clear search' : 'Show all rides'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="activity-table">
                      <div className={`table-head ${tab === 'garmin' ? 'garmin-grid' : ''}`}>
                        {tab === 'igpsport' && <span />}
                        <span>Activity</span>
                        <span>Distance</span>
                        <span>Time</span>
                        <span>{tab === 'igpsport' ? 'Transfer' : 'Details'}</span>
                      </div>
                      {visible.map((activity) => (
                        <div
                          className={`activity-row ${tab === 'garmin' ? 'garmin-grid' : ''}`}
                          key={activity.id}
                        >
                          {tab === 'igpsport' && (
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                aria-label={`Select ${activity.title} on ${dateLabel(activity)}`}
                                checked={selected.includes(activity.id)}
                                disabled={
                                  busy ||
                                  !eligible(activity) ||
                                  (selected.length >= 10 && !selected.includes(activity.id))
                                }
                                onChange={(e) =>
                                  setSelected((prev) =>
                                    e.target.checked
                                      ? [...prev, activity.id]
                                      : prev.filter((id) => id !== activity.id),
                                  )
                                }
                              />
                            </label>
                          )}
                          <button className="ride-title" onClick={() => void showDetail(activity)}>
                            <strong>{activity.title}</strong>
                            <span>
                              {dateLabel(activity)}
                              {activity.deviceName ? ` · ${activity.deviceName}` : ''}
                              {activity.syncStatus !== 'unknown' && (
                                <span className="compact-sync">
                                  {' '}
                                  · {syncLabel(activity.syncStatus)}
                                </span>
                              )}
                            </span>
                          </button>
                          <span className="row-metric">
                            <b>{metric(activity.distanceMeters, 0.001, 2)}</b> km
                          </span>
                          <span className="row-time">
                            <b>{duration(activity)}</b>
                            <small>{durationLabel(activity)}</small>
                          </span>
                          <button className="row-action" onClick={() => void showDetail(activity)}>
                            {tab === 'igpsport' ? syncLabel(activity.syncStatus) : 'View details'}{' '}
                            <span aria-hidden="true">›</span>
                          </button>
                          <div className="activity-extras">
                            <span>
                              Avg speed{' '}
                              <strong>{metric(activity.averageSpeedMps, 3.6)} km/h</strong>
                            </span>
                            <span>
                              Ascent <strong>{metric(activity.ascentMeters, 1, 0)} m</strong>
                            </span>
                            {activity.averageHeartRateBpm != null && (
                              <span>
                                Avg heart rate{' '}
                                <strong>{metric(activity.averageHeartRateBpm, 1, 0)} bpm</strong>
                              </span>
                            )}
                            {activity.caloriesKcal != null && (
                              <span>
                                Energy <strong>{metric(activity.caloriesKcal, 1, 0)} kcal</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {more && (
                    <div className="load-more">
                      <AsyncButton
                        busy={loading}
                        busyLabel="Loading activities…"
                        className="secondary"
                        disabled={loading || busy}
                        onClick={() => void loadActivities(tab, page + 1, true)}
                      >
                        {loading ? 'Loading…' : 'Load older activities'}
                      </AsyncButton>
                    </div>
                  )}
                  {tab === 'igpsport' && selected.length > 0 && (
                    <div className="selection-bar">
                      <span>
                        <strong>{selected.length}</strong>{' '}
                        {selected.length === 1 ? 'ride' : 'rides'} selected
                      </span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setSelected([])}
                      >
                        Clear
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !status?.capabilities.transfer}
                        onClick={() => prepare(rows.filter((a) => selected.includes(a.id)))}
                      >
                        Send to Garmin
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      {login && (
        <Modal
          title={mfa ? 'Verify your Garmin account' : `Connect ${names[login]}`}
          onClose={() => {
            setLogin(undefined);
            setPassword('');
            setCode('');
          }}
          busy={loginBusy}
        >
          <p className="dialog-intro">
            {mfa
              ? 'Enter the verification code Garmin sent you.'
              : 'Use your existing account. Your session is remembered in this browser; your password is not saved.'}
          </p>
          <form onSubmit={submitLogin}>
            {loginError && (
              <div className="alert" role="alert">
                {loginError}
              </div>
            )}
            {mfa ? (
              <label>
                Verification code
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </label>
            ) : (
              <>
                <label>
                  Email or username
                  <input
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <span className="password-field">
                    <input
                      aria-label="Password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                </label>
              </>
            )}
            <p className="form-note">
              Unofficial connection. Your password is sent only to {names[login]}, never stored.
            </p>
            <AsyncButton
              type="submit"
              busy={loginBusy}
              busyLabel="Connecting…"
              className="primary full"
              disabled={loginBusy}
            >
              {loginBusy ? 'Connecting…' : mfa ? 'Verify account' : 'Connect account'}
            </AsyncButton>
            {loginBusy && (
              <p role="status">This may take several seconds. Please keep this window open.</p>
            )}
          </form>
        </Modal>
      )}
      {detail && (
        <Modal
          title={detail.title}
          onClose={() => {
            setDetail(undefined);
            ++detailVersion.current;
          }}
          busy={busy}
        >
          <p className="dialog-intro">
            {dateLabel(detail)} · {names[detail.provider]}
          </p>
          {detailBusy && (
            <p className="loading-label" role="status">
              <Spinner />
              Loading activity details…
            </p>
          )}
          {detailError && (
            <div className="alert" role="alert">
              {detailError}
            </div>
          )}
          <dl className="detail-metrics">
            <div>
              <dt>Distance</dt>
              <dd>
                {metric(detail.distanceMeters, 0.001, 2)} <small>km</small>
              </dd>
            </div>
            <div>
              <dt>{durationLabel(detail)}</dt>
              <dd>{duration(detail)}</dd>
            </div>
            <div>
              <dt>Average speed</dt>
              <dd>
                {metric(detail.averageSpeedMps, 3.6)} <small>km/h</small>
              </dd>
            </div>
            <div>
              <dt>Ascent</dt>
              <dd>
                {metric(detail.ascentMeters, 1, 0)} <small>m</small>
              </dd>
            </div>
            {[
              ['Max speed', detail.maxSpeedMps, 3.6, 'km/h'],
              ['Avg heart rate', detail.averageHeartRateBpm, 1, 'bpm'],
              ['Max heart rate', detail.maxHeartRateBpm, 1, 'bpm'],
              ['Avg cadence', detail.averageCadenceRpm, 1, 'rpm'],
              ['Max cadence', detail.maxCadenceRpm, 1, 'rpm'],
              ['Energy', detail.caloriesKcal, 1, 'kcal'],
            ]
              .filter(([, value]) => value != null)
              .map(([label, value, factor, unit]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>
                    {metric(value as number, factor as number, factor === 1 ? 0 : 1)}{' '}
                    <small>{unit}</small>
                  </dd>
                </div>
              ))}
            {detail.elapsedSeconds != null && (
              <div>
                <dt>Elapsed time</dt>
                <dd>{duration({ ...detail, movingSeconds: null, timerSeconds: null })}</dd>
              </div>
            )}
          </dl>
          <p className="form-note">Unavailable measurements are shown as a dash.</p>
          {detail.provider === 'igpsport' ? (
            <>
              <p className="detail-note">
                The original FIT file is transferred. Your iGPSPORT activity stays in place.
              </p>
              {['received', 'unconfirmed'].includes(detail.syncStatus) ? (
                <AsyncButton
                  busy={busy}
                  busyLabel="Checking Garmin…"
                  className="primary full"
                  disabled={busy}
                  onClick={() => {
                    const a = detail;
                    setDetail(undefined);
                    void transfer([a], true);
                  }}
                >
                  Check Garmin status
                </AsyncButton>
              ) : (
                <button
                  className="primary full"
                  disabled={
                    busy || detailBusy || !eligible(detail) || !status?.capabilities.transfer
                  }
                  onClick={() => prepare([detail])}
                >
                  {eligible(detail) ? 'Send to Garmin' : 'Already synced'}
                </button>
              )}
            </>
          ) : (
            <>
              <a
                className="primary full button-link"
                href={`https://connect.garmin.com/modern/activity/${detail.id}`}
                target="_blank"
                rel="noreferrer"
              >
                View in Garmin ↗
              </a>
              <p className="form-note">Transfers from Garmin to iGPSPORT aren’t supported yet.</p>
            </>
          )}
        </Modal>
      )}
      {confirm.length > 0 && (
        <Modal
          title={`Send ${confirm.length === 1 ? 'this ride' : `${confirm.length} rides`} to Garmin?`}
          onClose={() => setConfirm([])}
          busy={busy}
        >
          <p className="dialog-intro">{confirm.map((a) => a.title).join(', ')}</p>
          <p>
            We’ll check for existing activities, transfer each original FIT file, then verify the
            result in Garmin.
          </p>
          <p className="form-note">Keep the page open until verification finishes.</p>
          <div className="dialog-actions">
            <button className="secondary" disabled={busy} onClick={() => setConfirm([])}>
              Cancel
            </button>
            <AsyncButton
              busy={busy}
              busyLabel="Transferring and verifying…"
              className="primary"
              disabled={busy}
              onClick={() => void transfer(confirm)}
            >
              {busy ? 'Transferring and verifying…' : 'Confirm transfer'}
            </AsyncButton>
          </div>
          {busy && <p role="status">{progress}</p>}
        </Modal>
      )}
      {help && (
        <Modal title="How to use iGPSPORT Hub" onClose={() => setHelp(false)}>
          <p className="dialog-intro">
            Four steps. Nothing syncs automatically and nothing is deleted.
          </p>
          <ol className="steps-modal">
            <li>
              <strong>Connect iGPSPORT:</strong> sign in with your iGPSPORT account. This stays
              signed in.
            </li>
            <li>
              <strong>Connect Garmin:</strong> sign in with your Garmin Connect account. Also just
              once.
            </li>
            <li>
              <strong>Pick your rides:</strong> open the iGPSPORT tab, browse, and tick the rides
              you want (up to 10 at a time).
            </li>
            <li>
              <strong>Send to Garmin:</strong> press “Send to Garmin”. Your rides appear in Garmin
              Connect a moment later.
            </li>
          </ol>
          <p className="form-note">
            No new accounts needed: you only sign in with accounts you already have. Sessions are
            remembered in this browser, so you won’t be asked again next time. The Compare tab can
            also surface rides that may have moved outside the Hub.
          </p>
          <div className="dialog-actions">
            <button className="primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
      {disconnect && (
        <Modal
          title={`Disconnect ${names[disconnect]}?`}
          onClose={() => setDisconnect(undefined)}
          busy={busy}
        >
          <p className="dialog-intro">
            This removes the saved session from this browser. Your activities stay in your account.
          </p>
          <div className="dialog-actions">
            <button className="secondary" disabled={busy} onClick={() => setDisconnect(undefined)}>
              Cancel
            </button>
            <AsyncButton
              busy={busy}
              busyLabel="Disconnecting…"
              className="primary"
              disabled={busy}
              onClick={() => void disconnectAccount()}
            >
              Disconnect
            </AsyncButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
