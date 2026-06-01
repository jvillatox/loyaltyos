import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import type { TermsTemplate } from "@/types";

const LOCALE_LABELS: Record<string, string> = {
  "es-MX": "Español",
  "en-US": "English",
};

export function TermsListPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<TermsTemplate | null>(null);

  const {
    data: templates,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["giftcard-terms"],
    queryFn: () => fetchApi<TermsTemplate[]>("/admin/giftcards/terms"),
  });

  const handleToggle = async (tpl: TermsTemplate) => {
    await fetchApi(`/admin/giftcards/terms/${tpl.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !tpl.isActive }),
    });
    void queryClient.invalidateQueries({ queryKey: ["giftcard-terms"] });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetchApi(`/admin/giftcards/terms/${deleteTarget.id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["giftcard-terms"] });
    setDeleteTarget(null);
  };

  // Group by name, collect locales and versions
  const grouped = (templates ?? []).reduce<Record<string, TermsTemplate[]>>((acc, tpl) => {
    const key = tpl.name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(tpl);
    return acc;
  }, {});

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
          <h1 className="text-3xl font-bold">{t("giftcards.termsTemplates")}</h1>
        </div>
        <Button
          onClick={() => {
            navigate("/giftcards/terms/new");
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("giftcards.newTermsTemplate")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("giftcards.termsTemplates")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <p className="text-destructive">{t("common.error")}</p>
          ) : Object.keys(grouped).length === 0 ? (
            <p className="text-muted-foreground">{t("common.noResults")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("campaigns.name")}</TableHead>
                  <TableHead>{t("settings.language")}</TableHead>
                  <TableHead>{t("giftcards.version")}</TableHead>
                  <TableHead>{t("giftcards.active")}</TableHead>
                  <TableHead>{t("common.created")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(grouped).map(([name, items]) =>
                  items.map((tpl) => (
                    <TableRow key={tpl.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{LOCALE_LABELS[tpl.locale] ?? tpl.locale}</Badge>
                      </TableCell>
                      <TableCell>v{tpl.version}</TableCell>
                      <TableCell>
                        <Switch
                          checked={tpl.isActive}
                          onCheckedChange={() => {
                            void handleToggle(tpl);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(tpl.createdAt), "PP")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              navigate(`/giftcards/terms/${tpl.id}`);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setDeleteTarget(tpl);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("giftcards.deleteTerms")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                t("giftcards.deleteTermsDesc", {
                  name: deleteTarget.name,
                  locale: LOCALE_LABELS[deleteTarget.locale] ?? deleteTarget.locale,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDelete();
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
