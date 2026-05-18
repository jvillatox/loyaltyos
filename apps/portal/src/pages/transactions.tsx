import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Filter, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchApi } from "../lib/api-client";
import type { PaginatedResponse, PointTransaction } from "../types";

const typeIcons: Record<string, React.ElementType> = {
  EARN: ArrowUp,
  REDEEM: ArrowDown,
  ADJUST: Filter,
  REVERSE: RotateCcw,
  EXPIRE: XCircle,
};

const typeColors: Record<string, string> = {
  EARN: "text-green-500",
  REDEEM: "text-red-500",
  ADJUST: "text-blue-500",
  REVERSE: "text-amber-500",
  EXPIRE: "text-slate-400",
};

export default function Transactions() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () =>
      fetchApi<PaginatedResponse<PointTransaction>>(
        `/members/me/transactions?page=1&pageSize=50${filter && filter !== "ALL" ? `&type=${filter}` : ""}`,
      ),
  });

  const transactions = data?.items ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("transactions")}</h1>

      <div className="flex gap-2 overflow-x-auto" role="group" aria-label={t("filterAll")}>
        {["", "EARN", "REDEEM", "ADJUST", "REVERSE", "EXPIRE"].map((type) => (
          <button
            key={type}
            onClick={() => {
              setFilter(type);
            }}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === type
                ? "bg-[var(--color-primary)] text-white"
                : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)]"
            }`}
          >
            {type === "" ? t("filterAll") : type}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"
            />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <p>{t("noTransactions")}</p>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {transactions.map((tx) => {
            const Icon = typeIcons[tx.type] ?? Filter;
            const sign = tx.type === "EARN" || tx.type === "ADJUST" ? "+" : "-";
            return (
              <li
                key={tx.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-4 py-3"
              >
                <div
                  className={`rounded-full p-1.5 ${typeColors[tx.type] ?? "text-slate-400"} bg-opacity-10`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{tx.source}</p>
                  {tx.description && (
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">
                      {tx.description}
                    </p>
                  )}
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {new Date(tx.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${sign === "+" ? "text-green-500" : ""}`}>
                    {sign}
                    {Math.abs(tx.amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {tx.balanceAfter.toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
