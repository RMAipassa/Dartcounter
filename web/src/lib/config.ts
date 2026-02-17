export function getServerUrl(): string {
  const env = process.env.NEXT_PUBLIC_SERVER_URL
  if (env && env.trim()) return env
  if (typeof window !== 'undefined') return window.location.origin
  return 'http://localhost:3001'
}
