/**
 * Format a date according to the given locale.
 */
export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    ...options,
  }).format(d);
}

/**
 * Format a date as relative time (e.g., "3 days ago", "hace 3 días").
 * Uses Intl.RelativeTimeFormat under the hood.
 */
export function formatRelativeDate(date: Date | string, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  const diffMonth = Math.round(diffDay / 30);
  const diffYear = Math.round(diffDay / 365);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffYear) >= 1) return rtf.format(diffYear, "year");
  if (Math.abs(diffMonth) >= 1) return rtf.format(diffMonth, "month");
  if (Math.abs(diffDay) >= 1) return rtf.format(diffDay, "day");
  if (Math.abs(diffHr) >= 1) return rtf.format(diffHr, "hour");
  if (Math.abs(diffMin) >= 1) return rtf.format(diffMin, "minute");
  return rtf.format(diffSec, "second");
}

/**
 * Format a currency amount according to locale conventions.
 */
export function formatCurrency(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a number according to locale conventions.
 */
export function formatNumber(
  n: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(n);
}

/**
 * Format loyalty points with thousand separators and "pts" suffix.
 */
export function formatPoints(n: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale).format(n);
  const suffix = locale === "es-MX" ? " pts" : " pts";
  return `${formatted}${suffix}`;
}
