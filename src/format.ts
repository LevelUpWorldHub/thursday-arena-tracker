const PT = "America/Los_Angeles";

export function formatPt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    month: "short",
    day: "numeric",
  }).format(date);
  return `${time} PT, ${day}`;
}

export function formatPtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export function formatWinPct(wins: number, losses: number, draws: number): string {
  const games = wins + losses + draws;
  if (!Number.isFinite(games) || games <= 0) return "—";
  return `${((100 * wins) / games).toFixed(1)}%`;
}

export function formatSpan(hours: number): string {
  const rounded = Math.max(0, Math.round(hours));
  if (rounded < 48) return `${rounded} hour${rounded === 1 ? "" : "s"}`;
  const days = Math.floor(rounded / 24);
  const rest = rounded % 24;
  if (rest === 0) return `${days} days`;
  return `${days} days ${rest} hours`;
}

export function formatAvg(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

export function xProfileUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle)}`;
}

export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
