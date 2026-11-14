import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";

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
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { usePermission } from "@/lib/access";
import { fetchApi } from "@/lib/api-client";
import type {
  AdjustmentReasonCategory,
  AdjustResult,
  Balance,
  Member,
  PaginatedResponse,
  PointTransaction,
} from "@/types";

const ADJUSTMENT_CATEGORIES: AdjustmentReasonCategory[] = [
  "CUSTOMER_SERVICE",
  "ERROR_CORRECTION",
  "PROMOTION",
  "FRAUD",
  "OTHER",
];

const adjustSchema = z.object({
  amount: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, "Amount must not be zero"),
  reasonCategory: z.enum(["CUSTOMER_SERVICE", "ERROR_CORRECTION", "PROMOTION", "FRAUD", "OTHER"]),
  comment: z.string().trim().min(10, "Comment must be at least 10 characters").max(1000),
});

type AdjustFormValues = z.infer<typeof adjustSchema>;

const transactionTypeColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  EARN: "default",
  REDEEM: "destructive",
  REVERSE: "secondary",
  EXPIRE: "outline",
  ADJUST: "secondary",
};

export function MemberDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustResult, setAdjustResult] = useState<"applied" | "sentForApproval" | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const canWrite = usePermission("members.write");

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustSchema),
    defaultValues: { reasonCategory: "CUSTOMER_SERVICE", comment: "" },
  });

  const watchedAmount = watch("amount");

  const {
    data: member,
    isLoading: memberLoading,
    isError: memberError,
  } = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => fetchApi<Member>(`/members/${memberId}`),
    enabled: Boolean(memberId),
  });

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ["member-balance", memberId],
    queryFn: () => fetchApi<Balance>(`/members/${memberId}/balance`),
    enabled: Boolean(memberId),
  });

  const [txPage, setTxPage] = useState(1);
  const { data: transactions, isLoading: txsLoading } = useQuery({
    queryKey: ["member-transactions", memberId, txPage],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(txPage));
      params.set("pageSize", "10");
      return fetchApi<PaginatedResponse<PointTransaction>>(
        `/members/${memberId}/transactions?${params.toString()}`,
      );
    },
    enabled: Boolean(memberId),
  });

  const onSubmit = async (values: AdjustFormValues): Promise<void> => {
    setAdjusting(true);
    setAdjustError(null);
    setAdjustResult(null);
    try {
      const result = await fetchApi<AdjustResult>(`/members/${memberId}/adjust`, {
        method: "POST",
        body: JSON.stringify(values),
        headers: {
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      setDialogOpen(false);
      reset();
      setAdjustResult(result.status === "PENDING" ? "sentForApproval" : "applied");
      void queryClient.invalidateQueries({ queryKey: ["member-balance", memberId] });
      void queryClient.invalidateQueries({ queryKey: ["member-transactions", memberId] });
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setAdjusting(false);
    }
  };

  if (memberError || (!memberLoading && !member)) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">{t("memberDetail.memberNotFound")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/members">
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t("members.backToList")}
          </Link>
        </Button>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>
            {memberLoading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              `${member?.firstName ?? ""} ${member?.lastName ?? ""}`.trim() || "N/A"
            )}
          </CardTitle>
          <CardDescription>{t("memberDetail.profile")}</CardDescription>
        </CardHeader>
        <CardContent>
          {memberLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">{t("memberDetail.email")}</dt>
                <dd>{member?.email ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("memberDetail.phone")}</dt>
                <dd>{member?.phone ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("memberDetail.externalId")}</dt>
                <dd>{member?.externalId ?? "--"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{t("memberDetail.joined")}</dt>
                <dd>{member ? new Date(member.joinedAt).toLocaleDateString() : "--"}</dd>
              </div>
              {member?.tags && member.tags.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-sm text-muted-foreground">{t("memberDetail.tags")}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {member.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Balance + Adjust */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("memberDetail.pointsBalance")}</CardTitle>
          </CardHeader>
          <CardContent>
            {balanceLoading ? (
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t("memberDetail.confirmed")}</p>
                  <p className="text-2xl font-bold text-green-600">
                    {(balance?.confirmed ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t("memberDetail.pending")}</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {(balance?.pending ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">{t("memberDetail.total")}</p>
                  <p className="text-2xl font-bold">{(balance?.total ?? 0).toLocaleString()}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {canWrite && (
          <Card>
            <CardHeader>
              <CardTitle>{t("pointAdjustments.dialog.title")}</CardTitle>
              <CardDescription>{t("pointAdjustments.dialog.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full">{t("pointAdjustments.dialog.title")}</Button>
                </DialogTrigger>
                <DialogContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSubmit(onSubmit)();
                    }}
                  >
                    <DialogHeader>
                      <DialogTitle>{t("pointAdjustments.dialog.title")}</DialogTitle>
                      <DialogDescription>
                        {t("pointAdjustments.dialog.description")}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div>
                        <Label htmlFor="amount">{t("pointAdjustments.dialog.amount")}</Label>
                        <Input id="amount" type="number" {...register("amount")} />
                        {errors.amount && (
                          <p className="mt-1 text-sm text-destructive">{errors.amount.message}</p>
                        )}
                      </div>
                      <div>
                        <Label>{t("pointAdjustments.dialog.category")}</Label>
                        <Controller
                          control={control}
                          name="reasonCategory"
                          render={({ field }) => (
                            <Select value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ADJUSTMENT_CATEGORIES.map((category) => (
                                  <SelectItem key={category} value={category}>
                                    {t(`pointAdjustments.categories.${category}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <div>
                        <Label htmlFor="comment">{t("pointAdjustments.dialog.comment")}</Label>
                        <Textarea
                          id="comment"
                          placeholder={t("pointAdjustments.dialog.commentPlaceholder")}
                          {...register("comment")}
                        />
                        {errors.comment && (
                          <p className="mt-1 text-sm text-destructive">{errors.comment.message}</p>
                        )}
                      </div>
                      <div className="rounded-md bg-muted p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {t("pointAdjustments.dialog.currentBalance")}
                          </span>
                          <span className="font-medium">
                            {(balance?.confirmed ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 flex justify-between">
                          <span className="text-muted-foreground">
                            {t("pointAdjustments.dialog.resultingBalance")}
                          </span>
                          <span className="font-medium">
                            {(
                              (balance?.confirmed ?? 0) + (Number(watchedAmount) || 0)
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {adjustError && <p className="text-sm text-destructive">{adjustError}</p>}
                    </div>
                    <DialogFooter>
                      <Button type="submit" disabled={adjusting}>
                        {adjusting
                          ? t("pointAdjustments.dialog.submitting")
                          : t("pointAdjustments.dialog.submit")}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              {adjustResult === "sentForApproval" && (
                <p className="text-sm font-medium text-amber-600">
                  {t("pointAdjustments.dialog.sentForApproval")}
                </p>
              )}
              {adjustResult === "applied" && (
                <p className="text-sm font-medium text-green-600">
                  {t("pointAdjustments.dialog.applied")}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("memberDetail.transactionHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {txsLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("memberDetail.date")}</TableHead>
                  <TableHead>{t("memberDetail.type")}</TableHead>
                  <TableHead>{t("memberDetail.amount")}</TableHead>
                  <TableHead>{t("memberDetail.balanceAfter")}</TableHead>
                  <TableHead>{t("memberDetail.source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : !transactions || transactions.items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">{t("memberDetail.noTransactions")}</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance After</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.items.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Badge variant={transactionTypeColors[tx.type] ?? "outline"}>
                          {tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={
                          tx.type === "EARN" || tx.type === "ADJUST"
                            ? tx.amount > 0
                              ? "text-green-600"
                              : "text-red-600"
                            : "text-red-600"
                        }
                      >
                        {tx.amount > 0 ? "+" : ""}
                        {tx.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{tx.balanceAfter.toLocaleString()}</TableCell>
                      <TableCell>{tx.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t("memberDetail.pageInfo", {
                    page: transactions.page,
                    totalPages: transactions.totalPages,
                  })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page <= 1}
                    onClick={() => {
                      setTxPage((p) => p - 1);
                    }}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page >= transactions.totalPages}
                    onClick={() => {
                      setTxPage((p) => p + 1);
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
