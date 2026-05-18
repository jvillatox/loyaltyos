export function formatPoints(n: number, locale = "en"): string {
  return n.toLocaleString(locale === "es" ? "es-ES" : "en-US");
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
