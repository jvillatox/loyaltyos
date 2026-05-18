import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Gift, ShoppingCart, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { fetchApi, postApi } from "../lib/api-client";
import type { RedeemResult, RewardDetail as RewardDetailType } from "../types";

export default function RewardDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reward", id ?? ""],
    queryFn: () => fetchApi<RewardDetailType>(`/rewards/${id ?? ""}`),
  });

  const redeemMutation = useMutation({
    mutationFn: () => postApi<RedeemResult>(`/rewards/${id ?? ""}/redeem`, {}),
    onSuccess: () => {
      setResult({ success: true, message: t("redeemSuccess") });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
      window.dispatchEvent(new CustomEvent("loyaltyos:balance-updated"));
    },
    onError: () => {
      setResult({ success: false, message: t("redeemError") });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <div className="h-64 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 text-center">
        <p>{t("noRewards")}</p>
      </div>
    );
  }

  const canRedeem = data.eligible !== false && (data.stock === null || data.stock > 0);

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <button
        onClick={() => {
          navigate(-1);
        }}
        className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)]"
        aria-label={t("cancel")}
      >
        <X className="h-4 w-4" />
        {t("cancel")}
      </button>

      {data.imageUrl ? (
        <img src={data.imageUrl} alt={data.name} className="h-56 w-full rounded-2xl object-cover" />
      ) : (
        <div className="flex h-56 w-full items-center justify-center rounded-2xl bg-[var(--color-surface-secondary)]">
          <Gift className="h-16 w-16 text-[var(--color-text-secondary)]" aria-hidden="true" />
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold">{data.name}</h1>
        <p className="mt-1 text-lg font-semibold text-[var(--color-primary)]">
          {data.pointsCost.toLocaleString()} {t("pointsCost")}
        </p>
      </div>

      {data.description && (
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {data.description}
        </p>
      )}

      {data.stock !== null && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          {data.stock > 0 ? `${t("available")}: ${String(data.stock)}` : t("outOfStock")}
        </p>
      )}

      {data.reason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{data.reason}</p>
        </div>
      )}

      {result && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            result.success
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="alert"
        >
          {result.success ? (
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>{result.message}</p>
        </div>
      )}

      {!showConfirm ? (
        <button
          onClick={() => {
            setShowConfirm(true);
          }}
          disabled={!canRedeem}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-6 py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          <ShoppingCart className="h-5 w-5" />
          {canRedeem ? t("redeem") : t("locked")}
        </button>
      ) : (
        <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
          <p className="text-center text-sm font-medium">{t("redeemConfirm")}</p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowConfirm(false);
              }}
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium"
            >
              {t("cancel")}
            </button>
            <button
              onClick={() => {
                redeemMutation.mutate();
                setShowConfirm(false);
              }}
              disabled={redeemMutation.isPending}
              className="flex-1 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              {redeemMutation.isPending ? "..." : t("confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
