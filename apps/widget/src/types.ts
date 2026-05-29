// ── Widget configuration ──────────────────────────────────────────────────

export type WidgetLocale = "es-MX" | "en-US";

export interface WidgetConfig {
  programId: string;
  apiBase: string;
  authToken: string | null;
  theme: "light" | "dark" | "auto";
  accentColor: string;
  locale: WidgetLocale;
  compact: boolean;
  mode: "mini" | "full";
}

export const DEFAULT_CONFIG: Partial<WidgetConfig> = {
  theme: "auto",
  accentColor: "#7c3aed",
  locale: "es-MX",
  compact: false,
  mode: "full",
};

// ── API response types ────────────────────────────────────────────────────

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export interface BadgeProgress {
  progress: number;
  currentValue: number;
  targetValue: number;
  unlocked: boolean;
  unlockedAt: string | null;
  remainingCount: number;
  badge: {
    id: string;
    name: string;
    description: string | null;
    type: string;
    imageUrl: string | null;
  };
}

export interface TierStatus {
  currentTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
    color: string | null;
    iconUrl: string | null;
    benefits: unknown;
  } | null;
  previousTier: {
    id: string;
    name: string;
    rank: number;
  } | null;
  changed: boolean;
  direction: "upgrade" | "downgrade" | null;
  pointsProgress: number;
  pointsToNext: number | null;
  nextTier: {
    id: string;
    name: string;
    rank: number;
    minPoints: number;
  } | null;
}

export interface RewardSummary {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  imageUrl: string | null;
  category: string | null;
  isActive: boolean;
}
