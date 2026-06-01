import {
  Award,
  BarChart3,
  Gift,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  PieChart,
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
import { adminLogout, isAdminAuthenticated } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function Sidebar(): JSX.Element {
  const { t, i18n } = useTranslation();

  const links = [
    { to: "/", label: t("navigation.dashboard"), icon: LayoutDashboard, end: true },
    { to: "/members", label: t("navigation.members"), icon: Users },
    { to: "/campaigns", label: t("navigation.campaigns"), icon: Megaphone },
    { to: "/coupons", label: t("navigation.coupons"), icon: Ticket },
    { to: "/segments", label: t("navigation.segments"), icon: PieChart },
    { to: "/badges", label: t("navigation.badges"), icon: Award },
    { to: "/tiers", label: t("navigation.tiers"), icon: BarChart3 },
    { to: "/rewards", label: t("navigation.rewards"), icon: Gift },
    { to: "/coalition", label: t("navigation.coalition"), icon: Link2 },
    { to: "/giftcards", label: t("navigation.giftcards"), icon: Gift },
  ];

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
        {links.map(({ to, label, icon: Icon, end }) => (
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
            {label}
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
        {isAdminAuthenticated() && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 text-sm text-muted-foreground hover:text-accent-foreground"
            onClick={() => {
              void adminLogout();
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
