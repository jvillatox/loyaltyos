import { Award, Gift, Home, Star, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { isAuthenticated } from "../../lib/auth";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  authRequired: boolean;
}

export default function BottomNav() {
  const { t } = useTranslation();
  const authed = isAuthenticated();

  const items: NavItem[] = [
    { to: "/", label: t("home"), icon: Home, authRequired: false },
    { to: "/transactions", label: t("transactions"), icon: Star, authRequired: true },
    { to: "/rewards", label: t("rewards"), icon: Gift, authRequired: true },
    { to: "/badges", label: t("badges"), icon: Award, authRequired: true },
    { to: "/profile", label: t("profile"), icon: User, authRequired: false },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      role="navigation"
      aria-label={t("profile")}
    >
      <ul className="mx-auto flex max-w-lg justify-around">
        {items.map((item) => {
          if (item.authRequired && !authed) return null;
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 px-3 py-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                  }`
                }
                end={item.to === "/"}
              >
                <item.icon className="h-5 w-5" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
