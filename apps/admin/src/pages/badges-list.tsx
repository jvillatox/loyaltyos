import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Badge as UIBadge } from "@/components/ui/badge";
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
import type { PaginatedResponse } from "@/types";

interface BadgeType {
  id: string;
  name: string;
  description?: string;
  type: string;
  imageUrl?: string;
  isActive: boolean;
  conditions?: unknown;
}

export function BadgesListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["badges", page, typeFilter],
    queryFn: () => {
      const type = typeFilter !== "all" ? `&type=${typeFilter}` : "";
      return fetchApi<PaginatedResponse<BadgeType>>(
        `/admin/badges?page=${String(page)}&pageSize=${String(pageSize)}${type}`,
      );
    },
  });

  const handleDelete = async (id: string) => {
    await fetchApi(`/admin/badges/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["badges"] });
  };

  const typeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      ACHIEVEMENT: "Achievement",
      STATUS: "Status",
      TEMPORAL: "Temporal",
      COLLECTIBLE: "Collectible",
      SOCIAL: "Social",
    };
    return labels[type] ?? type;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("badges.title")}</h1>
        <Button
          onClick={() => {
            navigate("/badges/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("badges.createBadge")}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Badges</CardTitle>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="ACHIEVEMENT">Achievement</SelectItem>
              <SelectItem value="STATUS">Status</SelectItem>
              <SelectItem value="TEMPORAL">Temporal</SelectItem>
              <SelectItem value="COLLECTIBLE">Collectible</SelectItem>
              <SelectItem value="SOCIAL">Social</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={`sk-${String(i)}`} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-destructive">Failed to load badges.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Badge</TableHead>
                    <TableHead>{t("campaigns.type")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((badge) => (
                    <TableRow key={badge.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {badge.imageUrl ? (
                            <img
                              src={badge.imageUrl}
                              alt={badge.name}
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <Award className="h-8 w-8 text-muted-foreground" />
                          )}
                          <div>
                            <p className="font-medium">{badge.name}</p>
                            {badge.description && (
                              <p className="text-xs text-muted-foreground">{badge.description}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <UIBadge variant="secondary">{typeLabel(badge.type)}</UIBadge>
                      </TableCell>
                      <TableCell>
                        <UIBadge variant={badge.isActive ? "default" : "secondary"}>
                          {badge.isActive ? t("common.active") : t("common.inactive")}
                        </UIBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              navigate(`/badges/${badge.id}/edit`);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              void handleDelete(badge.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data?.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        {t("common.noResults")}
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
                    Page {data.page} of {data.totalPages}
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
