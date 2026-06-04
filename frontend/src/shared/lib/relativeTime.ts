// formatRelativeTime uses Intl.RelativeTimeFormat for free locale support; bucket labels via i18n

export type TimeBucket = 'today' | 'yesterday' | 'last7' | 'last30' | 'older';

export function formatRelativeTime(iso: string, locale?: string, now = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSec = Math.round((ts - now) / 1000); // negative = past

  const abs = Math.abs(diffSec);
  if (abs < 45) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHr = Math.round(diffSec / 3600);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  const diffDay = Math.round(diffSec / 86400);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');
  const diffMonth = Math.round(diffDay / 30);
  // <= 12: round(days/30) hits 12 at ~345 days, so `< 12` mislabeled ~346–364 days as "1 year ago".
  if (Math.abs(diffMonth) <= 12) return rtf.format(diffMonth, 'month');
  return rtf.format(Math.round(diffDay / 365), 'year');
}

export function timeBucket(iso: string, now = new Date()): TimeBucket {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (ts >= startOfToday) return 'today';
  if (ts >= startOfToday - dayMs) return 'yesterday';
  if (ts >= startOfToday - 7 * dayMs) return 'last7';
  if (ts >= startOfToday - 30 * dayMs) return 'last30';
  return 'older';
}
