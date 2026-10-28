import { AsyncButton, ProviderLogo } from '../components';
import { useApp } from '../app-context';
import { dateLabel, duration, durationLabel, eligible, metric, names, syncLabel } from '../format';

function ConnectionState({ session }: { session?: { state: string } }) {
  const labels: Record<string, string> = {
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

export function ActivitiesPage({ tab }: { tab: 'igpsport' | 'garmin' }) {
  const app = useApp();
  const session = app.status?.sessions[tab];
  const filtered = app.rows.filter((a) =>
    `${a.title} ${a.sourceDateTime || ''}`.toLowerCase().includes(app.query.toLowerCase()),
  );
  const visible = app.unsyncedOnly ? filtered.filter(eligible) : filtered;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{tab === 'igpsport' ? 'Ride source' : 'Destination'}</p>
          <h1>Your activities</h1>
          <p className="subtitle">
            {tab === 'igpsport'
              ? 'Choose a ride. Keep the original data. Send it to Garmin.'
              : 'Browse the activities in your Garmin account.'}
          </p>
        </div>
        <div className="connection-stack">
          <p className="provider-heading">
            <ProviderLogo provider={tab} />
            {names[tab]}
          </p>
          <ConnectionState session={session} />
        </div>
      </div>

      {session?.state !== 'connected' ? (
        <div className="empty connect-empty">
          <span className={`provider-mark ${tab}`} aria-hidden="true">
            <ProviderLogo provider={tab} />
          </span>
          <h2>{session?.state === 'error' ? 'Connection unavailable' : `Connect ${names[tab]}`}</h2>
          <p>{session?.message || 'Sign in with your existing account to see your activities.'}</p>
          <AsyncButton
            busy={app.loading}
            busyLabel="Loading activities…"
            className="primary"
            disabled={!app.status?.capabilities.login || app.checking || app.loading}
            onClick={() =>
              session?.state === 'error' ? app.refreshActivities() : app.openLogin(tab)
            }
          >
            {app.loading
              ? 'Checking…'
              : session?.state === 'error'
                ? 'Retry connection'
                : 'Connect account'}
          </AsyncButton>
          {tab === 'igpsport' && <small>No iGPSPORT Hub registration needed.</small>}
        </div>
      ) : (
        <>
          {tab === 'igpsport' &&
            app.status &&
            !app.checking &&
            app.status.sessions.garmin.state !== 'connected' && (
              <div className="callout" role="status">
                <div>
                  <strong>
                    {app.status.sessions.garmin.state === 'error'
                      ? 'Garmin connection needs a check.'
                      : 'Garmin Connect isn’t connected yet.'}
                  </strong>
                  <p>
                    Connect Garmin Connect before sending rides; that’s where your selection ends
                    up.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={app.status.sessions.garmin.state === 'unavailable'}
                  onClick={() =>
                    app.status!.sessions.garmin.state === 'error'
                      ? void app.refreshStatus()
                      : app.openLogin('garmin')
                  }
                >
                  {app.status.sessions.garmin.state === 'error'
                    ? 'Check connection'
                    : 'Connect Garmin Connect'}
                </button>
              </div>
            )}

          <div className="toolbar">
            <label className="search">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m20 20-4.4-4.4" />
              </svg>
              <input
                aria-label="Search loaded activities"
                placeholder="Search rides"
                value={app.query}
                onChange={(e) => app.setQuery(e.target.value)}
              />
            </label>
            <AsyncButton
              busy={app.loading}
              busyLabel="Loading activities…"
              className="secondary"
              disabled={app.loading || app.busy}
              onClick={app.refreshActivities}
            >
              {app.loading ? 'Refreshing…' : '↻ Refresh'}
            </AsyncButton>
            {tab === 'igpsport' && (
              <button
                className="secondary"
                aria-pressed={app.unsyncedOnly}
                disabled={app.loading || app.busy}
                onClick={() => app.setUnsyncedOnly(!app.unsyncedOnly)}
              >
                Unsynced only
              </button>
            )}
          </div>

          <div className="list-meta">
            <span>
              {visible.length} {visible.length === 1 ? 'activity' : 'activities'}
              {app.query ? ' matching' : app.unsyncedOnly ? ' unsynced' : ' loaded'}
            </span>
            {tab === 'igpsport' && (
              <button
                className="text-button"
                disabled={app.loading || app.busy || !filtered.some(eligible)}
                onClick={() =>
                  app.setSelected(
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
            {session?.checkedAt && (
              <span>
                Updated{' '}
                {new Date(session.checkedAt * 1000).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            )}
            {tab === 'igpsport' && <span>Select up to 10 rides</span>}
          </div>

          {app.loading && !app.rows.length ? (
            <div className="empty" role="status">
              <span className="spinner" aria-hidden="true" />
              <p>Loading your activities…</p>
            </div>
          ) : !visible.length ? (
            <div className="empty">
              <h3>
                {app.query
                  ? 'No matching activities'
                  : app.unsyncedOnly
                    ? 'All caught up'
                    : 'No activities yet'}
              </h3>
              <p>
                {app.query
                  ? 'Try a different name or date.'
                  : app.unsyncedOnly
                    ? 'Every loaded ride is already synced or awaiting its status check.'
                    : 'Activities will appear here after they are available in your account.'}
              </p>
              {(app.query || app.unsyncedOnly) && (
                <button
                  className="secondary"
                  onClick={() => (app.query ? app.setQuery('') : app.setUnsyncedOnly(false))}
                >
                  {app.query ? 'Clear search' : 'Show all rides'}
                </button>
              )}
            </div>
          ) : (
            <div className="activity-table">
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
                        checked={app.selected.includes(activity.id)}
                        disabled={
                          app.busy ||
                          !eligible(activity) ||
                          (app.selected.length >= 10 && !app.selected.includes(activity.id))
                        }
                        onChange={(e) => app.toggleSelect(activity.id, e.target.checked)}
                      />
                    </label>
                  )}
                  <button className="ride-title" onClick={() => app.openDetail(activity)}>
                    <strong>{activity.title}</strong>
                    <span>
                      {dateLabel(activity)}
                      {activity.deviceName ? ` · ${activity.deviceName}` : ''}
                      {activity.syncStatus !== 'unknown' && (
                        <span className="compact-sync"> · {syncLabel(activity.syncStatus)}</span>
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
                  <button className="row-action" onClick={() => app.openDetail(activity)}>
                    <span className="sr-label">
                      {tab === 'igpsport' ? syncLabel(activity.syncStatus) : 'View details'}
                    </span>
                    <span className="chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                  <div className="activity-extras">
                    <span>
                      Avg speed <strong>{metric(activity.averageSpeedMps, 3.6)} km/h</strong>
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

          {app.hasMore && (
            <div className="load-more">
              <AsyncButton
                busy={app.loading}
                busyLabel="Loading activities…"
                className="secondary"
                disabled={app.loading || app.busy}
                onClick={app.loadOlder}
              >
                {app.loading ? 'Loading…' : 'Load older activities'}
              </AsyncButton>
            </div>
          )}

          {tab === 'igpsport' && app.selected.length > 0 && (
            <div className="selection-bar">
              <span>
                <strong>{app.selected.length}</strong>{' '}
                {app.selected.length === 1 ? 'ride' : 'rides'} selected
              </span>
              <button
                className="text-button"
                disabled={app.busy}
                onClick={() => app.setSelected([])}
              >
                Clear
              </button>
              <button
                className="primary"
                disabled={app.busy || !app.status?.capabilities.transfer}
                onClick={() => app.prepare(app.rows.filter((a) => app.selected.includes(a.id)))}
              >
                Send to Garmin
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
