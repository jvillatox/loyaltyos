import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  RefreshCw,
  Search,
  Undo2,
  XCircle,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
import { usePermission } from "@/lib/access";
import { fetchApi } from "@/lib/api-client";

interface CoalitionTransaction {
  id: string;
  accountId: string;
  type: "EARN" | "REDEEM";
  amount: number;
  localTxRef: string;
  externalTxRef: string | null;
  status: "PENDING" | "CONFIRMED" | "FAILED" | "REVERSED" | "NEEDS_REVIEW";
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "secondary",
  CONFIRMED: "default",
  FAILED: "destructive",
  REVERSED: "outline",
  NEEDS_REVIEW: "secondary",
};

export function CoalitionTransactionsPage(): JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const canReview = usePermission("coalition.write");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [memberIdFilter, setMemberIdFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTx, setSelectedTx] = useState<CoalitionTransaction | null>(null);
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [failDialogOpen, setFailDialogOpen] = useState(false);
  const [failComment, setFailComment] = useState("");

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["coalition-transactions", statusFilter, memberIdFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (memberIdFilter) params.set("memberId", memberIdFilter);
      params.set("page", String(page));
      params.set("pageSize", "20");
      return fetchApi<CoalitionTransaction[]>(`/admin/coalition/transactions?${params.toString()}`);
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (input: { txRef: string; reason: string }) =>
      fetchApi("/coalition/reverse", {
        method: "POST",
        headers: { "idempotency-key": `admin-reverse-${input.txRef}-${String(Date.now())}` },
        body: JSON.stringify({ txRef: input.txRef, reason: input.reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["coalition-transactions"] });
      setReverseDialogOpen(false);
      setReverseReason("");
    },
  });

  const retryMutation = useMutation({
    mutationFn: (txId: string) =>
      fetchApi(`/admin/coalition/transactions/${txId}/retry`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["coalition-transactions"] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (txId: string) =>
      fetchApi(`/admin/coalition/transactions/${txId}/confirm`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["coalition-transactions"] });
    },
  });

  const failMutation = useMutation({
    mutationFn: (input: { txId: string; comment: string }) =>
      fetchApi(`/admin/coalition/transactions/${input.txId}/fail`, {
        method: "POST",
        body: JSON.stringify({ comment: input.comment }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["coalition-transactions"] });
      setFailDialogOpen(false);
      setFailComment("");
    },
  });

  const statusBadge = (status: string) => (
    <Badge variant={STATUS_VARIANTS[status] ?? "secondary"}>
      {t(`coalition.status.${status}`)}
    </Badge>
  );

  const handleReverse = (): void => {
    if (!selectedTx || !reverseReason) return;
    reverseMutation.mutate({ txRef: selectedTx.localTxRef, reason: reverseReason });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("coalition.transactions.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("coalition.transactions.subtitle")}</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="status-filter">{t("coalition.transactions.status")}</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger id="status-filter" className="w-36">
                <SelectValue placeholder={t("coalition.transactions.all")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("coalition.transactions.all")}</SelectItem>
                <SelectItem value="PENDING">{t("coalition.status.PENDING")}</SelectItem>
                <SelectItem value="CONFIRMED">{t("coalition.status.CONFIRMED")}</SelectItem>
                <SelectItem value="FAILED">{t("coalition.status.FAILED")}</SelectItem>
                <SelectItem value="REVERSED">{t("coalition.status.REVERSED")}</SelectItem>
                <SelectItem value="NEEDS_REVIEW">{t("coalition.status.NEEDS_REVIEW")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="member-filter">{t("coalition.transactions.memberId")}</Label>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                id="member-filter"
                placeholder={t("coalition.transactions.memberFilterPlaceholder")}
                value={memberIdFilter}
                onChange={(e) => {
                  setMemberIdFilter(e.target.value);
                  setPage(1);
                }}
                className="w-48"
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter("ALL");
              setMemberIdFilter("");
              setPage(1);
            }}
          >
            {t("coalition.transactions.clearFilters")}
          </Button>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      {isLoading ? (
        <Card>
          <CardContent className="py-8">
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : transactions && transactions.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("coalition.transactions.status")}</TableHead>
                <TableHead>{t("coalition.transactions.type")}</TableHead>
                <TableHead>{t("coalition.transactions.amount")}</TableHead>
                <TableHead>{t("coalition.transactions.localRef")}</TableHead>
                <TableHead>{t("coalition.transactions.externalRef")}</TableHead>
                <TableHead>{t("coalition.transactions.attempts")}</TableHead>
                <TableHead>{t("coalition.transactions.date")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx) => (
                <TableRow
                  key={tx.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelectedTx(tx);
                  }}
                >
                  <TableCell>{statusBadge(tx.status)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`coalition.transactionTypes.${tx.type}`)}</Badge>
                  </TableCell>
                  <TableCell className="font-mono">{tx.amount.toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{tx.localTxRef}</TableCell>
                  <TableCell className="font-mono text-xs">{tx.externalTxRef ?? "—"}</TableCell>
                  <TableCell>{tx.attempts}</TableCell>
                  <TableCell className="text-xs">
                    {format(new Date(tx.createdAt), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell>
                    {(tx.status === "PENDING" || tx.status === "FAILED") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTx(tx);
                          setReverseDialogOpen(true);
                        }}
                      >
                        <Undo2 className="mr-1 h-3 w-3" />
                        {t("coalition.transactions.reverse")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">{t("coalition.transactions.noTransactions")}</p>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {t("common.previous")}
        </Button>
        <span className="text-sm text-muted-foreground">{t("coalition.page", { page })}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!transactions || transactions.length < 20}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {t("common.next")}
        </Button>
      </div>

      {/* Transaction Detail Panel */}
      {selectedTx && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {t("coalition.transactions.transactionDetail")}
              {statusBadge(selectedTx.status)}
            </CardTitle>
            <CardDescription>{selectedTx.localTxRef}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.id")}
                </Label>
                <p className="font-mono text-sm">{selectedTx.id}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.type")}
                </Label>
                <p>{t(`coalition.transactionTypes.${selectedTx.type}`)}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.amount")}
                </Label>
                <p className="font-mono">{selectedTx.amount.toLocaleString()}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.attempts")}
                </Label>
                <p>{selectedTx.attempts}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.externalTxRef")}
                </Label>
                <p className="font-mono text-sm">{selectedTx.externalTxRef ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.idempotencyKey")}
                </Label>
                <p className="font-mono text-sm">{selectedTx.idempotencyKey}</p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.createdAt")}
                </Label>
                <p className="text-sm">{format(new Date(selectedTx.createdAt), "PPpp")}</p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground">
                  {t("coalition.transactions.updatedAt")}
                </Label>
                <p className="text-sm">{format(new Date(selectedTx.updatedAt), "PPpp")}</p>
              </div>
              {selectedTx.lastError && (
                <div className="sm:col-span-2">
                  <Label className="text-xs text-destructive">
                    {t("coalition.transactions.lastError")}
                  </Label>
                  <p className="text-sm text-destructive">{selectedTx.lastError}</p>
                </div>
              )}
              {selectedTx.metadata != null && (
                <div className="sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("coalition.transactions.metadata")}
                  </Label>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(selectedTx.metadata as Record<string, unknown>, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="mt-6">
              <Label className="text-xs text-muted-foreground">
                {t("coalition.transactions.timeline")}
              </Label>
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs">
                    1
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t("coalition.status.PENDING")}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(selectedTx.createdAt), "PPpp")}
                    </p>
                  </div>
                </div>

                {selectedTx.status === "CONFIRMED" && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                      2
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("coalition.status.CONFIRMED")}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(selectedTx.updatedAt), "PPpp")}
                      </p>
                    </div>
                  </div>
                )}

                {selectedTx.status === "FAILED" && selectedTx.lastError && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
                      <AlertTriangle className="h-3 w-3" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("coalition.status.FAILED")}</p>
                      <p className="text-xs text-muted-foreground">{selectedTx.lastError}</p>
                    </div>
                  </div>
                )}

                {selectedTx.status === "REVERSED" && (
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs text-white">
                      <ArrowLeftRight className="h-3 w-3" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("coalition.status.REVERSED")}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(selectedTx.updatedAt), "PPpp")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Reverse Action */}
            {(selectedTx.status === "PENDING" || selectedTx.status === "FAILED") && (
              <div className="mt-6">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setReverseDialogOpen(true);
                  }}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {t("coalition.transactions.forceReverse")}
                </Button>
              </div>
            )}

            {/* Manual Reconciliation Actions (SUPER_ADMIN on PENDING/NEEDS_REVIEW) */}
            {canReview &&
              (selectedTx.status === "PENDING" || selectedTx.status === "NEEDS_REVIEW") && (
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={retryMutation.isPending}
                    onClick={() => {
                      retryMutation.mutate(selectedTx.id);
                    }}
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${retryMutation.isPending ? "animate-spin" : ""}`}
                    />
                    {t("coalition.transactions.retryNow")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={confirmMutation.isPending}
                    onClick={() => {
                      confirmMutation.mutate(selectedTx.id);
                    }}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {t("coalition.transactions.markConfirmed")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setFailDialogOpen(true);
                    }}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {t("coalition.transactions.markFailed")}
                  </Button>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* Reverse Confirmation Dialog */}
      <Dialog open={reverseDialogOpen} onOpenChange={setReverseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coalition.transactions.reverseDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("coalition.transactions.reverseDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reverse-reason">{t("coalition.transactions.reason")}</Label>
              <Input
                id="reverse-reason"
                value={reverseReason}
                onChange={(e) => {
                  setReverseReason(e.target.value);
                }}
                placeholder={t("coalition.transactions.reasonPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReverseDialogOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReverse}
              disabled={!reverseReason || reverseMutation.isPending}
            >
              {reverseMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("coalition.transactions.confirmReverse")}
            </Button>
          </DialogFooter>
          {reverseMutation.isError && (
            <p className="text-sm text-destructive">
              {reverseMutation.error instanceof Error
                ? reverseMutation.error.message
                : t("coalition.transactions.reverseFailed")}
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark as Failed Dialog (obligatory comment) */}
      <Dialog open={failDialogOpen} onOpenChange={setFailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coalition.transactions.markFailedDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("coalition.transactions.markFailedDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="fail-comment">{t("coalition.transactions.comment")}</Label>
              <Input
                id="fail-comment"
                value={failComment}
                onChange={(e) => {
                  setFailComment(e.target.value);
                }}
                placeholder={t("coalition.transactions.commentPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFailDialogOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!failComment || failMutation.isPending}
              onClick={() => {
                if (selectedTx && failComment) {
                  failMutation.mutate({ txId: selectedTx.id, comment: failComment });
                }
              }}
            >
              {failMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("coalition.transactions.confirmMarkFailed")}
            </Button>
          </DialogFooter>
          {failMutation.isError && (
            <p className="text-sm text-destructive">
              {failMutation.error instanceof Error
                ? failMutation.error.message
                : t("coalition.transactions.actionFailed")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
