import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Search, XCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import type { GiftCard, GiftCardTransaction, PaginatedResponse } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  depleted: "bg-slate-100 text-slate-800",
  expired: "bg-red-100 text-red-800",
  cancelled: "bg-red-100 text-red-800",
};

export function CardDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const cardCode = code ?? "";
  const queryClient = useQueryClient();
  const [searchCode, setSearchCode] = useState(code ?? "");
  const [txPage, setTxPage] = useState(1);
  const [showRedeemDialog, setShowRedeemDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState(0);
  const [redeemMemberId, setRedeemMemberId] = useState("");
  const [redeemOrderRef, setRedeemOrderRef] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: card, isLoading } = useQuery({
    queryKey: ["giftcard-detail", code],
    queryFn: () =>
      fetchApi<GiftCard>("/admin/giftcards/lookup", {
        method: "POST",
        body: JSON.stringify({ code: cardCode }),
      }),
    enabled: !!code,
  });

  const { data: txData } = useQuery({
    queryKey: ["giftcard-transactions", code, txPage],
    queryFn: () =>
      fetchApi<PaginatedResponse<GiftCardTransaction>>("/admin/giftcards/transactions", {
        method: "POST",
        body: JSON.stringify({
          code: cardCode,
          page: txPage,
          pageSize: 20,
        }),
      }),
    enabled: !!code && !!card,
  });

  const handleSearch = () => {
    const trimmed = searchCode.trim().toUpperCase();
    if (!trimmed) return;
    navigate(`/giftcards/cards/${trimmed}`, { replace: true });
  };

  const handleRedeem = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      const key = crypto.randomUUID();
      await fetchApi("/admin/giftcards/redeem", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          code: cardCode,
          amount: redeemAmount,
          ...(redeemMemberId ? { memberId: redeemMemberId } : {}),
          ...(redeemOrderRef ? { orderRef: redeemOrderRef } : {}),
        }),
      });
      setShowRedeemDialog(false);
      setRedeemAmount(0);
      setRedeemMemberId("");
      setRedeemOrderRef("");
      void queryClient.invalidateQueries({ queryKey: ["giftcard-detail", code] });
      void queryClient.invalidateQueries({ queryKey: ["giftcard-transactions", code] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Redeem failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefund = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      const key = crypto.randomUUID();
      await fetchApi("/admin/giftcards/refund", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          code: cardCode,
          amount: refundAmount,
          ...(refundReason ? { reason: refundReason } : {}),
        }),
      });
      setShowRefundDialog(false);
      setRefundAmount(0);
      setRefundReason("");
      void queryClient.invalidateQueries({ queryKey: ["giftcard-detail", code] });
      void queryClient.invalidateQueries({ queryKey: ["giftcard-transactions", code] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await fetchApi("/admin/giftcards/cancel", {
        method: "POST",
        body: JSON.stringify({ code: cardCode }),
      });
      setShowCancelDialog(false);
      void queryClient.invalidateQueries({ queryKey: ["giftcard-detail", code] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigate("/giftcards");
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("common.back")}
          </Button>
          <h1 className="text-3xl font-bold">{t("giftcards.cardDetail")}</h1>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder={t("giftcards.searchPlaceholder")}
              value={searchCode}
              onChange={(e) => {
                setSearchCode(e.target.value.toUpperCase());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
            <Button onClick={handleSearch}>
              <Search className="mr-1 h-4 w-4" />
              {t("giftcards.search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-32" />
          </CardContent>
        </Card>
      ) : !card ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{t("giftcards.cardNotFound")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Card detail */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-mono text-2xl">{card.code}</CardTitle>
              </div>
              <Badge className={STATUS_COLORS[card.status] ?? ""}>
                {t(`giftcards.status.${card.status}`)}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t("giftcards.balance")}</p>
                  <p className="text-xl font-bold">
                    {card.balance.toLocaleString()} {card.currency}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("giftcards.initialAmount")}</p>
                  <p className="text-xl font-bold">
                    {card.initialAmount.toLocaleString()} {card.currency}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("giftcards.expiration")}</p>
                  <p className="text-xl font-bold">{format(new Date(card.expirationDate), "PP")}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t("giftcards.batch")}</p>
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xl font-bold"
                    onClick={() => {
                      navigate(`/giftcards/batches/${card.batchId}`);
                    }}
                  >
                    {card.batchId}
                  </Button>
                </div>
              </div>

              {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}

              <div className="mt-4 flex gap-2">
                {card.status === "active" && (
                  <>
                    <Button
                      onClick={() => {
                        setShowRedeemDialog(true);
                      }}
                    >
                      {t("giftcards.redeem")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowRefundDialog(true);
                      }}
                    >
                      {t("giftcards.refund")}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setShowCancelDialog(true);
                      }}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      {t("giftcards.cancelCard")}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Transactions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("giftcards.transactions")}</CardTitle>
            </CardHeader>
            <CardContent>
              {!txData ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : txData.items.length === 0 ? (
                <p className="text-muted-foreground">{t("common.noResults")}</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.date")}</TableHead>
                        <TableHead>{t("giftcards.type")}</TableHead>
                        <TableHead className="text-right">{t("giftcards.amount")}</TableHead>
                        <TableHead className="text-right">{t("giftcards.balanceAfter")}</TableHead>
                        <TableHead>{t("giftcards.reference")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txData.items.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="text-sm">
                            {format(new Date(tx.createdAt), "PPp")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{tx.type}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{tx.amount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            {tx.balanceAfter.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {tx.orderRef ?? tx.idempotencyKey ?? "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {txData.totalPages > 1 && (
                    <div className="mt-4 flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={txPage <= 1}
                        onClick={() => {
                          setTxPage((p) => p - 1);
                        }}
                      >
                        {t("common.previous")}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {t("common.pageInfo", {
                          page: txData.page,
                          totalPages: txData.totalPages,
                          total: txData.total,
                        })}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={txPage >= txData.totalPages}
                        onClick={() => {
                          setTxPage((p) => p + 1);
                        }}
                      >
                        {t("common.next")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Redeem dialog */}
      <Dialog open={showRedeemDialog} onOpenChange={setShowRedeemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("giftcards.redeem")}</DialogTitle>
            <DialogDescription>{t("giftcards.redeemDesc", { code: code ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("giftcards.amount")} *</Label>
              <Input
                type="number"
                step="0.01"
                value={redeemAmount}
                onChange={(e) => {
                  setRedeemAmount(Number(e.target.value));
                }}
              />
            </div>
            <div>
              <Label>{t("giftcards.memberId")}</Label>
              <Input
                value={redeemMemberId}
                onChange={(e) => {
                  setRedeemMemberId(e.target.value);
                }}
              />
            </div>
            <div>
              <Label>{t("giftcards.orderRef")}</Label>
              <Input
                value={redeemOrderRef}
                onChange={(e) => {
                  setRedeemOrderRef(e.target.value);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRedeemDialog(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleRedeem();
              }}
              disabled={submitting || redeemAmount <= 0}
            >
              {submitting ? t("common.loading") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog */}
      <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("giftcards.refund")}</DialogTitle>
            <DialogDescription>{t("giftcards.refundDesc", { code: code ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("giftcards.amount")} *</Label>
              <Input
                type="number"
                step="0.01"
                value={refundAmount}
                onChange={(e) => {
                  setRefundAmount(Number(e.target.value));
                }}
              />
            </div>
            <div>
              <Label>{t("giftcards.reason")}</Label>
              <Input
                value={refundReason}
                onChange={(e) => {
                  setRefundReason(e.target.value);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRefundDialog(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleRefund();
              }}
              disabled={submitting || refundAmount <= 0}
            >
              {submitting ? t("common.loading") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("giftcards.cancelCard")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("giftcards.cancelCardDesc", { code: code ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleCancel();
              }}
              disabled={submitting}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
