import { useRef, useState } from 'react';
import type { Provider } from './api';
import { forgetAccount, recentAccounts } from './recent-accounts';

export function AccountField({
  provider,
  value,
  onChange,
}: {
  provider: Provider;
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState(() => recentAccounts(provider));
  const [open, setOpen] = useState(false);
  const matches = accounts.filter((account) => account.toLowerCase().includes(value.toLowerCase()));
  function refresh() {
    setAccounts(recentAccounts(provider));
    setOpen(true);
  }
  return (
    <div
      className="recent-account-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open && accounts.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <label>
        Email or username
        <input
          ref={input}
          autoFocus
          autoComplete="username"
          value={value}
          required
          aria-expanded={open && accounts.length > 0}
          aria-controls="recent-accounts"
          onFocus={refresh}
          onClick={refresh}
          onChange={(event) => {
            onChange(event.target.value);
            refresh();
          }}
        />
      </label>
      {open && accounts.length > 0 && (
        <div
          id="recent-accounts"
          className="recent-account-list"
          role="group"
          aria-label="Recent accounts"
        >
          <span className="form-note">Recent accounts</span>
          {matches.map((account) => (
            <div className="recent-account-row" key={account}>
              <button
                type="button"
                className="recent-account-choice"
                onClick={() => {
                  onChange(account);
                  input.current?.focus();
                  setOpen(false);
                }}
              >
                {account}
              </button>
              <button
                type="button"
                aria-label={`Forget ${account}`}
                onClick={() => {
                  forgetAccount(provider, account);
                  input.current?.focus();
                  setAccounts(recentAccounts(provider));
                }}
              >
                ×
              </button>
            </div>
          ))}
          {matches.length === 0 && (
            <p className="form-note">
              No matching recent accounts. Keep typing to use another account.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              forgetAccount(provider);
              input.current?.focus();
              setAccounts([]);
              setOpen(false);
            }}
          >
            Clear recent accounts
          </button>
        </div>
      )}
    </div>
  );
}
