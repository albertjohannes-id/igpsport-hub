import type { ButtonHTMLAttributes } from 'react';
import type { Provider } from './api';

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function AsyncButton({
  busy = false,
  busyLabel = 'Working…',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string }) {
  return (
    <button {...props} type={type} disabled={disabled || busy} aria-busy={busy}>
      {busy && <Spinner />}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export function ProviderLogo({ provider }: { provider: Provider }) {
  return (
    <img
      className="provider-logo"
      src={`/providers/${provider === 'igpsport' ? 'igpsport.ico' : 'garmin.png'}`}
      width="24"
      height="24"
      alt=""
      aria-hidden="true"
    />
  );
}
