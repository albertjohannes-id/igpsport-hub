import { useEffect, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AsyncButton, Spinner } from './components';
import { EyeIcon, EyeOffIcon } from './icons';
import { useApp } from './app-context';
import { dateLabel, duration, durationLabel, eligible, metric, names } from './format';

function Modal({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
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

export function Modals() {
  const app = useApp();

  return (
    <>
      {app.login && (
        <Modal
          title={app.loginMfa ? 'Verify your Garmin account' : `Connect ${names[app.login]}`}
          onClose={app.closeLogin}
          busy={app.loginBusy}
        >
          <p className="dialog-intro">
            {app.loginMfa
              ? 'Enter the verification code Garmin sent you.'
              : 'Use your existing account. Your session is remembered in this browser; your password is not saved.'}
          </p>
          <form onSubmit={(e) => void app.submitLogin(e)}>
            {app.loginError && (
              <div className="alert" role="alert">
                {app.loginError}
              </div>
            )}
            {app.loginMfa ? (
              <label>
                Verification code
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={app.code}
                  onChange={(e) => app.setCode(e.target.value)}
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
                    value={app.username}
                    onChange={(e) => app.setUsername(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <span className="password-field">
                    <input
                      aria-label="Password"
                      type={app.showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={app.password}
                      onChange={(e) => app.setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => app.setShowPassword(!app.showPassword)}
                      aria-label={app.showPassword ? 'Hide password' : 'Show password'}
                    >
                      {app.showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </span>
                </label>
              </>
            )}
            <p className="form-note">
              Unofficial connection. Your password is sent only to {names[app.login]}, never stored.
            </p>
            <AsyncButton
              type="submit"
              busy={app.loginBusy}
              busyLabel="Connecting…"
              className="primary full"
              disabled={app.loginBusy}
            >
              {app.loginBusy ? 'Connecting…' : app.loginMfa ? 'Verify account' : 'Connect account'}
            </AsyncButton>
            {app.loginBusy && (
              <p role="status">This may take several seconds. Please keep this window open.</p>
            )}
          </form>
        </Modal>
      )}

      {app.detail && (
        <Modal title={app.detail.title} onClose={app.closeDetail} busy={app.busy}>
          <p className="dialog-intro">
            {dateLabel(app.detail)} · {names[app.detail.provider]}
          </p>
          {app.detailBusy && (
            <p className="loading-label" role="status">
              <Spinner />
              Loading activity details…
            </p>
          )}
          {app.detailError && (
            <div className="alert" role="alert">
              {app.detailError}
            </div>
          )}
          <dl className="detail-metrics">
            <div>
              <dt>Distance</dt>
              <dd>
                {metric(app.detail.distanceMeters, 0.001, 2)} <small>km</small>
              </dd>
            </div>
            <div>
              <dt>{durationLabel(app.detail)}</dt>
              <dd>{duration(app.detail)}</dd>
            </div>
            <div>
              <dt>Average speed</dt>
              <dd>
                {metric(app.detail.averageSpeedMps, 3.6)} <small>km/h</small>
              </dd>
            </div>
            <div>
              <dt>Ascent</dt>
              <dd>
                {metric(app.detail.ascentMeters, 1, 0)} <small>m</small>
              </dd>
            </div>
            {[
              ['Max speed', app.detail.maxSpeedMps, 3.6, 'km/h'],
              ['Avg heart rate', app.detail.averageHeartRateBpm, 1, 'bpm'],
              ['Max heart rate', app.detail.maxHeartRateBpm, 1, 'bpm'],
              ['Avg cadence', app.detail.averageCadenceRpm, 1, 'rpm'],
              ['Max cadence', app.detail.maxCadenceRpm, 1, 'rpm'],
              ['Energy', app.detail.caloriesKcal, 1, 'kcal'],
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
            {app.detail.elapsedSeconds != null && (
              <div>
                <dt>Elapsed time</dt>
                <dd>{duration({ ...app.detail, movingSeconds: null, timerSeconds: null })}</dd>
              </div>
            )}
          </dl>
          <p className="form-note">Unavailable measurements are shown as a dash.</p>
          {app.detail.provider === 'igpsport' ? (
            <>
              <p className="detail-note">
                The original FIT file is transferred. Your iGPSPORT activity stays in place.
              </p>
              {['received', 'unconfirmed'].includes(app.detail.syncStatus) ? (
                <AsyncButton
                  busy={app.busy}
                  busyLabel="Checking Garmin…"
                  className="primary full"
                  disabled={app.busy}
                  onClick={() => {
                    const activity = app.detail;
                    app.closeDetail();
                    if (activity) app.checkTransfer(activity);
                  }}
                >
                  Check Garmin status
                </AsyncButton>
              ) : (
                <button
                  className="primary full"
                  disabled={
                    app.busy ||
                    app.detailBusy ||
                    !eligible(app.detail) ||
                    !app.status?.capabilities.transfer
                  }
                  onClick={() => {
                    if (app.detail) app.prepare([app.detail]);
                  }}
                >
                  {eligible(app.detail) ? 'Send to Garmin' : 'Already synced'}
                </button>
              )}
            </>
          ) : (
            <>
              <a
                className="primary full button-link"
                href={`https://connect.garmin.com/modern/activity/${app.detail.id}`}
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

      {app.confirm.length > 0 && (
        <Modal
          title={`Send ${app.confirm.length === 1 ? 'this ride' : `${app.confirm.length} rides`} to Garmin?`}
          onClose={() => app.setConfirm([])}
          busy={app.busy}
        >
          <p className="dialog-intro">{app.confirm.map((a) => a.title).join(', ')}</p>
          <p>
            We’ll check for existing activities, transfer each original FIT file, then verify the
            result in Garmin.
          </p>
          <p className="form-note">Keep the page open until verification finishes.</p>
          <div className="dialog-actions">
            <button className="secondary" disabled={app.busy} onClick={() => app.setConfirm([])}>
              Cancel
            </button>
            <AsyncButton
              busy={app.busy}
              busyLabel="Transferring and verifying…"
              className="primary"
              disabled={app.busy}
              onClick={() => app.runTransfer(app.confirm)}
            >
              {app.busy ? 'Transferring and verifying…' : 'Confirm transfer'}
            </AsyncButton>
          </div>
          {app.busy && <p role="status">{app.progress}</p>}
        </Modal>
      )}

      {app.helpOpen && (
        <Modal title="How to use iGPSPORT Hub" onClose={app.closeHelp}>
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
            <button className="primary" onClick={app.closeHelp}>
              Got it
            </button>
          </div>
        </Modal>
      )}

      {app.disconnect && (
        <Modal
          title={`Disconnect ${names[app.disconnect]}?`}
          onClose={() => app.setDisconnect(undefined)}
          busy={app.busy}
        >
          <p className="dialog-intro">
            This removes the saved session from this browser. Your activities stay in your account.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={app.busy}
              onClick={() => app.setDisconnect(undefined)}
            >
              Cancel
            </button>
            <AsyncButton
              busy={app.busy}
              busyLabel="Disconnecting…"
              className="primary"
              disabled={app.busy}
              onClick={() => void app.disconnectAccount()}
            >
              Disconnect
            </AsyncButton>
          </div>
        </Modal>
      )}
    </>
  );
}
