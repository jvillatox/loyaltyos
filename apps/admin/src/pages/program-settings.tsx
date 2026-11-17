import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { fetchApi } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";

type ExpiryMode = "NONE" | "INACTIVITY" | "PER_LOT";

interface ProgramSettingsData {
  id: string;
  name: string;
  adjustOperatorPerTxLimit: number;
  adjustOperatorDailyLimit: number;
  adjustServerPerTxLimit: number;
  holdDays: number;
  expiryMode: ExpiryMode;
  expiryMonths: number;
}

interface SettingsForm {
  adjustOperatorPerTxLimit: number;
  adjustOperatorDailyLimit: number;
  adjustServerPerTxLimit: number;
  holdDays: number;
  expiryMode: ExpiryMode;
  expiryMonths: number;
}

function NumberField({
  label,
  description,
  value,
  onChange,
  min = 1,
  max,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
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
  const [settings, setSettings] = useState<SettingsForm | null>(null);
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
      setSettings({
        adjustOperatorPerTxLimit: data.adjustOperatorPerTxLimit,
        adjustOperatorDailyLimit: data.adjustOperatorDailyLimit,
        adjustServerPerTxLimit: data.adjustServerPerTxLimit,
        holdDays: data.holdDays,
        expiryMode: data.expiryMode,
        expiryMonths: data.expiryMonths,
      });
    }
  }, [data]);

  const save = async (): Promise<void> => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await fetchApi(`/admin/programs/${programId}`, {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["program-settings", programId] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof SettingsForm, value: number): void => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  };

  const setExpiryMode = (mode: ExpiryMode): void => {
    setSettings((prev) => (prev ? { ...prev, expiryMode: mode } : prev));
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
          <CardTitle>{t("programSettings.holdPeriod")}</CardTitle>
          <CardDescription>{t("programSettings.holdPeriodDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !settings ? (
            <p className="text-destructive">{t("programSettings.failedToLoad")}</p>
          ) : (
            <div className="space-y-6">
              <NumberField
                label={t("programSettings.holdDays")}
                description={t("programSettings.holdDaysDescription")}
                value={settings.holdDays}
                min={0}
                max={90}
                onChange={(value) => {
                  update("holdDays", value);
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

      <Card>
        <CardHeader>
          <CardTitle>{t("programSettings.pointExpiry")}</CardTitle>
          <CardDescription>{t("programSettings.pointExpiryDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError || !settings ? (
            <p className="text-destructive">{t("programSettings.failedToLoad")}</p>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>{t("programSettings.expiryMode")}</Label>
                <Select value={settings.expiryMode} onValueChange={setExpiryMode}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t("programSettings.expiryModeNone")}</SelectItem>
                    <SelectItem value="INACTIVITY">
                      {t("programSettings.expiryModeInactivity")}
                    </SelectItem>
                    <SelectItem value="PER_LOT">{t("programSettings.expiryModePerLot")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {settings.expiryMode !== "NONE" && (
                <NumberField
                  label={t("programSettings.expiryMonths")}
                  description={
                    settings.expiryMode === "PER_LOT"
                      ? t("programSettings.expiryMonthsPerLotDescription")
                      : t("programSettings.expiryMonthsInactivityDescription")
                  }
                  value={settings.expiryMonths}
                  min={1}
                  max={60}
                  onChange={(value) => {
                    update("expiryMonths", value);
                  }}
                />
              )}
              <p className="text-sm text-muted-foreground">
                {t("programSettings.expiryExplanation")}
              </p>
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
          ) : isError || !settings ? (
            <p className="text-destructive">{t("programSettings.failedToLoad")}</p>
          ) : (
            <div className="space-y-6">
              <NumberField
                label={t("programSettings.operatorPerTx")}
                description={t("programSettings.operatorPerTxDescription")}
                value={settings.adjustOperatorPerTxLimit}
                onChange={(value) => {
                  update("adjustOperatorPerTxLimit", value);
                }}
              />
              <NumberField
                label={t("programSettings.operatorDaily")}
                description={t("programSettings.operatorDailyDescription")}
                value={settings.adjustOperatorDailyLimit}
                onChange={(value) => {
                  update("adjustOperatorDailyLimit", value);
                }}
              />
              <NumberField
                label={t("programSettings.serverPerTx")}
                description={t("programSettings.serverPerTxDescription")}
                value={settings.adjustServerPerTxLimit}
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
