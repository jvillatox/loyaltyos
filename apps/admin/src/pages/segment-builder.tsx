import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, GripVertical, Plus, Save, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import type { RuleCondition, RuleGroup, Segment, SegmentMemberCount, SegmentType } from "@/types";

const FIELD_OPTIONS = [
  { value: "email", label: "Email", operators: ["contains", "eq"] },
  { value: "phone", label: "Phone", operators: ["contains", "eq"] },
  { value: "firstName", label: "First Name", operators: ["contains", "eq"] },
  { value: "lastName", label: "Last Name", operators: ["contains", "eq"] },
  { value: "tags", label: "Tags", operators: ["contains"] },
  { value: "currentTier", label: "Current Tier", operators: ["eq", "neq"] },
  { value: "totalSpent", label: "Total Spent", operators: ["gt", "lt", "gte", "lte", "between"] },
  { value: "joinedAt", label: "Joined At", operators: ["gt", "lt", "between"] },
] as const;

const OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  lt: "less than",
  gte: "greater or equal",
  lte: "less or equal",
  in: "in",
  between: "between",
  contains: "contains",
};

interface ConditionRow {
  id: string;
  field: string;
  operator: string;
  value: string;
  value2?: string;
}

interface RuleGroupRow {
  id: string;
  mode: "all" | "any";
  conditions: ConditionRow[];
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function rowsToRuleGroup(groups: RuleGroupRow[]): RuleGroup | undefined {
  const rules = groups
    .filter((g) => g.conditions.length > 0)
    .map((g) => {
      const conditions: RuleCondition[] = g.conditions
        .filter((c) => c.field && c.value)
        .map((c) => {
          const cond: RuleCondition = { field: c.field };
          const val = isNaN(Number(c.value)) ? c.value : Number(c.value);
          if (c.operator === "between" && c.value2) {
            cond.between = [Number(c.value), Number(c.value2)];
          } else if (c.operator === "in") {
            cond.in = c.value.split(",").map((s) => s.trim());
          } else {
            (cond as unknown as Record<string, unknown>)[c.operator] = val;
          }
          return cond;
        });
      if (conditions.length === 0) return null;
      const result: RuleGroup = {};
      result[g.mode] = conditions;
      return result;
    })
    .filter(Boolean) as RuleGroup[];

  if (rules.length === 0) return undefined;
  if (rules.length === 1) return rules[0];
  return { all: rules };
}

function ruleGroupToRows(rule: RuleGroup | null): RuleGroupRow[] {
  if (!rule) return [{ id: makeId(), mode: "all", conditions: [] }];
  const groups: RuleGroupRow[] = [];

  const extractGroup = (rg: RuleGroup): void => {
    if (rg.all) {
      groups.push({
        id: makeId(),
        mode: "all",
        conditions: rg.all.map((item) => {
          if ("field" in item) {
            const c = item;
            const op = Object.keys(c).find((k) => k !== "field") ?? "eq";
            const val = c[op as keyof RuleCondition];
            let valueStr = "";
            if (op === "between" && Array.isArray(val)) {
              valueStr = String(val[0]);
              return {
                id: makeId(),
                field: c.field,
                operator: op,
                value: valueStr,
                value2: String(val[1]),
              };
            }
            if (Array.isArray(val)) {
              valueStr = val.join(", ");
            } else if (val !== undefined && val !== null) {
              valueStr = String(val);
            }
            return { id: makeId(), field: c.field, operator: op, value: valueStr };
          }
          return { id: makeId(), field: "", operator: "eq", value: "" };
        }),
      });
    }
    if (rg.any) {
      groups.push({
        id: makeId(),
        mode: "any",
        conditions: rg.any.map((item) => {
          if ("field" in item) {
            const c = item;
            const op = Object.keys(c).find((k) => k !== "field") ?? "eq";
            const val = c[op as keyof RuleCondition];
            let valueStr = "";
            if (op === "between" && Array.isArray(val)) {
              valueStr = String(val[0]);
              return {
                id: makeId(),
                field: c.field,
                operator: op,
                value: valueStr,
                value2: String(val[1]),
              };
            }
            if (Array.isArray(val)) {
              valueStr = val.join(", ");
            } else if (val !== undefined && val !== null) {
              valueStr = String(val);
            }
            return { id: makeId(), field: c.field, operator: op, value: valueStr };
          }
          return { id: makeId(), field: "", operator: "eq", value: "" };
        }),
      });
    }
  };

  extractGroup(rule);
  return groups.length > 0 ? groups : [{ id: makeId(), mode: "all", conditions: [] }];
}

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["STATIC", "DYNAMIC"]),
  memberIds: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function SegmentBuilderPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<RuleGroupRow[]>([
    { id: makeId(), mode: "all", conditions: [] },
  ]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "", type: "DYNAMIC", memberIds: "" },
  });

  const { data: segmentData } = useQuery({
    queryKey: ["segment", id],
    queryFn: () => fetchApi<Segment>(`/admin/segments/${String(id)}`),
    enabled: isEdit && Boolean(id),
  });

  // Pre-fill form when editing
  const [prefilled, setPrefilled] = useState(false);
  if (isEdit && segmentData && !prefilled) {
    setPrefilled(true);
    form.reset({
      name: segmentData.name,
      description: segmentData.description ?? "",
      type: segmentData.type,
      memberIds: segmentData.memberIds.join("\n"),
    });
    if (segmentData.type === "DYNAMIC") {
      setGroups(ruleGroupToRows(segmentData.rules));
    }
  }

  const addCondition = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: [...g.conditions, { id: makeId(), field: "", operator: "eq", value: "" }],
            }
          : g,
      ),
    );
  };

  const removeCondition = (groupId: string, condId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, conditions: g.conditions.filter((c) => c.id !== condId) } : g,
      ),
    );
  };

  const updateCondition = (
    groupId: string,
    condId: string,
    field: keyof ConditionRow,
    value: string,
  ) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.id === condId
                  ? { ...c, [field]: value, ...(field === "field" ? { operator: "eq" } : {}) }
                  : c,
              ),
            }
          : g,
      ),
    );
  };

  const addGroup = () => {
    setGroups((prev) => [
      ...prev,
      {
        id: makeId(),
        mode: "all",
        conditions: [{ id: makeId(), field: "", operator: "eq", value: "" }],
      },
    ]);
  };

  const removeGroup = (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  };

  const toggleGroupMode = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, mode: g.mode === "all" ? "any" : "all" } : g)),
    );
  };

  const handleEstimate = async () => {
    setCounting(true);
    try {
      const rules = rowsToRuleGroup(groups);
      const res = await fetchApi<SegmentMemberCount>("/admin/segments/estimate", {
        method: "POST",
        body: JSON.stringify({ rules }),
      });
      setMemberCount(res.count);
    } catch {
      // ignore
    } finally {
      setCounting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const values = form.getValues();
      const rules = values.type === "DYNAMIC" ? rowsToRuleGroup(groups) : undefined;
      const memberIds =
        values.type === "STATIC" && values.memberIds
          ? values.memberIds
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;

      const payload = {
        name: values.name,
        description: values.description,
        type: values.type,
        rules,
        memberIds,
      };

      if (isEdit) {
        await fetchApi(`/admin/segments/${String(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApi("/admin/segments", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["segments"] });
      navigate("/segments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save segment");
    } finally {
      setSaving(false);
    }
  };

  const segmentType = form.watch("type");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigate("/segments");
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <h1 className="text-3xl font-bold">{isEdit ? "Edit Segment" : "New Segment"}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Segment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g. High Spenders" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Tabs
                value={segmentType}
                onValueChange={(v) => {
                  form.setValue("type", v as SegmentType);
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="DYNAMIC" className="flex-1">
                    Dynamic
                  </TabsTrigger>
                  <TabsTrigger value="STATIC" className="flex-1">
                    Static
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              {...form.register("description")}
              placeholder="Describe this segment..."
            />
          </div>
        </CardContent>
      </Card>

      {segmentType === "DYNAMIC" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Rule Builder</CardTitle>
              <CardDescription>Define conditions that members must match.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleEstimate();
                }}
                disabled={counting}
              >
                <Users className="mr-2 h-4 w-4" />
                {counting
                  ? "Counting..."
                  : memberCount != null
                    ? `${String(memberCount)} members`
                    : "Estimate Count"}
              </Button>
              <Button variant="outline" size="sm" onClick={addGroup}>
                <Plus className="mr-2 h-4 w-4" /> Add Group
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion type="multiple" defaultValue={groups.map((g) => g.id)}>
              {groups.map((group, gi) => (
                <AccordionItem key={group.id} value={group.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs font-bold uppercase"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupMode(group.id);
                        }}
                      >
                        {group.mode === "all" ? "AND" : "OR"}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Group {gi + 1} —{" "}
                        {group.mode === "all"
                          ? "All conditions must match"
                          : "Any condition must match"}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 px-1 pt-2">
                    {group.conditions.map((cond) => {
                      const fieldDef = FIELD_OPTIONS.find((f) => f.value === cond.field);
                      const operators = fieldDef?.operators ?? ["eq"];

                      return (
                        <div key={cond.id} className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                          <Select
                            value={cond.field}
                            onValueChange={(v) => {
                              updateCondition(group.id, cond.id, "field", v);
                            }}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue placeholder="Field..." />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_OPTIONS.map((f) => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={cond.operator}
                            onValueChange={(v) => {
                              updateCondition(group.id, cond.id, "operator", v);
                            }}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operators.map((op) => (
                                <SelectItem key={op} value={op}>
                                  {OPERATOR_LABELS[op] ?? op}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            className="flex-1"
                            placeholder="Value"
                            value={cond.value}
                            onChange={(e) => {
                              updateCondition(group.id, cond.id, "value", e.target.value);
                            }}
                          />
                          {cond.operator === "between" && (
                            <Input
                              className="w-24"
                              placeholder="To"
                              value={cond.value2 ?? ""}
                              onChange={(e) => {
                                setGroups((prev) =>
                                  prev.map((g) =>
                                    g.id === group.id
                                      ? {
                                          ...g,
                                          conditions: g.conditions.map((c) =>
                                            c.id === cond.id ? { ...c, value2: e.target.value } : c,
                                          ),
                                        }
                                      : g,
                                  ),
                                );
                              }}
                            />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => {
                              removeCondition(group.id, cond.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        addCondition(group.id);
                      }}
                    >
                      <Plus className="mr-2 h-3 w-3" /> Add Condition
                    </Button>
                    {groups.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 text-destructive"
                        onClick={() => {
                          removeGroup(group.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-3 w-3" /> Remove Group
                      </Button>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {segmentType === "STATIC" && (
        <Card>
          <CardHeader>
            <CardTitle>Member IDs</CardTitle>
            <CardDescription>Enter member IDs, one per line or comma-separated.</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              className="min-h-32 font-mono text-sm"
              placeholder="mem-1&#10;mem-2&#10;mem-3"
              {...form.register("memberIds")}
            />
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        onClick={() => {
          void handleSave();
        }}
        disabled={saving}
        size="lg"
      >
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving..." : isEdit ? "Update Segment" : "Create Segment"}
      </Button>
    </div>
  );
}
