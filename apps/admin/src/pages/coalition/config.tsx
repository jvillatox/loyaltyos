import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  EyeOff,
  FlaskConical,
  Globe,
  Key,
  Link2,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "APPRECIO", label: "Apprecio" },
  { value: "GENERIC", label: "Generic" },
] as const;

const APPRECIO_COUNTRIES: { value: string; label: string; baseUrl: string }[] = [
  { value: "MX", label: "Mexico", baseUrl: "https://apiv2.dcanje.mx/api" },
  { value: "CL", label: "Chile", baseUrl: "https://api.apprecio.cl/api" },
  { value: "PE", label: "Peru", baseUrl: "https://api.apprecio.pe/api" },
  { value: "CO", label: "Colombia", baseUrl: "https://api.apprecio.co/api" },
  { value: "AR", label: "Argentina", baseUrl: "https://api.apprecio.com.ar/api" },
  { value: "CUSTOM", label: "Custom URL", baseUrl: "" },
];

const configFormSchema = z.object({
  provider: z.string().min(1),
  endpoint: z.string().min(1),
  publicToken: z.string().optional(),
  privateToken: z.string().optional(),
  identifierType: z.enum(["email", "rut"]).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  conversionRate: z.coerce.number().positive(),
  minConversionPoints: z.coerce.number().int().positive(),
  accumulationEnabled: z.boolean(),
  redemptionEnabled: z.boolean(),
  conversionEnabled: z.boolean(),
});

type ConfigFormValues = z.infer<typeof configFormSchema>;

interface CoalitionConfig {
  id: string;
  programId: string;
  provider: string;
  endpoint: string;
  encryptedCredentials: string;
  conversionRate: number;
  accumulationEnabled: boolean;
  redemptionEnabled: boolean;
  conversionEnabled: boolean;
  minConversionPoints: number;
  createdAt: string;
  updatedAt: string;
}

interface AdapterCapabilities {
  accumulate: boolean;
  redeem: boolean;
  convert: boolean;
  reverseTransaction: boolean;
  historyQuery: boolean;
}

interface HealthcheckResult {
  ok: boolean;
  latencyMs?: number;
  details?: unknown;
}

export function CoalitionConfigPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [showPrivateToken, setShowPrivateToken] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string>("MX");
  const [healthcheckResult, setHealthcheckResult] = useState<HealthcheckResult | null>(null);

  const { data: config } = useQuery({
    queryKey: ["coalition-config"],
    queryFn: () => fetchApi<CoalitionConfig | null>("/admin/coalition/config"),
  });

  const { data: capabilities, isLoading: capsLoading } = useQuery({
    queryKey: ["coalition-capabilities"],
    queryFn: () => fetchApi<AdapterCapabilities>("/admin/coalition/capabilities"),
  });

  const form = useForm<ConfigFormValues>({
    resolver: zodResolver(configFormSchema),
    defaultValues: {
      provider: "APPRECIO",
      endpoint: APPRECIO_COUNTRIES[0]?.baseUrl ?? "https://apiv2.dcanje.mx/api",
      publicToken: "",
      privateToken: "",
      identifierType: "email",
      timeoutMs: 10000,
      conversionRate: 1,
      minConversionPoints: 500,
      accumulationEnabled: false,
      redemptionEnabled: false,
      conversionEnabled: false,
    },
    values: config
      ? {
          provider: config.provider,
          endpoint: config.endpoint,
          conversionRate: config.conversionRate,
          accumulationEnabled: config.accumulationEnabled,
          redemptionEnabled: config.redemptionEnabled,
          conversionEnabled: config.conversionEnabled,
          minConversionPoints: config.minConversionPoints,
        }
      : undefined,
  });

  const provider = form.watch("provider");

  const saveMutation = useMutation({
    mutationFn: (values: ConfigFormValues) => {
      const credentials: Record<string, unknown> = {};
      if (values.provider === "APPRECIO") {
        credentials.publicToken = values.publicToken ?? "";
        credentials.privateToken = values.privateToken ?? "";
        credentials.identifierType = values.identifierType ?? "email";
        credentials.timeoutMs = values.timeoutMs ?? 10000;
      }
      return fetchApi<CoalitionConfig>("/admin/coalition/config", {
        method: "PUT",
        body: JSON.stringify({
          provider: values.provider,
          endpoint: values.endpoint,
          credentials,
          conversionRate: values.conversionRate,
          accumulationEnabled: values.accumulationEnabled,
          redemptionEnabled: values.redemptionEnabled,
          conversionEnabled: values.conversionEnabled,
          minConversionPoints: values.minConversionPoints,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["coalition-config"] });
    },
  });

  const healthcheckMutation = useMutation({
    mutationFn: () =>
      fetchApi<HealthcheckResult>("/admin/coalition/healthcheck", { method: "POST" }),
    onSuccess: (data) => {
      setHealthcheckResult(data);
      void queryClient.invalidateQueries({ queryKey: ["coalition-capabilities"] });
    },
  });

  const handleCountryChange = (value: string) => {
    setSelectedCountry(value);
    const country = APPRECIO_COUNTRIES.find((c) => c.value === value);
    if (country?.baseUrl) {
      form.setValue("endpoint", country.baseUrl);
    }
  };

  function onSubmit(values: ConfigFormValues): void {
    saveMutation.mutate(values);
  }

  const CapabilityBadge = ({ label, supported }: { label: string; supported: boolean }) => (
    <Badge variant={supported ? "default" : "secondary"} className="gap-1">
      {supported ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Coalition Configuration</h1>
          <p className="mt-1 text-muted-foreground">
            Configure external coalition provider settings and credentials.
          </p>
        </div>
      </div>

      {/* Capabilities Banner */}
      {capsLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-24" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : capabilities ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Adapter Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <CapabilityBadge label="Accumulate" supported={capabilities.accumulate} />
              <CapabilityBadge label="Redeem" supported={capabilities.redeem} />
              <CapabilityBadge label="Convert" supported={capabilities.convert} />
              <CapabilityBadge label="Reverse" supported={capabilities.reverseTransaction} />
              <CapabilityBadge label="History" supported={capabilities.historyQuery} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              Save a configuration first to see adapter capabilities.
            </p>
          </CardContent>
        </Card>
      )}

      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Provider Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Provider</CardTitle>
            <CardDescription>
              Select the external coalition provider to integrate with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  form.setValue("provider", v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Apprecio-Specific Configuration */}
        {provider === "APPRECIO" && (
          <Card>
            <CardHeader>
              <CardTitle>Apprecio Connection</CardTitle>
              <CardDescription>Configure the Apprecio API connection details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Select value={selectedCountry} onValueChange={handleCountryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {APPRECIO_COUNTRIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="endpoint">API Base URL</Label>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="endpoint"
                    {...form.register("endpoint")}
                    placeholder="https://apiv2.dcanje.mx/api"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publicToken">Public Token</Label>
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="publicToken"
                    {...form.register("publicToken")}
                    placeholder="Enter public token"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="privateToken">Private Token</Label>
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <div className="relative flex-1">
                    <Input
                      id="privateToken"
                      type={showPrivateToken ? "text" : "password"}
                      {...form.register("privateToken")}
                      placeholder="Enter private token"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => {
                        setShowPrivateToken(!showPrivateToken);
                      }}
                    >
                      {showPrivateToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Identifier Type</Label>
                <RadioGroup
                  value={form.watch("identifierType") ?? "email"}
                  onValueChange={(v) => {
                    form.setValue("identifierType", v as "email" | "rut");
                  }}
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="email" id="id-email" />
                    <Label htmlFor="id-email" className="cursor-pointer">
                      Email
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="rut" id="id-rut" />
                    <Label htmlFor="id-rut" className="cursor-pointer">
                      RUT
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeoutMs">Timeout (ms)</Label>
                <Input
                  id="timeoutMs"
                  type="number"
                  {...form.register("timeoutMs")}
                  placeholder="10000"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Generic Provider Configuration */}
        {provider === "GENERIC" && (
          <Card>
            <CardHeader>
              <CardTitle>Generic Connection</CardTitle>
              <CardDescription>Configure the generic coalition API endpoint.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="endpoint">API Endpoint URL</Label>
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="endpoint"
                    {...form.register("endpoint")}
                    placeholder="https://your-coalition-api.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Conversion Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Conversion</CardTitle>
            <CardDescription>Configure how own points convert to coalition points.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="conversionRate">Conversion Rate</Label>
                <Input
                  id="conversionRate"
                  type="number"
                  step="0.01"
                  {...form.register("conversionRate")}
                />
                <p className="text-xs text-muted-foreground">
                  Own points × rate = coalition points
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="minConversionPoints">Minimum Points</Label>
                <Input
                  id="minConversionPoints"
                  type="number"
                  {...form.register("minConversionPoints")}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum own points required to convert
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feature Toggles */}
        <Card>
          <CardHeader>
            <CardTitle>Features</CardTitle>
            <CardDescription>Enable or disable coalition operations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TooltipProvider>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="accumulationEnabled">Accumulation</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow members to earn coalition points
                  </p>
                </div>
                <Switch
                  id="accumulationEnabled"
                  checked={form.watch("accumulationEnabled")}
                  onCheckedChange={(v) => {
                    form.setValue("accumulationEnabled", v);
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="redemptionEnabled">Redemption</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow members to redeem coalition points
                  </p>
                </div>
                {capabilities && !capabilities.redeem ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Switch id="redemptionEnabled" disabled checked={false} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>This adapter does not support redemption</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Switch
                    id="redemptionEnabled"
                    checked={form.watch("redemptionEnabled")}
                    onCheckedChange={(v) => {
                      form.setValue("redemptionEnabled", v);
                    }}
                  />
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="conversionEnabled">Conversion</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow members to convert own points to coalition points
                  </p>
                </div>
                <Switch
                  id="conversionEnabled"
                  checked={form.watch("conversionEnabled")}
                  onCheckedChange={(v) => {
                    form.setValue("conversionEnabled", v);
                  }}
                />
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Configuration
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              healthcheckMutation.mutate();
            }}
            disabled={healthcheckMutation.isPending}
          >
            {healthcheckMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-4 w-4" />
            )}
            Test Connection
          </Button>
        </div>

        {/* Save Status */}
        {saveMutation.isSuccess && (
          <p className="text-sm text-green-600">Configuration saved successfully.</p>
        )}
        {saveMutation.isError && (
          <p className="text-sm text-destructive">
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Failed to save configuration"}
          </p>
        )}

        {/* Healthcheck Result */}
        {healthcheckResult && (
          <Card className={cn(healthcheckResult.ok ? "border-green-600" : "border-destructive")}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Connection Test: {healthcheckResult.ok ? "Success" : "Failed"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-sm">
                {healthcheckResult.latencyMs != null && (
                  <p>
                    Latency: <span className="font-mono">{healthcheckResult.latencyMs}ms</span>
                  </p>
                )}
                {healthcheckResult.details != null && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(healthcheckResult.details, null, 2)}
                  </pre>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        {healthcheckMutation.isError && (
          <p className="text-sm text-destructive">
            {healthcheckMutation.error instanceof Error
              ? healthcheckMutation.error.message
              : "Healthcheck failed"}
          </p>
        )}
      </form>
    </div>
  );
}
