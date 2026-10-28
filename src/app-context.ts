import { createContext, useContext } from 'react';
import type { FormEvent } from 'react';
import type { Activity, Provider, Status, Transfer } from './api';
import type { Compare } from './compare';

export type Tab = 'home' | 'igpsport' | 'garmin' | 'compare';

// The one state owner lives in App.tsx; pages consume this shape and stay presentational.
export interface AppState {
  version: string;
  tab: Tab;
  navigate: (tab: Tab) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;

  status?: Status;
  checking: boolean;
  refreshStatus: () => Promise<Status | undefined>;

  busy: boolean;
  progress: string;
  error: string;
  setError: (message: string) => void;
  notice: string;
  setNotice: (message: string) => void;
  result?: Transfer;
  checkStatusAgain: (sourceId: string, title: string) => void;

  checkConnections: () => void;
  connectedCount: number;
  missing: Provider[];
  openLogin: (provider: Provider) => void;
  homeAction: (provider: Provider) => void;
  setDisconnect: (provider?: Provider) => void;
  disconnect?: Provider;
  disconnectAccount: () => Promise<void>;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;

  rows: Activity[];
  loading: boolean;
  hasMore: boolean;
  query: string;
  setQuery: (value: string) => void;
  unsyncedOnly: boolean;
  setUnsyncedOnly: (value: boolean) => void;
  selected: string[];
  setSelected: (ids: string[]) => void;
  toggleSelect: (id: string, checked: boolean) => void;
  refreshActivities: () => void;
  loadOlder: () => void;
  openDetail: (activity: Activity) => void;
  prepare: (activities: Activity[]) => void;
  checkTransfer: (activity: Activity) => void;
  runTransfer: (activities: Activity[]) => void;

  compare?: Compare;
  compareLoading: boolean;
  loadCompare: () => void;

  login?: Provider;
  loginMfa: boolean;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  code: string;
  setCode: (value: string) => void;
  loginError: string;
  loginBusy: boolean;
  setLogin: (provider?: Provider) => void;
  submitLogin: (event: FormEvent) => Promise<void>;
  closeLogin: () => void;

  detail?: Activity;
  detailBusy: boolean;
  detailError: string;
  closeDetail: () => void;

  confirm: Activity[];
  setConfirm: (activities: Activity[]) => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('useApp must be used inside <App>');
  return state;
}
