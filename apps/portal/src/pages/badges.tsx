import { useQuery } from "@tanstack/react-query";
import { Award, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchApi } from "../lib/api-client";
import type { BadgeProgress } from "../types";

export default function Badges() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "unlocked" | "locked">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["badges"],
    queryFn: () => fetchApi<BadgeProgress[]>("/members/me/badges"),
  });

  const badges = data ?? [];
  const filtered = badges.filter((b) => {
    if (filter === "unlocked") return b.unlocked;
    if (filter === "locked") return !b.unlocked;
    return true;
  });

  const unlockedCount = badges.filter((b) => b.unlocked).length;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold">{t("badges")}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {unlockedCount} / {badges.length} {t("unlocked").toLowerCase()}
        </p>
      </div>

      <div className="flex gap-2" role="group" aria-label={t("filterAll")}>
        {(
          [
            ["all", t("filterAll")],
            ["unlocked", t("unlocked")],
            ["locked", t("locked")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setFilter(key);
            }}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              filter === key
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Award className="mx-auto h-12 w-12" aria-hidden="true" />
          <p className="mt-2">{t("noBadges")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((bp) => (
            <div
              key={bp.badge.id}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-shadow hover:shadow-md ${
                bp.unlocked
                  ? "border-[var(--color-primary)] bg-[var(--color-surface-secondary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-secondary)] opacity-60"
              }`}
            >
              {bp.badge.imageUrl ? (
                <img
                  src={bp.badge.imageUrl}
                  alt={bp.badge.name}
                  className={`h-14 w-14 rounded-full object-cover ${bp.unlocked ? "" : "grayscale"}`}
                />
              ) : bp.unlocked ? (
                <Award className="h-14 w-14 text-[var(--color-primary)]" aria-hidden="true" />
              ) : (
                <Lock className="h-14 w-14 text-[var(--color-text-secondary)]" aria-hidden="true" />
              )}
              <p className="text-xs font-semibold leading-tight">{bp.badge.name}</p>
              {bp.unlocked && bp.unlockedAt && (
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {new Date(bp.unlockedAt).toLocaleDateString()}
                </p>
              )}
              {!bp.unlocked && bp.targetValue > 0 && (
                <div className="w-full">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-primary)]"
                      style={{
                        width: `${String(Math.min((bp.currentValue / bp.targetValue) * 100, 100))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {bp.currentValue}/{bp.targetValue}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
