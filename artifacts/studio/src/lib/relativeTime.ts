// Coarse relative-time label (m/h/d granularity) for Landing's recent-solve
// footers. Pure + injectable `now` so it's deterministic under test.
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const min = Math.floor(Math.max(0, now - then) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
