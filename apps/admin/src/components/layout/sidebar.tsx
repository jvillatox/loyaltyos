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
import { NavLink } from "react-router-dom";

import { Separator } from "@/components/ui/separator";
import { adminLogout, isAdminAuthenticated } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/members", label: "Members", icon: Users },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/coupons", label: "Coupons", icon: Ticket },
  { to: "/segments", label: "Segments", icon: PieChart },
  { to: "/badges", label: "Badges", icon: Award },
  { to: "/tiers", label: "Tiers", icon: BarChart3 },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/coalition", label: "Coalition", icon: Link2 },
];

export function Sidebar(): JSX.Element {
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
      {isAdminAuthenticated() && (
        <div className="border-t p-4">
          <button
            onClick={() => {
              void adminLogout();
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
      <Separator />
    </aside>
  );
}
