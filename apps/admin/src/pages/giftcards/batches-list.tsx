import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { GiftCardBatch, PaginatedResponse } from "@/types";

const TERMINAL_STATUSES = new Set(["ready", "partial", "failed", "cancelled"]);

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-800",
  generating: "bg-blue-100 text-blue-800",
  ready: "bg-green-100 text-green-800",
  partial: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-800",
};

export function BatchesListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["giftcard-batches", page, statusFilter],
    queryFn: () => {
      const status = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      return fetchApi<PaginatedResponse<GiftCardBatch>>(
        `/admin/giftcards/batches?page=${String(page)}&pageSize=${String(pageSize)}${status}`,
      );
    },
  });

  const hasActiveBatch = data?.items.some((b) => !TERMINAL_STATUSES.has(b.status));

  useEffect(() => {
    if (!hasActiveBatch) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["giftcard-batches"] });
    }, 3000);
    return () => {
      clearInterval(interval);
    };
  }, [hasActiveBatch, queryClient]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("giftcards.title")}</h1>
        <Button
          onClick={() => {
            navigate("/giftcards/batches/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("giftcards.createBatch")}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("giftcards.batches")}</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder={t("common.status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.filter")}</SelectItem>
              <SelectItem value="pending">{t("giftcards.status.pending")}</SelectItem>
              <SelectItem value="generating">{t("giftcards.status.generating")}</SelectItem>
              <SelectItem value="ready">{t("giftcards.status.ready")}</SelectItem>
              <SelectItem value="partial">{t("giftcards.status.partial")}</SelectItem>
              <SelectItem value="failed">{t("giftcards.status.failed")}</SelectItem>
              <SelectItem value="cancelled">{t("giftcards.status.cancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <p className="text-destructive">{t("common.error")}</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("campaigns.name")}</TableHead>
                    <TableHead className="text-right">{t("giftcards.quantity")}</TableHead>
                    <TableHead className="text-right">{t("giftcards.amount")}</TableHead>
                    <TableHead>{t("giftcards.currency")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("giftcards.expiration")}</TableHead>
                    <TableHead>{t("common.created")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((batch) => (
                    <TableRow
                      key={batch.id}
                      className="cursor-pointer"
                      onClick={() => {
                        navigate(`/giftcards/batches/${batch.id}`);
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{batch.name}</div>
                        {batch.status === "generating" && (
                          <Progress
                            value={
                              batch.quantity > 0
                                ? Math.round((batch.generatedCount / batch.quantity) * 100)
                                : 0
                            }
                            className="mt-1 h-1"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {batch.generatedCount}/{batch.quantity}
                      </TableCell>
                      <TableCell className="text-right">
                        {batch.initialAmount.toLocaleString()}
                      </TableCell>
                      <TableCell>{batch.currency}</TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLORS[batch.status] ?? ""}>
                          {t(`giftcards.status.${batch.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(batch.expirationDate), "PP")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(batch.createdAt), "PP")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t("common.pageInfo", {
                      page: data.page,
                      totalPages: data.totalPages,
                      total: data.total,
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
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
    </div>
  );
}
