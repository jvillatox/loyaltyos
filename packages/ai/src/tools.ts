import type { ToolDef } from "./types.js";

interface ToolFactoryOptions {
  fetch: typeof globalThis.fetch;
  baseUrl: string;
}

async function apiFetch<T>(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchFn(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await res.json()) as { data?: T; error?: { message: string } };
  if (!res.ok) {
    throw new Error(body.error?.message ?? `API error ${String(res.status)}`);
  }
  return body.data as T;
}

interface SimpleRule {
  field: string;
  operator: string;
  value: unknown;
}

interface SegmentEstimateInput {
  rules?: SimpleRule[];
  logic?: "AND" | "OR";
}

function translateRules(rules: SimpleRule[], logic: "AND" | "OR"): Record<string, unknown> {
  const conditions = rules.map((r) => {
    const condition: Record<string, unknown> = { field: r.field };
    condition[r.operator] = r.value;
    return condition;
  });

  if (logic === "OR") {
    return { any: conditions };
  }
  return { all: conditions };
}

export function buildTools(options: ToolFactoryOptions): ToolDef[] {
  const { fetch: fetchFn, baseUrl } = options;

  const get = async <T>(path: string): Promise<T> => {
    return apiFetch<T>(fetchFn, `${baseUrl}${path}`);
  };

  const post = async <T>(path: string, data: unknown): Promise<T> => {
    return apiFetch<T>(fetchFn, `${baseUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  };

  return [
    // ── Members ──
    {
      name: "get_member",
      description:
        "Get a loyalty program member's full profile including tier, point balance, and activity summary. Use to look up a member by ID or email.",
      parameters: {
        type: "object",
        properties: {
          memberId: {
            type: "string",
            description: "Member ID (e.g., mem_abc123) or email address",
          },
        },
        required: ["memberId"],
      },
      handler: async (args) => {
        const data = await get<unknown>(`/members/${String(args.memberId)}`);
        return JSON.stringify(data);
      },
    },

    {
      name: "list_members",
      description:
        "List loyalty program members with optional search and pagination. Use to find members by name, email, or browse the member base.",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description: "Search by name, email, or external ID",
          },
          page: {
            type: "integer",
            description: "Page number starting from 1 (default: 1)",
          },
          pageSize: {
            type: "integer",
            description: "Results per page, max 100 (default: 20)",
          },
        },
      },
      handler: async (args) => {
        const params = new URLSearchParams();
        if (args.search) params.set("search", String(args.search));
        if (args.page) params.set("page", String(args.page));
        if (args.pageSize) params.set("pageSize", String(args.pageSize));
        const qs = params.toString();
        const data = await get<unknown>(`/members${qs ? `?${qs}` : ""}`);
        return JSON.stringify(data);
      },
    },

    {
      name: "get_member_history",
      description:
        "Get the point transaction history for a member. Shows all earn, burn, expire, and adjust events.",
      parameters: {
        type: "object",
        properties: {
          memberId: {
            type: "string",
            description: "The member ID (e.g., mem_abc123)",
          },
          page: {
            type: "integer",
            description: "Page number (default: 1)",
          },
          pageSize: {
            type: "integer",
            description: "Results per page, max 100 (default: 20)",
          },
        },
        required: ["memberId"],
      },
      handler: async (args) => {
        const params = new URLSearchParams();
        if (args.page) params.set("page", String(args.page));
        if (args.pageSize) params.set("pageSize", String(args.pageSize));
        const qs = params.toString();
        const data = await get<unknown>(
          `/members/${String(args.memberId)}/transactions${qs ? `?${qs}` : ""}`,
        );
        return JSON.stringify(data);
      },
    },

    // ── Campaigns ──
    {
      name: "create_campaign",
      description:
        "Create a new loyalty campaign. Supports bonus points, spend-and-get, frequency, milestone, referral, birthday, flash sale, and tier upgrade bonus types. This is a mutation — always confirm with the operator before executing.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Campaign name (max 100 chars)",
          },
          description: {
            type: "string",
            description: "Short description of the campaign",
          },
          type: {
            type: "string",
            enum: [
              "BONUS_POINTS",
              "SPEND_AND_GET",
              "FREQUENCY",
              "MILESTONE",
              "REFERRAL",
              "BIRTHDAY",
              "ANNIVERSARY",
              "FLASH_SALE",
              "TIER_UPGRADE_BONUS",
            ],
            description: "Campaign type",
          },
          multiplier: {
            type: "number",
            description: "Point multiplier (e.g., 2 for double points)",
          },
          maxBudget: {
            type: "integer",
            description: "Maximum total points budget for this campaign",
          },
          maxUsesPerMember: {
            type: "integer",
            description: "Maximum times a member can use this campaign",
          },
          isStackable: {
            type: "boolean",
            description: "Whether this campaign stacks with others",
          },
          startsAt: {
            type: "string",
            description: "Start date in ISO format (e.g., 2026-05-25T00:00:00Z)",
          },
          endsAt: {
            type: "string",
            description: "End date in ISO format",
          },
        },
        required: ["name", "type"],
      },
      handler: async (args) => {
        const data = await post<unknown>("/admin/campaigns", args);
        return JSON.stringify(data);
      },
    },

    {
      name: "list_campaigns",
      description:
        "List campaigns with optional active filter. Returns paginated results with campaign details.",
      parameters: {
        type: "object",
        properties: {
          isActive: {
            type: "boolean",
            description: "Filter by active status (true for active, false for inactive)",
          },
          page: {
            type: "integer",
            description: "Page number (default: 1)",
          },
          pageSize: {
            type: "integer",
            description: "Results per page (default: 20)",
          },
        },
      },
      handler: async (args) => {
        const params = new URLSearchParams();
        if (args.isActive !== undefined) params.set("isActive", String(args.isActive));
        if (args.page) params.set("page", String(args.page));
        if (args.pageSize) params.set("pageSize", String(args.pageSize));
        const qs = params.toString();
        const data = await get<unknown>(`/admin/campaigns${qs ? `?${qs}` : ""}`);
        return JSON.stringify(data);
      },
    },

    {
      name: "get_campaign_stats",
      description:
        "Get detailed information and performance data for a specific campaign, including variants and applications.",
      parameters: {
        type: "object",
        properties: {
          campaignId: {
            type: "string",
            description: "The campaign ID to get stats for",
          },
        },
        required: ["campaignId"],
      },
      handler: async (args) => {
        const data = await get<unknown>(`/admin/campaigns/${String(args.campaignId)}`);
        return JSON.stringify(data);
      },
    },

    // ── Segments ──
    {
      name: "create_segment",
      description:
        "Create a customer segment based on behavioral and profile rules. Segments auto-update as member data changes. This is a mutation — confirm before executing.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Segment name",
          },
          description: {
            type: "string",
            description: "What this segment represents",
          },
          type: {
            type: "string",
            enum: ["STATIC", "DYNAMIC"],
            description: "DYNAMIC auto-updates, STATIC has fixed members",
          },
          rules: {
            type: "array",
            description: "Array of rule objects with field, operator, and value",
            items: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  enum: [
                    "pointBalance",
                    "tier",
                    "inactiveDays",
                    "totalSpend",
                    "joinedDaysAgo",
                    "lastPurchaseDaysAgo",
                    "tags",
                  ],
                },
                operator: {
                  type: "string",
                  enum: ["eq", "neq", "gt", "lt", "gte", "lte", "in", "not_in", "contains"],
                },
                value: {
                  description: "The value to compare against. Type depends on field.",
                },
              },
              required: ["field", "operator", "value"],
            },
          },
          logic: {
            type: "string",
            enum: ["AND", "OR"],
            description: "How rules combine (default: AND)",
          },
        },
        required: ["name", "type"],
      },
      handler: async (args) => {
        const rules = args.rules as SimpleRule[] | undefined;
        const logic = (args.logic as "AND" | "OR" | undefined) ?? "AND";

        const body: Record<string, unknown> = {
          name: args.name,
          type: args.type,
        };
        if (args.description) body.description = args.description;
        if (rules?.length) {
          body.rules = translateRules(rules, logic);
        }

        const data = await post<unknown>("/admin/segments", body);
        return JSON.stringify(data);
      },
    },

    {
      name: "preview_segment",
      description:
        "Estimate how many members match a set of rules before creating a segment. Always use this before creating a campaign with a segment to validate the audience size.",
      parameters: {
        type: "object",
        properties: {
          rules: {
            type: "array",
            description: "Array of rule objects with field, operator, and value",
            items: {
              type: "object",
              properties: {
                field: {
                  type: "string",
                  enum: [
                    "pointBalance",
                    "tier",
                    "inactiveDays",
                    "totalSpend",
                    "joinedDaysAgo",
                    "lastPurchaseDaysAgo",
                    "tags",
                  ],
                },
                operator: {
                  type: "string",
                  enum: ["eq", "neq", "gt", "lt", "gte", "lte", "in", "not_in", "contains"],
                },
                value: {
                  description: "The value to compare against",
                },
              },
              required: ["field", "operator", "value"],
            },
          },
          logic: {
            type: "string",
            enum: ["AND", "OR"],
            description: "How rules combine (default: AND)",
          },
        },
        required: ["rules"],
      },
      handler: async (args) => {
        const rules = args.rules as SimpleRule[];
        const logic = (args.logic as "AND" | "OR" | undefined) ?? "AND";
        const body: SegmentEstimateInput = { rules, logic };
        const translated = { rules: translateRules(body.rules ?? [], logic) };
        const data = await post<unknown>("/admin/segments/estimate", translated);
        return JSON.stringify(data);
      },
    },

    // ── Analytics ──
    {
      name: "get_dashboard_analytics",
      description:
        "Get the main program KPIs: active members, total points issued, total points redeemed, redemption ratio, and recent transaction volume. Use for program health checks and reporting.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const data = await get<unknown>("/stats/dashboard");
        return JSON.stringify(data);
      },
    },

    // ── Coupons ──
    {
      name: "create_coupon",
      description:
        "Create a discount coupon. Supports percentage, fixed amount, free product, free shipping, extra points, and experience discount types. This is a mutation — confirm before executing.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "Coupon code (3-50 chars, uppercase letters, numbers, underscores, hyphens). Auto-generated if omitted.",
          },
          mode: {
            type: "string",
            enum: ["SHARED", "INDIVIDUAL", "LIMITED"],
            description:
              "SHARED = single code for everyone, INDIVIDUAL = unique per member, LIMITED = limited pool",
          },
          discountType: {
            type: "string",
            enum: [
              "PERCENTAGE",
              "FIXED",
              "FREE_PRODUCT",
              "FREE_SHIPPING",
              "EXTRA_POINTS",
              "EXPERIENCE",
            ],
            description: "Type of discount",
          },
          discountValue: {
            type: "number",
            description:
              "Discount amount: percentage (e.g., 15 for 15%), fixed amount in cents, or bonus points",
          },
          minPurchase: {
            type: "integer",
            description: "Minimum purchase amount in cents to use this coupon",
          },
          maxUses: {
            type: "integer",
            description: "Maximum total uses across all members",
          },
          maxUsesPerMember: {
            type: "integer",
            description: "Maximum uses per member (default: 1)",
          },
          isStackable: {
            type: "boolean",
            description: "Whether this coupon can be combined with others",
          },
          startsAt: {
            type: "string",
            description: "Start date in ISO format",
          },
          expiresAt: {
            type: "string",
            description: "Expiration date in ISO format",
          },
        },
        required: ["mode", "discountType"],
      },
      handler: async (args) => {
        const data = await post<unknown>("/admin/coupons", args);
        return JSON.stringify(data);
      },
    },

    // ── Rewards ──
    {
      name: "get_rewards_catalog",
      description:
        "Browse the loyalty rewards catalog. Members redeem their points for these rewards. Returns available rewards with point costs and stock info.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by reward category",
          },
          isActive: {
            type: "boolean",
            description: "Filter by active status (default: true)",
          },
          minPoints: {
            type: "integer",
            description: "Minimum point cost filter",
          },
          maxPoints: {
            type: "integer",
            description: "Maximum point cost filter",
          },
          page: {
            type: "integer",
            description: "Page number (default: 1)",
          },
          pageSize: {
            type: "integer",
            description: "Results per page (default: 20)",
          },
        },
      },
      handler: async (args) => {
        const params = new URLSearchParams();
        if (args.category) params.set("category", String(args.category));
        if (args.isActive !== undefined) params.set("isActive", String(args.isActive));
        if (args.minPoints) params.set("minPoints", String(args.minPoints));
        if (args.maxPoints) params.set("maxPoints", String(args.maxPoints));
        if (args.page) params.set("page", String(args.page));
        if (args.pageSize) params.set("pageSize", String(args.pageSize));
        const qs = params.toString();
        const data = await get<unknown>(`/rewards${qs ? `?${qs}` : ""}`);
        return JSON.stringify(data);
      },
    },

    // ── Program Config ──
    {
      name: "get_program_config",
      description:
        "Get the current loyalty program configuration: tier structure with thresholds and benefits, plus high-level program stats (active members, points issued/redeemed).",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const [tiers, stats] = await Promise.all([
          get<unknown>("/admin/tiers"),
          get<unknown>("/stats/dashboard"),
        ]);
        return JSON.stringify({ tiers, stats });
      },
    },
  ];
}
