import type { ExpiryMode } from "@prisma/client";

/**
 * Adds `months` calendar months to `date`, clamping to the last day of the
 * target month when the source day does not exist there (e.g. Jan 31 + 1 month
 * -> Feb 28/29), matching PostgreSQL `date + interval '1 month'`.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== day) {
    result.setDate(0);
  }
  return result;
}

/**
 * Expiry timestamp for a newly-created lot under a program's expiry rule:
 * PER_LOT points expire `months` after `base`; NONE and INACTIVITY never set a
 * per-lot expiry (inactivity is handled at the account level instead).
 */
export function lotExpiresAt(mode: ExpiryMode, months: number, base: Date): Date | null {
  return mode === "PER_LOT" ? addMonths(base, months) : null;
}
