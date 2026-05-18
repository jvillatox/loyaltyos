import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle, Download, Globe, LogOut, Mail, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchApi, postApi } from "../lib/api-client";
import { clearSession, getSession, isAuthenticated, sendMagicLink } from "../lib/auth";
import { applyTheme } from "../lib/theme";
import type { MemberProfile } from "../types";

export default function Profile() {
  const { t, i18n } = useTranslation();
  const authed = isAuthenticated();
  const session = getSession();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | "auto">(
    () => (sessionStorage.getItem("theme") as "light" | "dark" | "auto" | null) ?? "auto",
  );

  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchApi<MemberProfile>("/members/me"),
    enabled: authed,
  });

  const magicLinkMutation = useMutation({
    mutationFn: () => sendMagicLink(email, i18n.language),
    onSuccess: () => {
      setSent(true);
    },
  });

  const gdprExportMutation = useMutation({
    mutationFn: () => postApi<{ downloadUrl: string }>("/members/me/gdpr-export", {}),
    onSuccess: (data) => {
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
    },
  });

  const handleThemeChange = (mode: "light" | "dark" | "auto") => {
    setTheme(mode);
    sessionStorage.setItem("theme", mode);
    const accentColor = sessionStorage.getItem("accent-color") ?? "#7c3aed";
    applyTheme(accentColor, mode);
  };

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  const handleLanguageChange = (lng: string) => {
    void i18n.changeLanguage(lng);
    sessionStorage.setItem("locale", lng);
  };

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("profile")}</h1>

      {!authed ? (
        <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
          <h2 className="text-lg font-semibold">{t("login")}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email) magicLinkMutation.mutate();
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="text-sm font-medium">{t("email")}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              />
            </label>
            <button
              type="submit"
              disabled={magicLinkMutation.isPending || !email}
              className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              <Mail className="mr-2 inline h-4 w-4" />
              {t("sendLink")}
            </button>
          </form>
          {sent && (
            <div
              className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
              role="alert"
            >
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{t("checkEmail")}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
            <h2 className="text-lg font-semibold">
              {profile.data
                ? `${profile.data.firstName ?? ""} ${profile.data.lastName ?? ""}`.trim() ||
                  profile.data.email
                : "..."}
            </h2>
            {profile.data && (
              <dl className="mt-3 space-y-1 text-sm text-[var(--color-text-secondary)]">
                {profile.data.email && (
                  <div className="flex justify-between">
                    <dt>{t("email")}</dt>
                    <dd>{profile.data.email}</dd>
                  </div>
                )}
                {profile.data.phone && (
                  <div className="flex justify-between">
                    <dt>Phone</dt>
                    <dd>{profile.data.phone}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>ID</dt>
                  <dd className="font-mono text-xs">{session?.memberId}</dd>
                </div>
              </dl>
            )}
            <button
              onClick={handleLogout}
              className="mt-4 flex items-center gap-2 text-sm font-medium text-red-500 transition-colors hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              {t("logout")}
            </button>
          </div>

          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
            <button
              onClick={() => {
                gdprExportMutation.mutate();
              }}
              disabled={gdprExportMutation.isPending}
              className="flex w-full items-center gap-3 text-sm font-medium"
            >
              <Download className="h-5 w-5 text-[var(--color-text-secondary)]" />
              <span>{t("gdprExport")}</span>
              {gdprExportMutation.isPending && (
                <span className="ml-auto text-xs text-[var(--color-text-secondary)]">...</span>
              )}
            </button>
          </div>
        </>
      )}

      <section aria-labelledby="preferences-heading" className="space-y-4">
        <h2 id="preferences-heading" className="text-lg font-semibold">
          {t("preferences")}
        </h2>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-[var(--color-text-secondary)]" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium">{t("language")}</span>
            <select
              value={i18n.language}
              onChange={(e) => {
                handleLanguageChange(e.target.value);
              }}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
              aria-label={t("language")}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-sm font-medium">{t("theme")}</span>
            <div
              className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
              role="radiogroup"
              aria-label={t("theme")}
            >
              {(["light", "dark", "auto"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    handleThemeChange(m);
                  }}
                  role="radio"
                  aria-checked={theme === m}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    theme === m
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {m === "light" && <Sun className="h-3.5 w-3.5" />}
                  {m === "dark" && <Moon className="h-3.5 w-3.5" />}
                  {m === "auto" && <Sun className="h-3.5 w-3.5" />}
                  {t(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
