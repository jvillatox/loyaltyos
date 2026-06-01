import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, Check, CreditCard } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

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
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { GiftCardBatch, TermsTemplate } from "@/types";

const wizardSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  prefix: z
    .string()
    .max(8)
    .regex(/^[A-Z0-9]*$/, "Only uppercase letters and numbers")
    .optional()
    .or(z.literal("")),
  quantity: z.coerce.number().int().min(1).max(1_000_000),
  initialAmount: z.coerce.number().positive("Amount must be greater than 0"),
  currency: z.string().length(3).default("MXN"),
  expirationDate: z.date().optional(),
  termsTemplateId: z.string().min(1, "Select a terms template"),
});

type WizardData = z.infer<typeof wizardSchema>;

const STEPS = ["step1", "step2", "step3", "step4"] as const;

export function BatchWizardPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [expDate, setExpDate] = useState<Date | undefined>(undefined);
  const [locale, setLocale] = useState("es-MX");
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [pendingQuantity, setPendingQuantity] = useState(0);
  const [newTermsOpen, setNewTermsOpen] = useState(false);
  const [newTermsName, setNewTermsName] = useState("");
  const [newTermsLocale, setNewTermsLocale] = useState("es-MX");
  const [newTermsBody, setNewTermsBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<WizardData>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      name: "",
      prefix: "",
      quantity: 100,
      initialAmount: 500,
      currency: "MXN",
      expirationDate: undefined,
      termsTemplateId: "",
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["giftcard-terms"],
    queryFn: () => fetchApi<TermsTemplate[]>("/admin/giftcards/terms"),
  });

  const filteredTemplates = (templates ?? []).filter((t) => t.locale === locale && t.isActive);

  const next = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const prev = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleQuantityChange = (val: number) => {
    if (val > 100_000) {
      setPendingQuantity(val);
      setShowQuantityDialog(true);
    } else {
      form.setValue("quantity", val);
    }
  };

  const confirmQuantity = () => {
    form.setValue("quantity", pendingQuantity);
    setShowQuantityDialog(false);
  };

  const handleCreateTerms = async () => {
    const created = await fetchApi<TermsTemplate>("/admin/giftcards/terms", {
      method: "POST",
      body: JSON.stringify({
        name: newTermsName,
        locale: newTermsLocale,
        body: newTermsBody,
      }),
    });
    form.setValue("termsTemplateId", created.id);
    void queryClient.invalidateQueries({ queryKey: ["giftcard-terms"] });
    setNewTermsOpen(false);
    setNewTermsName("");
    setNewTermsBody("");
  };

  const handleSubmit = async () => {
    const valid = await form.trigger();
    if (!valid) return;

    const values = form.getValues();
    setSubmitting(true);
    try {
      const batch = await fetchApi<GiftCardBatch>("/admin/giftcards/batches", {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          prefix: values.prefix ? values.prefix : undefined,
          quantity: values.quantity,
          initialAmount: values.initialAmount,
          currency: values.currency,
          expirationDate:
            expDate?.toISOString() ?? new Date(Date.now() + 365 * 86400000).toISOString(),
          termsTemplateId: values.termsTemplateId,
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ["giftcard-batches"] });
      navigate(`/giftcards/batches/${batch.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
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
        <h1 className="text-3xl font-bold">{t("giftcards.createBatch")}</h1>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {STEPS.map((key, i) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStep(i);
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium",
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {i < step && <Check className="mr-1 inline h-3 w-3" />}
            {t(`giftcards.wizard.${key}`)}
          </button>
        ))}
      </div>

      {/* Step 1: Basic info */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("giftcards.wizard.step1")}</CardTitle>
            <CardDescription>
              Configure the basic properties of your gift card batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">{t("campaigns.name")} *</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="prefix">{t("giftcards.prefix")}</Label>
              <Input id="prefix" placeholder="e.g. HOLIDAY" {...form.register("prefix")} />
            </div>
            <div>
              <Label htmlFor="quantity">{t("giftcards.quantity")} *</Label>
              <Input
                id="quantity"
                type="number"
                value={form.watch("quantity")}
                onChange={(e) => {
                  handleQuantityChange(Number(e.target.value));
                }}
              />
              {form.formState.errors.quantity && (
                <p className="text-sm text-destructive">{form.formState.errors.quantity.message}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Amount & Expiration */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("giftcards.wizard.step2")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="initialAmount">{t("giftcards.initialAmount")} *</Label>
              <Input
                id="initialAmount"
                type="number"
                step="0.01"
                {...form.register("initialAmount", { valueAsNumber: true })}
              />
              {form.formState.errors.initialAmount && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.initialAmount.message}
                </p>
              )}
            </div>
            <div>
              <Label>{t("giftcards.currency")}</Label>
              <Select
                value={form.watch("currency")}
                onValueChange={(v) => {
                  form.setValue("currency", v);
                }}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("giftcards.expiration")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "ml-2 w-[240px] justify-start text-left font-normal",
                      !expDate && "text-muted-foreground",
                    )}
                  >
                    {expDate ? format(expDate, "PP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expDate}
                    onSelect={setExpDate}
                    disabled={{ before: new Date() }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: T&Cs */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("giftcards.wizard.step3")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Label>{t("settings.language")}</Label>
              <Select value={locale} onValueChange={setLocale}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="es-MX">Español</SelectItem>
                  <SelectItem value="en-US">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("giftcards.terms")} *</Label>
              <Select
                value={form.watch("termsTemplateId")}
                onValueChange={(v) => {
                  form.setValue("termsTemplateId", v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name} (v{tpl.version})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.termsTemplateId && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.termsTemplateId.message}
                </p>
              )}
            </div>
            <Separator />
            <Button
              variant="outline"
              onClick={() => {
                setNewTermsOpen(true);
              }}
            >
              {t("giftcards.newTermsTemplate")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirmation */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("giftcards.wizard.step4")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">{t("campaigns.name")}</p>
                <p className="font-medium">{form.watch("name")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("giftcards.quantity")}</p>
                <p className="font-medium">{form.watch("quantity").toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("giftcards.amount")}</p>
                <p className="font-medium">
                  {form.watch("initialAmount")} {form.watch("currency")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("giftcards.expiration")}</p>
                <p className="font-medium">{expDate ? format(expDate, "PP") : "1 year"}</p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm text-muted-foreground">Estimated total liability</p>
              <p className="text-xl font-bold">
                {(form.watch("quantity") * form.watch("initialAmount")).toLocaleString()}{" "}
                {form.watch("currency")}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Estimated generation time</p>
              <p className="font-medium">
                ~{Math.max(1, Math.ceil(form.watch("quantity") / 1000))}s
              </p>
            </div>
            <Button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={submitting}
              className="w-full"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {submitting ? t("common.loading") : t("giftcards.createBatch")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={prev} disabled={step === 0}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        {step < STEPS.length - 1 && (
          <Button onClick={next}>
            {t("common.next")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Quantity confirmation dialog */}
      <AlertDialog open={showQuantityDialog} onOpenChange={setShowQuantityDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Large batch size</AlertDialogTitle>
            <AlertDialogDescription>
              Creating {pendingQuantity.toLocaleString()} gift cards will take approximately{" "}
              {Math.ceil(pendingQuantity / 1000)} seconds. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                form.setValue("quantity", 100);
              }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmQuantity}>{t("common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New terms template dialog */}
      <Dialog open={newTermsOpen} onOpenChange={setNewTermsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("giftcards.newTermsTemplate")}</DialogTitle>
            <DialogDescription>Create a new terms and conditions template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("campaigns.name")}</Label>
              <Input
                value={newTermsName}
                onChange={(e) => {
                  setNewTermsName(e.target.value);
                }}
              />
            </div>
            <div>
              <Label>{t("settings.language")}</Label>
              <Select value={newTermsLocale} onValueChange={setNewTermsLocale}>
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
              <Label>{t("giftcards.terms")}</Label>
              <Textarea
                rows={6}
                value={newTermsBody}
                onChange={(e) => {
                  setNewTermsBody(e.target.value);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewTermsOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                void handleCreateTerms();
              }}
              disabled={!newTermsName || !newTermsBody}
            >
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
