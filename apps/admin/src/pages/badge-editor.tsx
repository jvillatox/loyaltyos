import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, Save } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";

const badgeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["ACHIEVEMENT", "STATUS", "TEMPORAL", "COLLECTIBLE", "SOCIAL"]),
  imageUrl: z.string().optional(),
  conditions: z.string().optional(),
  seriesId: z.string().optional(),
  seriesPosition: z.coerce.number().int().min(1).optional(),
  isActive: z.boolean().default(true),
});

type BadgeFormData = z.infer<typeof badgeSchema>;

interface BadgeDetail {
  id: string;
  name: string;
  description?: string;
  type: string;
  imageUrl?: string;
  tierId?: string;
  conditions?: unknown;
  seriesId?: string;
  seriesPosition?: number;
  isActive: boolean;
}

const BADGE_TYPES = [
  { value: "ACHIEVEMENT", label: "Achievement", desc: "Unlocked by meeting specific criteria" },
  { value: "STATUS", label: "Status", desc: "Reflects a member's current status" },
  { value: "TEMPORAL", label: "Temporal", desc: "Available for a limited time" },
  { value: "COLLECTIBLE", label: "Collectible", desc: "Part of a collectible series" },
  { value: "SOCIAL", label: "Social", desc: "Earned through social or community actions" },
];

export function BadgeEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: badge, isLoading } = useQuery({
    queryKey: ["badge", id],
    queryFn: () => fetchApi<BadgeDetail>(`/admin/badges/${id ?? ""}`),
    enabled: isEditing,
  });

  const form = useForm<BadgeFormData>({
    resolver: zodResolver(badgeSchema),
    defaultValues: {
      name: "",
      description: "",
      type: "ACHIEVEMENT",
      imageUrl: "",
      conditions: "{}",
      seriesId: "",
      isActive: true,
    },
  });

  // Load existing badge data into form
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (badge && badge.id !== loadedId) {
    setLoadedId(badge.id);
    form.reset({
      name: badge.name,
      description: badge.description ?? "",
      type: badge.type as BadgeFormData["type"],
      imageUrl: badge.imageUrl ?? "",
      conditions: badge.conditions ? JSON.stringify(badge.conditions, null, 2) : "{}",
      seriesId: badge.seriesId ?? "",
      seriesPosition: badge.seriesPosition ?? undefined,
      isActive: badge.isActive,
    });
  }

  const onSubmit = async (data: BadgeFormData) => {
    let conditions: unknown = {};
    try {
      conditions = JSON.parse(data.conditions ?? "{}");
    } catch {
      // Keep as string
    }

    const payload = {
      ...data,
      conditions,
      conditionsStr: undefined,
    };

    if (isEditing) {
      await fetchApi(`/admin/badges/${id ?? ""}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await fetchApi("/admin/badges", {
        method: "POST",
        body: JSON.stringify({ ...payload, isActive: undefined }),
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["badges"] });
    navigate("/badges");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            navigate("/badges");
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold">{isEditing ? "Edit Badge" : "New Badge"}</h1>
      </div>

      {isEditing && isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>Badge Details</CardTitle>
              <CardDescription>Configure the badge name, type, and appearance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" {...form.register("name")} placeholder="e.g. First Purchase" />
                  {form.formState.errors.name && (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type *</Label>
                  <Select
                    value={form.watch("type")}
                    onValueChange={(v) => {
                      form.setValue("type", v as BadgeFormData["type"]);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BADGE_TYPES.map((bt) => (
                        <SelectItem key={bt.value} value={bt.value}>
                          {bt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...form.register("description")}
                  placeholder="Brief description of this badge"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="imageUrl">Image URL</Label>
                  <Input id="imageUrl" {...form.register("imageUrl")} placeholder="https://..." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seriesId">Series ID</Label>
                  <Input
                    id="seriesId"
                    {...form.register("seriesId")}
                    placeholder="e.g. mega-saver"
                  />
                </div>
              </div>
              {form.watch("seriesId") && (
                <div className="space-y-2">
                  <Label htmlFor="seriesPosition">Series Position</Label>
                  <Input
                    id="seriesPosition"
                    type="number"
                    {...form.register("seriesPosition")}
                    placeholder="1"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conditions</CardTitle>
              <CardDescription>
                Define rules for when this badge is awarded. Uses the same rule format as Segments.
                Leave empty for manually-awarded badges.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="conditions">Rules (JSON)</Label>
                <Textarea
                  id="conditions"
                  {...form.register("conditions")}
                  placeholder='{"all":[{"field":"totalSpent","gte":10000}]}'
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>
              {isEditing && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.watch("isActive")}
                    onCheckedChange={(v) => {
                      form.setValue("isActive", v);
                    }}
                  />
                  <Label>Active</Label>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 rounded-lg border p-6">
                {form.watch("imageUrl") ? (
                  <img
                    src={form.watch("imageUrl")}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <Award className="h-16 w-16 text-muted-foreground" />
                )}
                <div>
                  <p className="text-lg font-semibold">{form.watch("name") || "Badge Name"}</p>
                  <p className="text-sm text-muted-foreground">
                    {form.watch("description") ?? "No description"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Type: {form.watch("type")}
                    {form.watch("seriesId") &&
                      ` · Series: ${String(form.watch("seriesId"))} #${String(form.watch("seriesPosition") ?? "-")}`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="submit">
              <Save className="mr-2 h-4 w-4" />
              {isEditing ? "Update Badge" : "Create Badge"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigate("/badges");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
