import { AsyncButton, ProviderLogo } from '../components';
import { useApp } from '../app-context';
import { names, syncLabel } from '../format';

const providers = ['igpsport', 'garmin'] as const;

function ConnectionState({ session }: { session?: { state: string } }) {
  const labels: Record<string, string> = {
    connected: 'Connected',
    disconnected: 'Not connected',
    error: 'Unable to check',
    unavailable: 'Unavailable',
  };
  const state = session?.state || 'checking';
  return (
    <span className={`status ${session?.state || 'checking'}`}>
      <span className="dot" aria-hidden="true" />
      {session ? labels[session.state] : 'Checking connection'}
    </span>
  );
}

const roles: Record<(typeof providers)[number], string> = {
  igpsport: 'Ride source',
  garmin: 'Destination',
};

export function Home() {
  const app = useApp();
  const { status } = app;
  const missing = app.missing;
  const connected = app.connectedCount;

  return (
    <>
      <div className="page-head">
        <h1>Your ride connections.</h1>
        <AsyncButton
          busy={app.checking}
          busyLabel="Checking…"
          className="secondary"
          disabled={app.checking || app.busy}
          onClick={app.checkConnections}
        >
          {app.checking ? 'Checking…' : 'Check connections'}
        </AsyncButton>
      </div>

      <section className="connections-section" aria-labelledby="connections-title">
        <div className="section-head">
          <h2 id="connections-title">Your connections</h2>
          <span>{app.checking ? 'Checking sessions' : `${connected} of 2 connected`}</span>
        </div>
        <div className="connection-grid">
          {providers.map((provider) => {
            const session = status?.sessions[provider];
            const state = session?.state || 'checking';
            return (
              <article className={`connection-card ${state}`} key={provider}>
                <div className="connection-name">
                  <h3 className="provider-heading">
                    <ProviderLogo provider={provider} />
                    {names[provider]}
                  </h3>
                  <p className="connection-meta">
                    <span>{roles[provider]}</span>
                    <ConnectionState session={session} />
                  </p>
                </div>
                <div className="connection-actions">
                  <AsyncButton
                    busy={app.checking}
                    busyLabel="Checking…"
                    className={state === 'connected' ? 'primary' : 'secondary'}
                    disabled={app.checking || app.busy || state === 'unavailable'}
                    onClick={() => app.homeAction(provider)}
                  >
                    {state === 'connected'
                      ? 'View activities'
                      : state === 'error'
                        ? 'Retry connection'
                        : 'Connect account'}
                  </AsyncButton>
                  {state === 'connected' && (
                    <button className="text-button" onClick={() => app.setDisconnect(provider)}>
                      Disconnect
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {status && !app.checking && missing.length > 0 && (
        <p className="status-line" role="status">
          {missing.length === 2
            ? 'Connect both accounts to transfer rides.'
            : `Connect ${names[missing[0]]} to keep transferring.`}
        </p>
      )}

      <p className="howto-hint">
        First time here?
        <button className="text-button" onClick={app.openHelp}>
          See how it works
        </button>
      </p>

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
                    busy={app.busy}
                    busyLabel="Checking Garmin…"
                    className="secondary"
                    disabled={app.busy}
                    onClick={() => app.checkStatusAgain(h.sourceId, h.title)}
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
            <button className="text-button" onClick={() => app.navigate('igpsport')}>
              Browse iGPSPORT activities →
            </button>
          </div>
        )}
      </section>

      <footer>
        <span>No automatic syncing. You're in control.</span>
        <span>iGPSPORT Hub v{app.version} · Unofficial integration</span>
      </footer>
    </>
  );
}
