import { useQuery } from "@tanstack/react-query";
import { Gift, Heart } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { fetchApi } from "../lib/api-client";
import type { PaginatedResponse, Reward } from "../types";

function useWishlist() {
  const read = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem("loyaltyos-wishlist") ?? "[]") as string[];
    } catch {
      return [];
    }
  };

  const toggle = (id: string) => {
    const list = read();
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    localStorage.setItem("loyaltyos-wishlist", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("loyaltyos:wishlist-updated"));
  };

  return { read, toggle };
}

export default function Rewards() {
  const { t } = useTranslation();
  const wishlist = useWishlist();
  const [category, setCategory] = useState("");
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [wishlistIds, setWishlistIds] = useState<string[]>(() => wishlist.read());

  useMemo(() => {
    const handler = () => {
      setWishlistIds(wishlist.read());
    };
    window.addEventListener("loyaltyos:wishlist-updated", handler);
    return () => {
      window.removeEventListener("loyaltyos:wishlist-updated", handler);
    };
  }, [wishlist]);

  const { data, isLoading } = useQuery({
    queryKey: ["rewards", "catalog", category],
    queryFn: () =>
      fetchApi<PaginatedResponse<Reward>>(
        `/rewards?isActive=true&page=1&pageSize=50${category ? `&category=${category}` : ""}`,
      ),
  });

  const rewards = useMemo(() => {
    const items = data?.items ?? [];
    if (wishlistOnly) return items.filter((r) => wishlistIds.includes(r.id));
    return items;
  }, [data, wishlistOnly, wishlistIds]);

  const categories = useQuery({
    queryKey: ["rewards", "categories"],
    queryFn: () => fetchApi<string[]>("/rewards/categories"),
  });

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("rewardsCatalog")}</h1>
        <button
          onClick={() => {
            setWishlistOnly(!wishlistOnly);
          }}
          className={`rounded-lg p-2 transition-colors ${
            wishlistOnly
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-text-secondary)]"
          }`}
          aria-label={t("wishlist")}
        >
          <Heart className="h-5 w-5" fill={wishlistOnly ? "white" : "none"} />
        </button>
      </div>

      {categories.data && categories.data.length > 0 && (
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label={t("filterAll")}>
          <button
            onClick={() => {
              setCategory("");
            }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              category === ""
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {t("filterAll")}
          </button>
          {categories.data.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setCategory(cat);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                category === cat
                  ? "bg-[var(--color-primary)] text-white"
                  : "border border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"
            />
          ))}
        </div>
      ) : rewards.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <Gift className="mx-auto h-12 w-12" aria-hidden="true" />
          <p className="mt-2">{t("noRewards")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {rewards.map((reward) => {
            const isWishlisted = wishlistIds.includes(reward.id);
            return (
              <div
                key={reward.id}
                className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3 transition-shadow hover:shadow-md"
              >
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    wishlist.toggle(reward.id);
                  }}
                  className="absolute right-2 top-2 z-10 rounded-full bg-[var(--color-surface)] p-1 shadow-sm"
                  aria-label={isWishlisted ? t("favorites") : t("wishlist")}
                >
                  <Heart
                    className="h-4 w-4"
                    fill={isWishlisted ? "var(--color-primary)" : "none"}
                    color={isWishlisted ? "var(--color-primary)" : "currentColor"}
                  />
                </button>
                <Link to={`/rewards/${reward.id}`}>
                  {reward.imageUrl ? (
                    <img
                      src={reward.imageUrl}
                      alt=""
                      className="mx-auto h-24 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="mx-auto flex h-24 w-full items-center justify-center rounded-lg bg-[var(--color-border)]">
                      <Gift
                        className="h-10 w-10 text-[var(--color-text-secondary)]"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                  <p className="mt-2 truncate text-sm font-medium">{reward.name}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--color-primary)]">
                      {reward.pointsCost.toLocaleString()} {t("pointsCost")}
                    </span>
                    {reward.stock !== null && reward.stock <= 0 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600">
                        {t("outOfStock")}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
