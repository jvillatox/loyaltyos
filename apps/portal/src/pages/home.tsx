import { useQuery } from "@tanstack/react-query";
import { Award, ChevronRight, Gift, Star, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { fetchApi } from "../lib/api-client";
import { isAuthenticated } from "../lib/auth";
import type { BadgeProgress, Balance, Reward, TierStatus } from "../types";

function BalanceCard({ balance }: { balance: Balance }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-[var(--color-primary)] p-6 text-white shadow-lg">
      <p className="text-sm font-medium opacity-80">{t("balance")}</p>
      <p className="mt-1 text-4xl font-bold">{balance.total.toLocaleString()}</p>
      <div className="mt-3 flex gap-4 text-xs opacity-75">
        <span>
          {t("confirmed")}: {balance.confirmed.toLocaleString()}
        </span>
        <span>
          {t("pending")}: {balance.pending.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function TierCard({ tier }: { tier: TierStatus }) {
  const { t } = useTranslation();
  if (!tier.currentTier) return null;
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">{t("yourTier")}</p>
          <p className="mt-1 text-xl font-bold">{tier.currentTier.name}</p>
        </div>
        {tier.currentTier.color && (
          <div
            className="h-10 w-10 rounded-full"
            style={{ backgroundColor: tier.currentTier.color }}
            aria-hidden="true"
          />
        )}
      </div>
      {tier.nextTier ? (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
            <span>{t("progress")}</span>
            <span>
              {tier.pointsProgress.toLocaleString()} / {tier.nextTier.minPoints.toLocaleString()}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-all"
              style={{
                width: `${String(Math.min((tier.pointsProgress / tier.nextTier.minPoints) * 100, 100))}%`,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {tier.pointsToNext?.toLocaleString()} {t("pointsToNext")}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{t("maxTier")}</p>
      )}
    </div>
  );
}

function TopRewards({ rewards }: { rewards: Reward[] }) {
  const { t } = useTranslation();
  if (rewards.length === 0) return null;
  return (
    <section aria-labelledby="top-rewards-heading">
      <div className="flex items-center justify-between">
        <h2 id="top-rewards-heading" className="text-lg font-semibold">
          {t("rewardsCatalog")}
        </h2>
        <Link to="/rewards" className="flex items-center gap-1 text-sm text-[var(--color-primary)]">
          {t("viewDetails")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {rewards.slice(0, 3).map((r) => (
          <Link
            key={r.id}
            to={`/rewards/${r.id}`}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 transition-shadow hover:shadow-md"
          >
            {r.imageUrl ? (
              <img src={r.imageUrl} alt="" className="mx-auto h-14 w-14 rounded-lg object-cover" />
            ) : (
              <Gift
                className="mx-auto h-14 w-14 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
            )}
            <p className="mt-2 truncate text-center text-xs font-medium">{r.name}</p>
            <p className="text-center text-xs text-[var(--color-text-secondary)]">
              {r.pointsCost} {t("pointsCost")}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function BadgePreview({ badges }: { badges: BadgeProgress[] }) {
  const { t } = useTranslation();
  const unlocked = badges.filter((b) => b.unlocked);
  if (unlocked.length === 0) return null;
  return (
    <section aria-labelledby="badges-preview-heading">
      <div className="flex items-center justify-between">
        <h2 id="badges-preview-heading" className="text-lg font-semibold">
          {t("badges")}
        </h2>
        <Link to="/badges" className="flex items-center gap-1 text-sm text-[var(--color-primary)]">
          {t("viewDetails")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {unlocked.slice(0, 6).map((b) => (
          <div
            key={b.badge.id}
            className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3"
            style={{ width: 80 }}
          >
            {b.badge.imageUrl ? (
              <img
                src={b.badge.imageUrl}
                alt={b.badge.name}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <Award className="h-10 w-10 text-[var(--color-primary)]" aria-hidden="true" />
            )}
            <span className="text-center text-xs font-medium leading-tight">{b.badge.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const authed = isAuthenticated();

  const balance = useQuery({
    queryKey: ["balance"],
    queryFn: () => fetchApi<Balance>("/members/me/balance"),
    enabled: authed,
  });

  const tier = useQuery({
    queryKey: ["tier"],
    queryFn: () => fetchApi<TierStatus>("/members/me/tier"),
    enabled: authed,
  });

  const rewards = useQuery({
    queryKey: ["rewards", "top"],
    queryFn: () => fetchApi<Reward[]>("/rewards?isActive=true&pageSize=6&page=1"),
    select: (data) => (data as unknown as { items: Reward[] }).items,
    enabled: authed,
  });

  const badges = useQuery({
    queryKey: ["badges"],
    queryFn: () => fetchApi<BadgeProgress[]>("/members/me/badges"),
    enabled: authed,
  });

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("home")}</h1>

      {!authed ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-8 text-center">
          <Star
            className="mx-auto h-12 w-12 text-[var(--color-text-secondary)]"
            aria-hidden="true"
          />
          <p className="mt-4 text-lg font-medium">{t("login")}</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t("checkEmail")}</p>
          <Link
            to="/profile"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-6 py-3 text-sm font-semibold text-white"
          >
            <TrendingUp className="h-4 w-4" />
            {t("login")}
          </Link>
        </div>
      ) : (
        <>
          {balance.data && <BalanceCard balance={balance.data} />}
          {tier.data ? <TierCard tier={tier.data} /> : null}
          {rewards.data && rewards.data.length > 0 && <TopRewards rewards={rewards.data} />}
          {badges.data && <BadgePreview badges={badges.data} />}
        </>
      )}
    </div>
  );
}
