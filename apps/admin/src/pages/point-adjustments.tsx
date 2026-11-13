import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { usePermission } from "@/lib/access";
import { fetchApi } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";
import type { AdjustmentStatus, PaginatedResponse, PointAdjustmentRequest } from "@/types";

const STATUS_FILTERS: AdjustmentStatus[] = ["PENDING", "APPROVED", "REJECTED", "EXPIRED"];

const statusBadgeVariant: Record<
  AdjustmentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  EXPIRED: "outline",
};

const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

interface DecisionState {
  id: string;
  action: "approve" | "reject";
}

function memberLabel(item: PointAdjustmentRequest): string {
  const name = `${item.member.firstName ?? ""} ${item.member.lastName ?? ""}`.trim();
  if (name) return name;
  return item.member.email ?? item.member.externalId ?? "—";
}

export function PointAdjustmentsPage(): JSX.Element {
  const { t } = useTranslation();
  const { admin } = useAdminAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [decision, setDecision] = useState<DecisionState | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const pageSize = 20;

  const canApprove = usePermission("members.adjust.approve");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["point-adjustments", page, statusFilter],
    queryFn: () => {
      const status = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      return fetchApi<PaginatedResponse<PointAdjustmentRequest>>(
        `/admin/point-adjustments?page=${String(page)}&pageSize=${String(pageSize)}${status}`,
      );
    },
  });

  const isOwn = (item: PointAdjustmentRequest): boolean =>
    item.requestedByType === "ADMIN_USER" && item.requestedById === admin?.id;

  const isExpiringSoon = (item: PointAdjustmentRequest): boolean =>
    item.status === "PENDING" &&
    new Date(item.expiresAt).getTime() - Date.now() < EXPIRY_WARNING_MS;

  const openDecision = (item: PointAdjustmentRequest, action: "approve" | "reject"): void => {
    setDecision({ id: item.id, action });
    setDecisionComment("");
    setDecisionError(null);
  };

  const submitDecision = async (): Promise<void> => {
    if (!decision) return;
    setDeciding(true);
    setDecisionError(null);
    try {
      await fetchApi(`/admin/point-adjustments/${decision.id}/${decision.action}`, {
        method: "POST",
        body: JSON.stringify({ decisionComment: decisionComment.trim() }),
      });
      setDecision(null);
      void queryClient.invalidateQueries({ queryKey: ["point-adjustments"] });
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("pointAdjustments.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("pointAdjustments.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>{t("pointAdjustments.title")}</CardTitle>
            <CardDescription>{t("pointAdjustments.subtitle")}</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("pointAdjustments.allStatuses")}</SelectItem>
              {STATUS_FILTERS.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`pointAdjustments.status.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={`sk-${String(i)}`} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-destructive">{t("pointAdjustments.failedToLoad")}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pointAdjustments.member")}</TableHead>
                    <TableHead>{t("pointAdjustments.amount")}</TableHead>
                    <TableHead>{t("pointAdjustments.category")}</TableHead>
                    <TableHead>{t("pointAdjustments.comment")}</TableHead>
                    <TableHead>{t("pointAdjustments.requestedAt")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    {canApprove && <TableHead className="w-40">{t("common.actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{memberLabel(item)}</TableCell>
                      <TableCell className={item.amount >= 0 ? "text-green-600" : "text-red-600"}>
                        {item.amount > 0 ? "+" : ""}
                        {item.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {t(`pointAdjustments.categories.${item.reasonCategory}`)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{item.comment ?? "—"}</TableCell>
                      <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={statusBadgeVariant[item.status]}>
                            {t(`pointAdjustments.status.${item.status}`)}
                          </Badge>
                          {isExpiringSoon(item) && (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <AlertTriangle className="h-3 w-3" />
                              {t("pointAdjustments.expiryWarning")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {canApprove && (
                        <TableCell>
                          {item.status === "PENDING" && !isOwn(item) ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  openDecision(item, "approve");
                                }}
                              >
                                {t("pointAdjustments.approve")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                  openDecision(item, "reject");
                                }}
                              >
                                {t("pointAdjustments.reject")}
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {data && data.items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={canApprove ? 7 : 6}
                        className="text-center text-muted-foreground"
                      >
                        {t("pointAdjustments.noAdjustments")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {data && data.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1));
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

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.action === "approve"
                ? t("pointAdjustments.approve")
                : t("pointAdjustments.reject")}
            </DialogTitle>
            <DialogDescription>{t("pointAdjustments.decisionComment")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Label htmlFor="decisionComment">{t("pointAdjustments.decisionComment")}</Label>
            <Textarea
              id="decisionComment"
              value={decisionComment}
              placeholder={t("pointAdjustments.decisionCommentPlaceholder")}
              onChange={(e) => {
                setDecisionComment(e.target.value);
              }}
            />
            {decisionError && <p className="text-sm text-destructive">{decisionError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDecision(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={deciding}
              onClick={() => {
                void submitDecision();
              }}
            >
              {decision?.action === "approve"
                ? t("pointAdjustments.approve")
                : t("pointAdjustments.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
