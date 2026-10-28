import { AsyncButton, Spinner } from '../components';
import { CompareIcon } from '../icons';
import { useApp } from '../app-context';
import { dateLabel, duration, metric, names } from '../format';
import { distanceGap, dayGap, minuteGap } from '../compare';

const providers = ['igpsport', 'garmin'] as const;

export function ComparePage() {
  const app = useApp();
  const status = app.status;
  const connected = status
    ? providers.filter((p) => status.sessions[p].state === 'connected').length
    : 0;
  const missing = status ? providers.filter((p) => status.sessions[p].state !== 'connected') : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare your rides.</h1>
          <p className="subtitle">
            See which iGPSPORT rides are missing from Garmin, and which are probably already there.
          </p>
        </div>
      </div>

      {!status || connected < 2 ? (
        <div className="empty connect-empty">
          <span className="provider-mark" aria-hidden="true">
            <CompareIcon />
          </span>
          <h2>
            {connected === 0
              ? 'Connect both accounts to start comparing.'
              : `Connect ${names[missing[0]]} to start comparing.`}
          </h2>
          <p>
            {connected === 0
              ? 'The comparison lines up rides from both lists by date, distance and time.'
              : `${names[providers.find((p) => status!.sessions[p].state === 'connected')!]} is connected. The comparison reads rides from both lists.`}
          </p>
          {app.status && missing.length > 0 && (
            <div className="connect-actions">
              {missing.map((provider) => (
                <button
                  key={provider}
                  className="primary"
                  disabled={app.status!.sessions[provider].state === 'unavailable'}
                  onClick={() =>
                    app.status!.sessions[provider].state === 'error'
                      ? void app.refreshStatus()
                      : app.openLogin(provider)
                  }
                >
                  {app.status!.sessions[provider].state === 'error'
                    ? `Retry ${names[provider]}`
                    : `Connect ${names[provider]}`}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : app.compareLoading && !app.compare ? (
        <div className="empty" role="status">
          <Spinner />
          <p>Reading both activity lists…</p>
        </div>
      ) : app.compare ? (
        <>
          <div className="compare-bar">
            <span>
              {app.compare.igpTotal} iGPSPORT rides · {app.compare.garminTotal} Garmin rides
              compared · read{' '}
              {new Date(app.compare.fetchedAt).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {app.compare.capped ? ' · newest 5 pages' : ''}
            </span>
            <AsyncButton
              busy={app.compareLoading}
              busyLabel="Comparing…"
              className="secondary slim"
              disabled={app.compareLoading || app.busy}
              onClick={app.loadCompare}
            >
              {app.compareLoading ? 'Comparing…' : '↻ Compare again'}
            </AsyncButton>
          </div>

          <section className="compare-section" aria-labelledby="fresh-title">
            <div className="section-head">
              <h2 id="fresh-title">Not yet seen in Garmin</h2>
              <span>{app.compare.fresh.length} rides</span>
            </div>
            {!app.compare.fresh.length ? (
              <div className="empty">
                <h3>All caught up</h3>
                <p>
                  None of the compared iGPSPORT rides stand alone. Check back after new rides
                  import.
                </p>
              </div>
            ) : (
              <div className="compare-grid">
                {app.compare.fresh.map((activity) => (
                  <article className="compare-card" key={activity.id}>
                    <strong className="ride-name">{activity.title}</strong>
                    <span className="ride-meta">
                      {dateLabel(activity)} · {metric(activity.distanceMeters, 0.001, 2)} km ·{' '}
                      {duration(activity)}
                    </span>
                    <button
                      className="primary"
                      disabled={app.busy || !app.status?.capabilities.transfer}
                      onClick={() => app.prepare([activity])}
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
              <span>
                {app.compare.pairs.length} {app.compare.pairs.length === 1 ? 'match' : 'matches'}
              </span>
            </div>
            {!app.compare.pairs.length ? (
              <div className="empty">
                <h3>No close matches</h3>
                <p>
                  Nothing in Garmin Connect lines up with the remaining rides on date, distance and
                  time.
                </p>
              </div>
            ) : (
              <div className="compare-grid">
                {app.compare.pairs.map((pair) => (
                  <article className="compare-pair" key={pair.igp.id}>
                    <div className="match-side">
                      <span className="match-side-label">iGPSPORT</span>
                      <strong>{pair.igp.title}</strong>
                      <span>
                        {dateLabel(pair.igp)} · {metric(pair.igp.distanceMeters, 0.001, 2)} km ·{' '}
                        {duration(pair.igp)}
                      </span>
                    </div>
                    <span className="match-eq" aria-hidden="true">
                      ≈
                    </span>
                    <div className="match-side">
                      <span className="match-side-label">Garmin</span>
                      <strong>{pair.garmin.title}</strong>
                      <span>
                        {dateLabel(pair.garmin)} · {metric(pair.garmin.distanceMeters, 0.001, 2)} km
                        · {duration(pair.garmin)}
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
              Suggestions read date, distance and time only. A matched pair is not proof: open the
              ride in Garmin Connect to be sure before you skip it.
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
