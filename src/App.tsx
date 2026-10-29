import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AppContext, type AppState, type Tab } from './app-context';
import { AsyncButton, ProviderLogo, Spinner } from './components';
import { CompareIcon, GitHubIcon, HomeIcon, MoonIcon, SunIcon } from './icons';
import { Home } from './pages/Home';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { ComparePage } from './pages/ComparePage';
import { Modals } from './Modals';
import { api, ApiError, type Activity, type Provider, type Status, type Transfer } from './api';
import { AUTO_COMPARE_WAIT, COMPARE_PAGES, buildCompare, type Compare } from './compare';
import { errorMessage, names } from './format';

import { MAX_TRANSFER_BATCH } from './transfer';

const providers: Provider[] = ['igpsport', 'garmin'];
const hashToTab = (hash: string): Tab | null => {
  const match = /^#\/(home|igpsport|garmin|compare)$/.exec(hash);
  return (match?.[1] as Tab) ?? null;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<Transfer>();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () =>
      (localStorage.getItem('apex-theme') as 'light' | 'dark' | null) ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const requestVersion = useRef(0);
  const detailVersion = useRef(0);
  const mounted = useRef(false);
  const transferActive = useRef(false);

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
    let index = 1;
    let hasMore = true;
    while (hasMore && index <= COMPARE_PAGES) {
      const data = await api<{ activities: Activity[]; hasMore: boolean }>(
        `/${provider}/activities?page=${index}`,
      );
      list = [...list, ...data.activities];
      hasMore = data.hasMore;
      index++;
    }
    return { list, capped: hasMore };
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
      setCompare({
        ...buildCompare(igp.list, gar.list, igp.capped || gar.capped),
        fetchedAt: Date.now(),
      });
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(errorMessage(e));
    } finally {
      if (version === requestVersion.current) setCompareLoading(false);
    }
  }

  // Tab state reaches the URL as a hash, so reload and browser history land back here.
  function commitTab(next: Tab) {
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
      // Fresh enough data answers instantly; Compare again stays freely reachable.
      if (bothConnected && (!compare || Date.now() - compare.fetchedAt > AUTO_COMPARE_WAIT))
        void loadCompare();
    } else if (next !== 'home' && status?.sessions[next].state === 'connected') {
      void loadActivities(next);
    }
  }

  function navigate(next: Tab) {
    if (hashToTab(location.hash) === next) commitTab(next);
    else location.hash = `#/${next}`;
  }

  useEffect(() => {
    if (!location.hash) history.replaceState(null, '', '#/home');
    const onHashChange = () => {
      const next = hashToTab(location.hash) ?? 'home';
      if (next !== tab) commitTab(next);
    };
    window.addEventListener('hashchange', onHashChange);
    // Deep link: a saved hash opens straight into that tab. Runs once, on mount only.
    if (!mounted.current) {
      mounted.current = true;
      const initial = hashToTab(location.hash);
      if (initial && initial !== 'home') commitTab(initial);
    }
    return () => window.removeEventListener('hashchange', onHashChange);
    // Re-registered each render so commitTab always sees current state.
  });

  // Finish deep links / refreshes: first connection check loads the open tab's data.
  useEffect(() => {
    if (checking || !status) return;
    if (
      (tab === 'igpsport' || tab === 'garmin') &&
      status.sessions[tab].state === 'connected' &&
      !rows.length &&
      !loading
    ) {
      void loadActivities(tab);
    } else if (tab === 'compare') {
      const bothConnected =
        status.sessions.igpsport.state === 'connected' &&
        status.sessions.garmin.state === 'connected';
      if (bothConnected && (!compare || Date.now() - compare.fetchedAt > AUTO_COMPARE_WAIT))
        void loadCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

  function openLogin(provider: Provider) {
    setLogin(provider);
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setCode('');
    setMfa(false);
    setLoginError('');
  }

  async function submitLogin(e: FormEvent) {
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
    if (busy) return;
    if (activities.length > MAX_TRANSFER_BATCH) {
      setError(`Select up to ${MAX_TRANSFER_BATCH} rides per transfer.`);
      return;
    }
    if (status?.sessions.garmin.state !== 'connected') {
      setNotice(
        'Sign in to Garmin Connect first: rides can only be sent once the destination is connected.',
      );
      openLogin('garmin');
      return;
    }
    setDetail(undefined);
    ++detailVersion.current;
    setConfirm(activities);
  }

  async function transfer(activities: Activity[], check = false) {
    if (busy || transferActive.current) return;
    if (!activities.length || activities.length > MAX_TRANSFER_BATCH) {
      setError(`Select between 1 and ${MAX_TRANSFER_BATCH} rides per transfer.`);
      return;
    }
    transferActive.current = true;
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
      transferActive.current = false;
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

  const connectedCount = status
    ? providers.filter((p) => status.sessions[p].state === 'connected').length
    : 0;
  const missing = status ? providers.filter((p) => status.sessions[p].state !== 'connected') : [];

  const state: AppState = {
    version: __APP_VERSION__,
    tab,
    navigate,
    theme,
    toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light'),
    status,
    checking,
    refreshStatus,
    busy,
    progress,
    error,
    setError,
    notice,
    setNotice,
    result,
    checkStatusAgain: (sourceId, title) =>
      void transfer([{ id: sourceId, title } as Activity], true),
    checkConnections: () => {
      setError('');
      void refreshStatus();
    },
    connectedCount,
    missing,
    openLogin,
    homeAction: (provider) => {
      const session = status?.sessions[provider];
      if (session?.state === 'connected') navigate(provider);
      else if (session?.state === 'error') void refreshStatus();
      else openLogin(provider);
    },
    setDisconnect,
    disconnect,
    disconnectAccount,
    helpOpen,
    openHelp: () => setHelpOpen(true),
    closeHelp: () => setHelpOpen(false),
    rows,
    loading,
    hasMore: more,
    query,
    setQuery,
    unsyncedOnly,
    setUnsyncedOnly,
    selected,
    setSelected,
    toggleSelect: (id, checked) =>
      setSelected((previous) =>
        checked
          ? previous.includes(id) || previous.length >= MAX_TRANSFER_BATCH
            ? previous
            : [...previous, id]
          : previous.filter((value) => value !== id),
      ),
    refreshActivities: () => {
      if (tab === 'igpsport' || tab === 'garmin') void loadActivities(tab);
    },
    loadOlder: () => {
      if ((tab === 'igpsport' || tab === 'garmin') && more)
        void loadActivities(tab, page + 1, true);
    },
    openDetail: (activity) => void showDetail(activity),
    prepare,
    checkTransfer: (activity) => {
      setDetail(undefined);
      ++detailVersion.current;
      void transfer([activity], true);
    },
    runTransfer: (activities) => void transfer(activities),
    compare,
    compareLoading,
    loadCompare: () => void loadCompare(),
    login,
    loginMfa: mfa,
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    code,
    setCode,
    loginError,
    loginBusy,
    setLogin,
    submitLogin,
    closeLogin: () => {
      setLogin(undefined);
      setPassword('');
      setCode('');
    },
    detail,
    detailBusy,
    detailError,
    closeDetail: () => {
      setDetail(undefined);
      ++detailVersion.current;
    },
    confirm,
    setConfirm,
  };

  return (
    <AppContext.Provider value={state}>
      <div className="app">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <button
              className="brand"
              onClick={() => navigate('home')}
              aria-label="iGPSPORT Hub home"
            >
              <ProviderLogo provider="igpsport" />
              <span>
                iGPSPORT <strong>Hub</strong>
              </span>
            </button>
            <div className="top-actions">
              <span className="environment">v{__APP_VERSION__}</span>
              <a
                className="github-link"
                href="https://github.com/albertjohannes-id/igpsport-hub"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View iGPSPORT Hub on GitHub (opens in a new tab)"
              >
                <GitHubIcon />
                GitHub
              </a>
              <button
                className="icon-button theme"
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <MoonIcon /> : <SunIcon />}
              </button>
            </div>
          </div>
        </header>

        <div className="shell">
          <main id="main" className={tab === 'home' ? '' : 'activity-page'}>
            <div className="page-body" key={tab}>
              {status?.mode === 'cloud-preview' && (
                <div className="banner">
                  Interface preview. Account connections and transfers are available in the local
                  app; the Cloudflare integration is not configured yet.
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
                      onClick={() => state.checkStatusAgain(result.sourceId, result.title)}
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
                <Home />
              ) : tab === 'compare' ? (
                <ComparePage />
              ) : (
                <ActivitiesPage tab={tab} />
              )}
            </div>
          </main>
        </div>

        <nav className="bottomnav" aria-label="Main navigation">
          {(['home', ...providers, 'compare'] as const).map((item) => (
            <button
              key={item}
              className={tab === item ? 'nav active' : 'nav'}
              aria-current={tab === item ? 'page' : undefined}
              onClick={() => navigate(item)}
            >
              <span className="nav-symbol" aria-hidden="true">
                {item === 'home' ? (
                  <HomeIcon />
                ) : item === 'compare' ? (
                  <CompareIcon />
                ) : (
                  <ProviderLogo provider={item} />
                )}
              </span>
              <span>{item === 'home' ? 'Home' : item === 'compare' ? 'Compare' : names[item]}</span>
              {(item === 'igpsport' || item === 'garmin') && (
                <span
                  aria-label={status?.sessions[item].state || 'checking'}
                  className={`dot ${status?.sessions[item].state || ''}`}
                />
              )}
            </button>
          ))}
        </nav>

        <Modals />
      </div>
    </AppContext.Provider>
  );
}
