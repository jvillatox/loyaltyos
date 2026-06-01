import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Download, XCircle } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
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
import type { GiftCard, GiftCardBatch, PaginatedResponse } from "@/types";

const TERMINAL_STATUSES = new Set(["ready", "partial", "failed", "cancelled"]);

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-800",
  generating: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-800",
};

const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export function BatchDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const batchId = id ?? "";
  const [cardsPage, setCardsPage] = useState(1);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pageSize = 20;

  const { data: batch, isLoading } = useQuery({
    queryKey: ["giftcard-batch", batchId],
    queryFn: () => fetchApi<GiftCardBatch>(`/admin/giftcards/batches/${batchId}`),
    enabled: !!id,
  });

  const { data: cardsData } = useQuery({
    queryKey: ["giftcard-batch-cards", batchId, cardsPage],
    queryFn: () =>
      fetchApi<PaginatedResponse<GiftCard>>(
        `/admin/giftcards/batches/${batchId}/cards?page=${String(cardsPage)}&pageSize=${String(pageSize)}`,
      ),
    enabled: !!id,
  });

  const isTerminal = batch && TERMINAL_STATUSES.has(batch.status);

  // Auto-refresh while generating
  useQuery({
    queryKey: ["giftcard-batch-poll", batchId],
    queryFn: () => fetchApi<GiftCardBatch>(`/admin/giftcards/batches/${batchId}`),
    enabled: !!id && !isTerminal,
    refetchInterval: 3000,
  });

  const handleExport = (format: "csv" | "xlsx") => {
    setDownloading(format);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    void fetch(`${API_URL}/admin/giftcards/batches/${batchId}/export?format=${format}`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Export failed");
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `batch-${batchId}-${dateStr}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        /* handled */
      })
      .finally(() => {
        setDownloading(null);
      });
  };

  const handleCancel = () => {
    void fetchApi(`/admin/giftcards/batches/${batchId}/cancel`, { method: "POST" })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["giftcard-batch", batchId] });
        void queryClient.invalidateQueries({ queryKey: ["giftcard-batches"] });
        setShowCancelDialog(false);
      })
      .catch(() => {
        /* error handled by fetchApi */
      });
  };

  if (isLoading || !batch) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

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
          <h1 className="text-3xl font-bold">{batch.name}</h1>
          <Badge className={STATUS_COLORS[batch.status] ?? ""}>
            {t(`giftcards.status.${batch.status}`)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={downloading !== null}
            onClick={() => {
              handleExport("csv");
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading === "csv" ? t("common.loading") : t("giftcards.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={downloading !== null}
            onClick={() => {
              handleExport("xlsx");
            }}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading === "xlsx" ? t("common.loading") : t("giftcards.exportXlsx")}
          </Button>
          {!isTerminal && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowCancelDialog(true);
              }}
            >
              <XCircle className="mr-1 h-4 w-4" />
              {t("giftcards.cancelBatch")}
            </Button>
          )}
        </div>
      </div>

      {batch.status === "generating" && (
        <Progress
          value={batch.quantity > 0 ? Math.round((batch.generatedCount / batch.quantity) * 100) : 0}
          className="h-2"
        />
      )}

      {/* Stats grid */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("giftcards.totalCards")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {batch.generatedCount.toLocaleString()} / {batch.quantity.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("giftcards.initialAmount")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {batch.initialAmount.toLocaleString()} {batch.currency}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("giftcards.estimatedLiability")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {(batch.quantity * batch.initialAmount).toLocaleString()} {batch.currency}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("giftcards.expiration")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{format(new Date(batch.expirationDate), "PP")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Cards table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("giftcards.cards")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!cardsData ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : cardsData.items.length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("giftcards.code")}</TableHead>
                    <TableHead className="text-right">{t("giftcards.balance")}</TableHead>
                    <TableHead className="text-right">{t("giftcards.initialAmount")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("giftcards.expiration")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cardsData.items.map((card) => (
                    <TableRow
                      key={card.id}
                      className="cursor-pointer"
                      onClick={() => {
                        navigate(`/giftcards/cards/${card.code}`);
                      }}
                    >
                      <TableCell className="font-mono">{card.code}</TableCell>
                      <TableCell className="text-right">
                        {card.balance.toLocaleString()} {card.currency}
                      </TableCell>
                      <TableCell className="text-right">
                        {card.initialAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[card.status] ?? ""}>
                          {t(`giftcards.status.${card.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(card.expirationDate), "PP")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {cardsData.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cardsPage <= 1}
                    onClick={() => {
                      setCardsPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t("common.pageInfo", {
                      page: cardsData.page,
                      totalPages: cardsData.totalPages,
                      total: cardsData.total,
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cardsPage >= cardsData.totalPages}
                    onClick={() => {
                      setCardsPage((p) => p + 1);
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

      {/* Cancel confirmation */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("giftcards.confirmCancel")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("giftcards.confirmCancelDesc", {
                name: batch.name,
                count: batch.generatedCount,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel}>{t("common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
