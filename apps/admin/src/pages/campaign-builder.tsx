import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Cake,
  Check,
  Gift,
  Heart,
  Repeat,
  Save,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { CampaignEstimate, CampaignType, PaginatedResponse, Segment } from "@/types";

const CAMPAIGN_TYPES: {
  value: CampaignType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}[] = [
  {
    value: "BONUS_POINTS",
    label: "Bonus Points",
    icon: Star,
    desc: "Award extra points on qualifying events",
  },
  {
    value: "SPEND_AND_GET",
    label: "Spend & Get",
    icon: Gift,
    desc: "Bonus points proportional to transaction amount",
  },
  {
    value: "FREQUENCY",
    label: "Frequency",
    icon: Repeat,
    desc: "Reward members after N repeat actions",
  },
  {
    value: "MILESTONE",
    label: "Milestone",
    icon: TrendingUp,
    desc: "Award when hitting a cumulative target",
  },
  {
    value: "REFERRAL",
    label: "Referral",
    icon: Users,
    desc: "Reward both referrer and referred member",
  },
  {
    value: "BIRTHDAY",
    label: "Birthday",
    icon: Cake,
    desc: "Bonus points during the member's birth month",
  },
  {
    value: "ANNIVERSARY",
    label: "Anniversary",
    icon: Heart,
    desc: "Bonus on the membership anniversary date",
  },
  {
    value: "FLASH_SALE",
    label: "Flash Sale",
    icon: Zap,
    desc: "Limited-time multiplier on all purchases",
  },
  {
    value: "TIER_UPGRADE_BONUS",
    label: "Tier Upgrade",
    icon: TrendingUp,
    desc: "One-time award when member reaches a new tier",
  },
];

const CHANNELS = ["EMAIL", "SMS", "PUSH", "IN_APP", "WEBHOOK"] as const;

const wizardSchema = z.object({
  type: z.enum([
    "BONUS_POINTS",
    "SPEND_AND_GET",
    "FREQUENCY",
    "MILESTONE",
    "REFERRAL",
    "BIRTHDAY",
    "ANNIVERSARY",
    "FLASH_SALE",
    "TIER_UPGRADE_BONUS",
  ]),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  segmentId: z.string().optional(),
  maxUsesPerMember: z.coerce.number().int().min(0).optional(),
  multiplier: z.coerce.number().min(0).optional(),
  maxBudget: z.coerce.number().int().min(0).optional(),
  isStackable: z.boolean().optional(),
  abTesting: z.boolean().optional(),
  channels: z.array(z.string()).optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

type WizardData = z.infer<typeof wizardSchema>;

const STEPS = ["Type", "Audience", "Rules", "Channels", "Dates", "Review"];

export function CampaignBuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      type: "BONUS_POINTS",
      name: "",
      description: "",
      multiplier: 1,
      isStackable: false,
      abTesting: false,
      channels: [],
    },
  });

  const { data: segmentsData } = useQuery({
    queryKey: ["segments-list"],
    queryFn: () => fetchApi<PaginatedResponse<Segment>>("/admin/segments?pageSize=100"),
  });

  const [estimate, setEstimate] = useState<CampaignEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  const selectedType = CAMPAIGN_TYPES.find((t) => t.value === form.watch("type"));

  const handleEstimate = async () => {
    setEstimating(true);
    try {
      const values = form.getValues();
      const res = await fetchApi<CampaignEstimate>("/admin/campaigns/estimate", {
        method: "POST",
        body: JSON.stringify({
          type: values.type,
          multiplier: values.multiplier ?? 1,
          maxBudget: values.maxBudget,
          programId: "prog_dev",
        }),
      });
      setEstimate(res);
    } catch {
      setError("Failed to estimate impact");
    } finally {
      setEstimating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = form.getValues();
      const payload = {
        name: values.name,
        description: values.description,
        type: values.type,
        multiplier: values.multiplier,
        maxBudget: values.maxBudget ?? undefined,
        maxUsesPerMember: values.maxUsesPerMember ?? undefined,
        isStackable: values.isStackable ?? false,
        abTesting: values.abTesting ?? false,
        channels: values.channels ?? [],
        startsAt: values.startsAt ?? undefined,
        endsAt: values.endsAt ?? undefined,
      };

      if (isEdit) {
        await fetchApi(`/admin/campaigns/${String(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApi("/admin/campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      navigate("/campaigns");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const prev = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/campaigns");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <h1 className="text-3xl font-bold">{isEdit ? "Edit Campaign" : "New Campaign"}</h1>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setStep(i);
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors",
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step ? <Check className="mr-1 inline h-3 w-3" /> : null}
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: Type */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Campaign Type</CardTitle>
            <CardDescription>Choose the type of campaign you want to create.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={form.watch("type")}
              onValueChange={(v) => {
                form.setValue("type", v as CampaignType);
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {CAMPAIGN_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <Label
                      key={t.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-accent",
                        form.watch("type") === t.value && "border-primary bg-accent",
                      )}
                    >
                      <RadioGroupItem value={t.value} className="mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2 font-medium">
                          <Icon className="h-4 w-4 text-primary" />
                          {t.label}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
                      </div>
                    </Label>
                  );
                })}
              </div>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Audience */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Audience</CardTitle>
            <CardDescription>Select the target segment and per-member limits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Target Segment</Label>
              <Select
                value={form.watch("segmentId") ?? "all"}
                onValueChange={(v) => {
                  form.setValue("segmentId", v === "all" ? undefined : v);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  {segmentsData?.items.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.type === "STATIC" ? s.memberIds.length : "dynamic"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Campaign Name</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g. Welcome Bonus" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                {...form.register("description")}
                placeholder="Describe what this campaign does..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUses">Max Uses Per Member</Label>
              <Input
                id="maxUses"
                type="number"
                {...form.register("maxUsesPerMember")}
                placeholder="Unlimited"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Rules */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Campaign Rules</CardTitle>
            <CardDescription>
              Configure the point multiplier, budget, and stacking behavior.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="multiplier">Point Multiplier</Label>
              <Input id="multiplier" type="number" step="0.1" {...form.register("multiplier")} />
              <p className="text-sm text-muted-foreground">
                Earned points are multiplied by this value (1x = no change)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget">Max Budget (points)</Label>
              <Input
                id="budget"
                type="number"
                {...form.register("maxBudget")}
                placeholder="No limit"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Stackable</Label>
                <p className="text-sm text-muted-foreground">
                  Allow this campaign to stack with others
                </p>
              </div>
              <Switch
                checked={form.watch("isStackable")}
                onCheckedChange={(v) => {
                  form.setValue("isStackable", v);
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>A/B Testing</Label>
                <p className="text-sm text-muted-foreground">
                  Create variants to test different configurations
                </p>
              </div>
              <Switch
                checked={form.watch("abTesting")}
                onCheckedChange={(v) => {
                  form.setValue("abTesting", v);
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Channels */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Channels</CardTitle>
            <CardDescription>Select which channels this campaign applies to.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {CHANNELS.map((ch) => (
                <div key={ch} className="flex items-center gap-3">
                  <Checkbox
                    id={`ch-${ch}`}
                    checked={(form.watch("channels") ?? []).includes(ch)}
                    onCheckedChange={(checked) => {
                      const current = form.watch("channels") ?? [];
                      if (checked) {
                        form.setValue("channels", [...current, ch]);
                      } else {
                        form.setValue(
                          "channels",
                          current.filter((c) => c !== ch),
                        );
                      }
                    }}
                  />
                  <Label htmlFor={`ch-${ch}`}>{ch}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Dates */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Set optional start and end dates for the campaign.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="startsAt">Start Date</Label>
              <Input id="startsAt" type="datetime-local" {...form.register("startsAt")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endsAt">End Date</Label>
              <Input id="endsAt" type="datetime-local" {...form.register("endsAt")} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 6: Review */}
      {step === 5 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Review Campaign</CardTitle>
              <CardDescription>Verify all details before creating.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd className="font-medium">{selectedType?.label ?? form.watch("type")}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{form.watch("name") || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Multiplier</dt>
                  <dd className="font-medium">{form.watch("multiplier") ?? 1}x</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Budget</dt>
                  <dd className="font-medium">
                    {form.watch("maxBudget") != null
                      ? `${(form.watch("maxBudget") ?? 0).toLocaleString()} pts`
                      : "Unlimited"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Stackable</dt>
                  <dd className="font-medium">{form.watch("isStackable") ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">A/B Testing</dt>
                  <dd className="font-medium">{form.watch("abTesting") ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Channels</dt>
                  <dd className="font-medium">
                    {(form.watch("channels") ?? []).length > 0
                      ? (form.watch("channels") ?? []).join(", ")
                      : "All"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Impact estimation */}
          <Card>
            <CardHeader>
              <CardTitle>Estimated Impact</CardTitle>
            </CardHeader>
            <CardContent>
              {estimating ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : estimate ? (
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">
                      {estimate.eligibleMembers.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Eligible Members</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">
                      {estimate.projectedPoints.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Projected Points</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{estimate.budgetUtilization}%</p>
                    <p className="text-sm text-muted-foreground">Budget Utilization</p>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    void handleEstimate();
                  }}
                >
                  Calculate Estimate
                </Button>
              )}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : isEdit ? "Update Campaign" : "Create Campaign"}
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={step === 0}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={next}>
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
