// Two chrome glyphs drawn in-house: existing unicode symbols (⌂ ⇄) render
// inconsistently across platforms. Provider tabs use the real provider logos.
const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export function HomeIcon() {
  return (
    <svg {...base}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.7V20h13V9.7" />
    </svg>
  );
}

export function CompareIcon() {
  return (
    <svg {...base}>
      <path d="M20 7.5H4.5M4.5 7.5 8 4" />
      <path d="M4 16.5h15.5M19.5 16.5 16 20" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...base} width={20} height={20}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg {...base} width={20} height={20}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg {...base} width={18} height={18}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg {...base} width={18} height={18}>
      <path d="M17.9 17.9A10 10 0 0 1 12 20c-6.5 0-10-8-10-8a18.4 18.4 0 0 1 5-5.9" />
      <path d="M10 4.3A9 9 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.1 3.2" />
      <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <path d="M2 2l20 20" />
    </svg>
  );
}
