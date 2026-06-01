import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import type { TermsTemplate } from "@/types";

export function TermsEditorPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const termsId = id ?? "";
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const [locale, setLocale] = useState("es-MX");
  const [body, setBody] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { data: template, isLoading } = useQuery({
    queryKey: ["giftcard-terms", id],
    queryFn: () => fetchApi<TermsTemplate>(`/admin/giftcards/terms/${termsId}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (template) {
      setName(template.name);
      setLocale(template.locale);
      setBody(template.body);
      setIsActive(template.isActive);
    }
  }, [template]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (isEdit) {
        await fetchApi(`/admin/giftcards/terms/${termsId}`, {
          method: "PATCH",
          body: JSON.stringify({ name, locale, body }),
        });
      } else {
        await fetchApi("/admin/giftcards/terms", {
          method: "POST",
          body: JSON.stringify({ name, locale, body }),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["giftcard-terms"] });
      navigate("/giftcards/terms");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async () => {
    if (!isEdit) return;
    const newVal = !isActive;
    setIsActive(newVal);
    await fetchApi(`/admin/giftcards/terms/${termsId}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: newVal }),
    });
    void queryClient.invalidateQueries({ queryKey: ["giftcard-terms"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/giftcards/terms");
          }}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("common.back")}
        </Button>
        <h1 className="text-3xl font-bold">
          {isEdit ? t("giftcards.editTermsTemplate") : t("giftcards.newTermsTemplate")}
        </h1>
      </div>

      {isEdit && isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("giftcards.editTermsTemplate")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="terms-name">{t("campaigns.name")} *</Label>
                <Input
                  id="terms-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
              </div>
              <div>
                <Label>{t("settings.language")}</Label>
                <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="es-MX">Español</SelectItem>
                    <SelectItem value="en-US">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="terms-body">{t("giftcards.terms")} *</Label>
                <Textarea
                  id="terms-body"
                  rows={12}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                />
              </div>
              {isEdit && (
                <div className="flex items-center gap-3">
                  <Label>{t("giftcards.active")}</Label>
                  <Switch
                    checked={isActive}
                    onCheckedChange={() => {
                      void handleToggleActive();
                    }}
                  />
                </div>
              )}
              <Separator />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    navigate("/giftcards/terms");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    void handleSubmit();
                  }}
                  disabled={submitting || !name || !body}
                >
                  {submitting ? t("common.loading") : t("common.save")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                {t("giftcards.preview")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4">
                {body || (
                  <span className="text-muted-foreground">{t("giftcards.previewEmpty")}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
