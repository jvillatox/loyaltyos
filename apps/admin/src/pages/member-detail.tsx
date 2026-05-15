import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import type { Balance, Member, PaginatedResponse, PointTransaction } from "@/types";

const adjustSchema = z.object({
  amount: z.coerce
    .number()
    .int()
    .refine((v) => v !== 0, "Amount must not be zero"),
  reason: z.string().min(1, "Reason is required"),
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
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustSchema),
  });

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
    try {
      await fetchApi(`/members/${memberId}/adjust`, {
        method: "POST",
        body: JSON.stringify(values),
        headers: {
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      setDialogOpen(false);
      reset();
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
            Back to Members
          </Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">Member not found</p>
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
            Back to Members
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
          <CardDescription>Member Profile</CardDescription>
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
                <dt className="text-sm text-muted-foreground">Email</dt>
                <dd>{member?.email ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Phone</dt>
                <dd>{member?.phone ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">External ID</dt>
                <dd>{member?.externalId ?? "--"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Joined</dt>
                <dd>{member ? new Date(member.joinedAt).toLocaleDateString() : "--"}</dd>
              </div>
              {member?.tags && member.tags.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-sm text-muted-foreground">Tags</dt>
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
            <CardTitle>Points Balance</CardTitle>
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
                  <p className="text-sm text-muted-foreground">Confirmed</p>
                  <p className="text-2xl font-bold text-green-600">
                    {(balance?.confirmed ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">Pending</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {(balance?.pending ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-lg bg-muted p-4 text-center">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold">{(balance?.total ?? 0).toLocaleString()}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Adjust Points</CardTitle>
            <CardDescription>Manually add or remove points for this member.</CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="w-full">Adjust Points</Button>
              </DialogTrigger>
              <DialogContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSubmit(onSubmit)();
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>Adjust Points</DialogTitle>
                    <DialogDescription>
                      Enter a positive amount to add points or negative to deduct.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div>
                      <Label htmlFor="amount">Amount</Label>
                      <Input id="amount" type="number" {...register("amount")} />
                      {errors.amount && (
                        <p className="mt-1 text-sm text-destructive">{errors.amount.message}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="reason">Reason</Label>
                      <Input id="reason" {...register("reason")} />
                      {errors.reason && (
                        <p className="mt-1 text-sm text-destructive">{errors.reason.message}</p>
                      )}
                    </div>
                    {adjustError && <p className="text-sm text-destructive">{adjustError}</p>}
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={adjusting}>
                      {adjusting ? "Submitting..." : "Submit"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {txsLoading ? (
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
              <p className="text-muted-foreground">No transactions yet</p>
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
                  Page {transactions.page} of {transactions.totalPages}
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
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.page >= transactions.totalPages}
                    onClick={() => {
                      setTxPage((p) => p + 1);
                    }}
                  >
                    Next
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
