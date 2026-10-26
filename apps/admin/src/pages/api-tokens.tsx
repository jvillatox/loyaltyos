import { ADMIN_ROLES, type AdminRole, adminRoleRank, isAdminRole } from "@loyaltyos/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  role: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  adminUser?: { email: string };
}

function tokenState(token: ApiToken): "active" | "revoked" | "expired" {
  if (token.revokedAt) return "revoked";
  if (new Date(token.expiresAt) < new Date()) return "expired";
  return "active";
}

export function ApiTokensPage(): JSX.Element {
  const { t } = useTranslation();
  const { admin } = useAdminAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("ANALYST");
  const [days, setDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const {
    data: tokens,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: () => fetchApi<ApiToken[]>("/admin/tokens"),
  });

  const ownerRole: AdminRole | null = admin && isAdminRole(admin.role) ? admin.role : null;
  const ownerRank = ownerRole ? adminRoleRank(ownerRole) : 0;
  const allowedRoles = ADMIN_ROLES.filter((r) => adminRoleRank(r) <= ownerRank);

  function openCreate(): void {
    setName("");
    setRole("ANALYST");
    setDays(90);
    setCreatedToken(null);
    setDialogOpen(true);
  }

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      const result = await fetchApi<ApiToken & { token: string }>("/admin/tokens", {
        method: "POST",
        body: JSON.stringify({ name, role, days }),
      });
      setCreatedToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    await fetchApi(`/admin/tokens/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
  }

  async function handleCopy(): Promise<void> {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("navigation.apiTokens")}</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          {t("common.create")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("navigation.apiTokens")}</CardTitle>
          <CardDescription>
            Personal access tokens authenticate API and MCP clients as you. A token never out-ranks
            your current role and is shown only once at creation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`sk-${String(i)}`} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-destructive">Failed to load tokens.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens?.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell>
                      <span className="font-medium">{token.name}</span>
                      {token.adminUser?.email ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {token.adminUser.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{token.prefix}…</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{token.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          tokenState(token) === "active"
                            ? "secondary"
                            : tokenState(token) === "revoked"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {tokenState(token)}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(token.expiresAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {tokenState(token) !== "revoked" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            void handleRevoke(token.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {tokens?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {t("common.noResults")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          {createdToken ? (
            <>
              <DialogHeader>
                <DialogTitle>Token created</DialogTitle>
                <DialogDescription>Copy it now — it will not be shown again.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
                <code className="flex-1 break-all font-mono text-sm">{createdToken}</code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    void handleCopy();
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setDialogOpen(false);
                  }}
                >
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Create API token</DialogTitle>
                <DialogDescription>
                  Give the token a name and the role it may act with. The role cannot exceed your
                  own.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("common.name")}</Label>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                    }}
                    placeholder="CI bot"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => {
                      setRole(v as AdminRole);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expires in (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={days}
                    onChange={(e) => {
                      setDays(Number(e.target.value));
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => {
                    void handleCreate();
                  }}
                  disabled={creating || !name.trim()}
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  {t("common.create")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
