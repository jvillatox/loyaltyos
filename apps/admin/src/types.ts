export interface Member {
  id: string;
  externalId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  metadata: unknown;
  tags: string[];
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  pointAccount?: { balance: number } | null;
}

export interface DashboardStats {
  activeMembers: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  redemptionRatio: number;
  recentTransactions: number;
}

export interface PointTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  source: string;
  description: string | null;
  createdAt: string;
}

export interface Balance {
  confirmed: number;
  pending: number;
  total: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
