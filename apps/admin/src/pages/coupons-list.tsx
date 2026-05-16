import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { Coupon, PaginatedResponse } from "@/types";

const DISCOUNT_LABELS: Record<string, string> = {
  PERCENTAGE: "Percentage",
  FIXED: "Fixed Amount",
  FREE_PRODUCT: "Free Product",
  FREE_SHIPPING: "Free Shipping",
  EXTRA_POINTS: "Extra Points",
  EXPERIENCE: "Experience",
};

const MODE_LABELS: Record<string, string> = {
  SHARED: "Shared",
  INDIVIDUAL: "Individual",
  LIMITED: "Limited",
};

export function CouponsListPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["coupons", page, modeFilter],
    queryFn: () => {
      const mode = modeFilter !== "all" ? `&mode=${modeFilter}` : "";
      return fetchApi<PaginatedResponse<Coupon>>(
        `/admin/coupons?page=${String(page)}&pageSize=${String(pageSize)}${mode}`,
      );
    },
  });

  const handleDelete = async (id: string) => {
    await fetchApi(`/admin/coupons/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["coupons"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Coupons</h1>
        <Button
          onClick={() => {
            navigate("/coupons/generate");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Generate Bulk
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Coupons</CardTitle>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              <SelectItem value="SHARED">Shared</SelectItem>
              <SelectItem value="INDIVIDUAL">Individual</SelectItem>
              <SelectItem value="LIMITED">Limited</SelectItem>
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
            <p className="text-destructive">Failed to load coupons.</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">No coupons found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {DISCOUNT_LABELS[c.discountType] ?? c.discountType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {MODE_LABELS[c.mode] ?? c.mode}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.usedCount}
                        {c.maxUses != null ? ` / ${String(c.maxUses)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            c.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-800"
                          }
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            void handleDelete(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {data.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.totalPages}
                    onClick={() => {
                      setPage((p) => p + 1);
                    }}
                  >
                    Next
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
