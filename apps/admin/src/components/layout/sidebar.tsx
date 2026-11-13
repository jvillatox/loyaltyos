import type { AdminRole, Permission } from "@loyaltyos/permissions";
import { can, isAdminRole } from "@loyaltyos/permissions";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  BarChart3,
  Coins,
  Gift,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  PieChart,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { persistLocale } from "@/i18n";
import { usePermission } from "@/lib/access";
import { fetchApi } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import type { PaginatedResponse } from "@/types";

interface SidebarLink {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  permission: Permission;
  badge?: number;
}

export function Sidebar(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { admin, logout } = useAdminAuth();
  const canApprove = usePermission("members.adjust.approve");

  const { data: pending } = useQuery({
    queryKey: ["point-adjustments", "pending-count"],
    queryFn: () =>
      fetchApi<PaginatedResponse<unknown>>(
        "/admin/point-adjustments?status=PENDING&page=1&pageSize=1",
      ),
    enabled: canApprove,
  });

  const links: SidebarLink[] = [
    {
      to: "/",
      label: t("navigation.dashboard"),
      icon: LayoutDashboard,
      end: true,
      permission: "read",
    },
    { to: "/members", label: t("navigation.members"), icon: Users, permission: "read" },
    { to: "/campaigns", label: t("navigation.campaigns"), icon: Megaphone, permission: "read" },
    { to: "/coupons", label: t("navigation.coupons"), icon: Ticket, permission: "read" },
    { to: "/segments", label: t("navigation.segments"), icon: PieChart, permission: "read" },
    { to: "/badges", label: t("navigation.badges"), icon: Award, permission: "read" },
    { to: "/tiers", label: t("navigation.tiers"), icon: BarChart3, permission: "read" },
    { to: "/rewards", label: t("navigation.rewards"), icon: Gift, permission: "read" },
    { to: "/coalition", label: t("navigation.coalition"), icon: Link2, permission: "read" },
    { to: "/giftcards", label: t("navigation.giftcards"), icon: Gift, permission: "read" },
    { to: "/api-tokens", label: t("navigation.apiTokens"), icon: KeyRound, permission: "read" },
    {
      to: "/point-adjustments",
      label: t("navigation.pointAdjustments"),
      icon: Coins,
      permission: "read",
      badge: canApprove ? (pending?.total ?? 0) : undefined,
    },
    {
      to: "/settings",
      label: t("navigation.settings"),
      icon: Settings,
      permission: "program.write",
    },
  ];

  const role: AdminRole | null = admin && isAdminRole(admin.role) ? admin.role : null;
  const visibleLinks = links.filter(({ permission }) => can(role, permission));

  function handleLocaleChange(locale: string): void {
    void i18n.changeLanguage(locale);
    persistLocale(locale);
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-6">
        <span className="text-lg font-semibold">LoyaltyOS</span>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {visibleLinks.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {badge != null && badge > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground ring-1 ring-primary-foreground/30">
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-4 space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("settings.language")}</label>
          <Select value={i18n.language} onValueChange={handleLocaleChange}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es-MX">Español</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {admin && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 text-sm text-muted-foreground hover:text-accent-foreground"
            onClick={() => {
              void logout();
            }}
          >
            <LogOut className="h-4 w-4" />
            {t("navigation.signOut")}
          </Button>
        )}
      </div>
      <Separator />
    </aside>
  );
}
