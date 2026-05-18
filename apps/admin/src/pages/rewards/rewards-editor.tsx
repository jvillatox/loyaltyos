import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

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
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

const rewardSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().optional().default(""),
  pointsCost: z.coerce.number().int().min(1, "Must be at least 1"),
  stock: z.coerce.number().int().min(0).optional().nullable(),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  category: z.string().optional().default(""),
  tierRequired: z.string().optional().default(""),
  isActive: z.boolean().optional().default(false),
});

type RewardFormData = z.infer<typeof rewardSchema>;

const CATEGORIES = [
  { value: "", label: "None" },
  { value: "DISCOUNT_FUTURE", label: "Discount" },
  { value: "PHYSICAL_PRODUCT", label: "Physical Product" },
  { value: "GIFT_CARD", label: "Gift Card" },
  { value: "EXPERIENCE", label: "Experience" },
  { value: "CHARITY_DONATION", label: "Charity Donation" },
  { value: "COALITION_TRANSFER", label: "Coalition Transfer" },
];

interface Tier {
  id: string;
  name: string;
  rank: number;
}

interface EligibilityPreview {
  eligible: boolean;
  reason?: string;
}

export function RewardsEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [previewMemberId, setPreviewMemberId] = useState("");
  const [previewResult, setPreviewResult] = useState<EligibilityPreview | null>(null);

  const form = useForm<RewardFormData>({
    resolver: zodResolver(rewardSchema),
    defaultValues: {
      name: "",
      description: "",
      pointsCost: 100,
      stock: null,
      imageUrl: "",
      category: "",
      tierRequired: "",
      isActive: false,
    },
  });

  const { data: existingReward } = useQuery<{
    name: string;
    description: string | null;
    pointsCost: number;
    stock: number | null;
    imageUrl: string | null;
    category: string | null;
    tierRequired: string | null;
    isActive: boolean;
  } | null>({
    queryKey: ["reward", id],
    queryFn: () => (id ? fetchApi(`/rewards/${id}`) : null),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingReward) {
      form.reset({
        name: existingReward.name,
        description: existingReward.description ?? "",
        pointsCost: existingReward.pointsCost,
        stock: existingReward.stock,
        imageUrl: existingReward.imageUrl ?? "",
        category: existingReward.category ?? "",
        tierRequired: existingReward.tierRequired ?? "",
        isActive: existingReward.isActive,
      });
    }
  }, [existingReward, form]);

  const { data: tiers } = useQuery<Tier[]>({
    queryKey: ["tiers"],
    queryFn: () => fetchApi<Tier[]>("/tiers"),
  });

  const mutation = useMutation({
    mutationFn: (data: RewardFormData) => {
      const body = {
        name: data.name,
        description: data.description,
        pointsCost: data.pointsCost,
        stock: data.stock ?? null,
        category: data.category !== "" ? data.category : null,
        tierRequired: data.tierRequired !== "" ? data.tierRequired : null,
        isActive: data.isActive,
      };
      return isEdit
        ? fetchApi(`/rewards/${id ?? ""}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : fetchApi("/rewards", {
            method: "POST",
            body: JSON.stringify(body),
          });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rewards"] });
      navigate("/rewards");
    },
  });

  const onSubmit = (data: RewardFormData): void => {
    mutation.mutate(data);
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void form.handleSubmit(onSubmit)(e);
  };

  const handlePreviewClick = (): void => {
    void previewEligibility();
  };

  const previewEligibility = async (): Promise<void> => {
    if (!previewMemberId || !id) return;
    try {
      const result = await fetchApi<EligibilityPreview>(
        `/rewards/${id}/eligibility?memberId=${encodeURIComponent(previewMemberId)}`,
      );
      setPreviewResult(result);
    } catch (err) {
      setPreviewResult({ eligible: false, reason: (err as Error).message });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/rewards">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "Edit Reward" : "New Reward"}</h1>
          <p className="text-sm text-muted-foreground">
            {isEdit ? "Update reward details" : "Create a new reward for your catalog"}
          </p>
        </div>
      </div>

      <form onSubmit={handleFormSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register("name")} placeholder="10% off next purchase" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Markdown)</Label>
              <Textarea
                id="description"
                {...form.register("description")}
                rows={4}
                placeholder="Get **10% off** your next online order..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pointsCost">Points Cost</Label>
                <Input
                  id="pointsCost"
                  type="number"
                  min={1}
                  {...form.register("pointsCost", { valueAsNumber: true })}
                />
                {form.formState.errors.pointsCost && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.pointsCost.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="stock">
                  Stock <span className="text-muted-foreground text-xs">(empty = unlimited)</span>
                </Label>
                <Input
                  id="stock"
                  type="number"
                  min={0}
                  {...form.register("stock", {
                    setValueAs: (v) => (v === "" ? null : Number(v)),
                  })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="imageUrl">Image URL</Label>
              <Input
                id="imageUrl"
                {...form.register("imageUrl")}
                placeholder="https://cdn.example.com/reward.png"
              />
              {form.watch("imageUrl") && (
                <img
                  src={form.watch("imageUrl")}
                  alt="Preview"
                  className="mt-2 h-32 w-32 rounded-md border object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={form.watch("category")}
                  onValueChange={(v) => {
                    form.setValue("category", v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tierRequired">
                  Tier Required <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Select
                  value={form.watch("tierRequired")}
                  onValueChange={(v) => {
                    form.setValue("tierRequired", v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All tiers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All tiers</SelectItem>
                    {(tiers ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {isEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Eligibility Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Member ID"
                  value={previewMemberId}
                  onChange={(e) => {
                    setPreviewMemberId(e.target.value);
                  }}
                />
                <Button type="button" variant="outline" onClick={handlePreviewClick}>
                  <Eye className="mr-1 h-4 w-4" />
                  Check
                </Button>
              </div>
              {previewResult && (
                <div
                  className={`rounded-md px-4 py-3 text-sm ${previewResult.eligible ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                >
                  {previewResult.eligible
                    ? "This member is eligible to redeem this reward."
                    : (previewResult.reason ?? "Not eligible")}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {mutation.isPending ? "Saving..." : isEdit ? "Update Reward" : "Create Reward"}
          </Button>
          <Button variant="outline" type="button" asChild>
            <Link to="/rewards">Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
