import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";

interface ProgramSettingsData {
  id: string;
  name: string;
  adjustOperatorPerTxLimit: number;
  adjustOperatorDailyLimit: number;
  adjustServerPerTxLimit: number;
}

interface Limits {
  adjustOperatorPerTxLimit: number;
  adjustOperatorDailyLimit: number;
  adjustServerPerTxLimit: number;
}

function LimitField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
        }}
      />
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function ProgramSettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const { admin } = useAdminAuth();
  const queryClient = useQueryClient();
  const [limits, setLimits] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const programId = admin?.programId ?? "";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["program-settings", programId],
    queryFn: () => fetchApi<ProgramSettingsData>(`/admin/programs/${programId}`),
    enabled: Boolean(programId),
  });

  useEffect(() => {
    if (data) {
      setLimits({
        adjustOperatorPerTxLimit: data.adjustOperatorPerTxLimit,
        adjustOperatorDailyLimit: data.adjustOperatorDailyLimit,
        adjustServerPerTxLimit: data.adjustServerPerTxLimit,
      });
    }
  }, [data]);

  const save = async (): Promise<void> => {
    if (!limits) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await fetchApi(`/admin/programs/${programId}`, {
        method: "PATCH",
        body: JSON.stringify(limits),
      });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["program-settings", programId] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof Limits, value: number): void => {
    setLimits((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("programSettings.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("programSettings.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("programSettings.adjustmentLimits")}</CardTitle>
          <CardDescription>{t("programSettings.adjustmentLimitsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !limits ? (
            <p className="text-destructive">{t("programSettings.failedToLoad")}</p>
          ) : (
            <div className="space-y-6">
              <LimitField
                label={t("programSettings.operatorPerTx")}
                description={t("programSettings.operatorPerTxDescription")}
                value={limits.adjustOperatorPerTxLimit}
                onChange={(value) => {
                  update("adjustOperatorPerTxLimit", value);
                }}
              />
              <LimitField
                label={t("programSettings.operatorDaily")}
                description={t("programSettings.operatorDailyDescription")}
                value={limits.adjustOperatorDailyLimit}
                onChange={(value) => {
                  update("adjustOperatorDailyLimit", value);
                }}
              />
              <LimitField
                label={t("programSettings.serverPerTx")}
                description={t("programSettings.serverPerTxDescription")}
                value={limits.adjustServerPerTxLimit}
                onChange={(value) => {
                  update("adjustServerPerTxLimit", value);
                }}
              />
              <div className="flex items-center gap-3">
                <Button
                  disabled={saving}
                  onClick={() => {
                    void save();
                  }}
                >
                  {t("programSettings.save")}
                </Button>
                {saved && (
                  <span className="text-sm text-green-600">{t("programSettings.saved")}</span>
                )}
                {saveError && <span className="text-sm text-destructive">{saveError}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
