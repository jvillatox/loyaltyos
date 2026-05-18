export type ThemeMode = "light" | "dark" | "auto";

export function applyTheme(accentColor: string, mode: ThemeMode = "auto"): void {
  const isDark =
    mode === "dark" ||
    (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  root.style.setProperty("--color-primary", accentColor);
  root.style.setProperty("--color-text", isDark ? "#f1f5f9" : "#0f172a");
  root.style.setProperty("--color-text-secondary", isDark ? "#94a3b8" : "#64748b");
  root.style.setProperty("--color-surface", isDark ? "#0f172a" : "#ffffff");
  root.style.setProperty("--color-surface-secondary", isDark ? "#1e293b" : "#f8fafc");
  root.style.setProperty("--color-border", isDark ? "#334155" : "#e2e8f0");
  root.setAttribute("data-theme", isDark ? "dark" : "light");
}

export function loadProgramConfig(): { accentColor: string; locale: string; theme: ThemeMode } {
  return {
    accentColor: sessionStorage.getItem("accent-color") ?? "#7c3aed",
    locale: sessionStorage.getItem("locale") ?? "en",
    theme: (sessionStorage.getItem("theme") as ThemeMode | null) ?? "auto",
  };
}
