export function formatPoints(n: number, locale = "es-MX"): string {
  return n.toLocaleString(locale === "es-MX" ? "es-MX" : "en-US");
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
