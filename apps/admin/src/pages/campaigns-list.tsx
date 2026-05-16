import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pause, Pencil, Play, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import type { Campaign, PaginatedResponse } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  BONUS_POINTS: "Bonus Points",
  SPEND_AND_GET: "Spend & Get",
  FREQUENCY: "Frequency",
  MILESTONE: "Milestone",
  REFERRAL: "Referral",
  BIRTHDAY: "Birthday",
  ANNIVERSARY: "Anniversary",
  FLASH_SALE: "Flash Sale",
  TIER_UPGRADE_BONUS: "Tier Upgrade",
};

export function CampaignsListPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaigns", page],
    queryFn: () =>
      fetchApi<PaginatedResponse<Campaign>>(
        `/admin/campaigns?page=${String(page)}&pageSize=${String(pageSize)}`,
      ),
  });

  const handleLifecycle = async (id: string, action: "activate" | "pause" | "archive") => {
    await fetchApi(`/admin/campaigns/${id}/lifecycle`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Campaigns</h1>
        <Button
          onClick={() => {
            navigate("/campaigns/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Campaign
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !data ? (
            <p className="text-destructive">Failed to load campaigns.</p>
          ) : data.items.length === 0 ? (
            <p className="text-muted-foreground">No campaigns found.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Starts</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            c.isActive
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-800",
                          )}
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c.maxBudget != null ? `${c.maxBudget.toLocaleString()} pts` : "Unlimited"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              ···
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                navigate(`/campaigns/${c.id}/edit`);
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            {!c.isActive && (
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleLifecycle(c.id, "activate");
                                }}
                              >
                                <Play className="mr-2 h-4 w-4" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            {c.isActive && (
                              <DropdownMenuItem
                                onClick={() => {
                                  void handleLifecycle(c.id, "pause");
                                }}
                              >
                                <Pause className="mr-2 h-4 w-4" />
                                Pause
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                void handleLifecycle(c.id, "archive");
                              }}
                            >
                              <Archive className="mr-2 h-4 w-4" />
                              Archive
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
