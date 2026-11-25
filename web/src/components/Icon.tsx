const shapes = {
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  home: <path d="m3 11 9-7 9 7M5 10v10h5v-5h4v5h5V10"/>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 5a3 3 0 0 1 0 6m2 3a4 4 0 0 1 3 4v2"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></>,
  trophy: <path d="M8 21h8m-4-4v4M7 4h10v6a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>,
  daily: <><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  key: <><circle cx="8" cy="10" r="4"/><path d="m11 13 7 7 3-3-2-2-2 2m-1-5-2 2"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  sliders: <path d="M4 6h7m4 0h5M4 12h3m4 0h9M4 18h11m4 0h1M11 4v4m-4 2v4m8 2v4"/>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></>,
  mute: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 10 4 4m0-4-4 4"/></>,
  undo: <path d="M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 0 10h-2"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
} as const

export default function Icon({ name }: { name: keyof typeof shapes }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>
}
