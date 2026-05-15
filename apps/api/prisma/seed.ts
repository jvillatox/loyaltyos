/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-condition */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

async function main(): Promise<void> {
  console.log("Seeding LoyaltyOS demo data...\n");

  // Clean existing data in reverse dependency order
  await prisma.pointTransaction.deleteMany();
  await prisma.coalitionTransaction.deleteMany();
  await prisma.coalitionAccount.deleteMany();
  await prisma.memberTier.deleteMany();
  await prisma.memberBadge.deleteMany();
  await prisma.couponRedemption.deleteMany();
  await prisma.rewardRedemption.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.pointAccount.deleteMany();
  await prisma.member.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.campaignVariant.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.reward.deleteMany();
  await prisma.badge.deleteMany();
  await prisma.segment.deleteMany();
  await prisma.pointRule.deleteMany();
  await prisma.notificationTemplate.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.tier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.program.deleteMany();
  console.log("Cleaned existing data.\n");

  // === Program ===
  const program = await prisma.program.create({
    data: {
      id: "prog_dev",
      name: "LoyaltyOS Demo",
      description: "Demo program for development and testing",
      pointsUnit: "Stars",
    },
  });
  console.log(`Created program: ${program.name} (${program.id})`);

  // === API Key ===
  const apiKey = await prisma.apiKey.create({
    data: {
      key: "dev-key",
      name: "Development Key",
      scope: "SERVER",
      programId: program.id,
      isActive: true,
    },
  });
  console.log(`Created API key: ${apiKey.key}`);

  // === Admin User ===
  const adminUser = await prisma.adminUser.create({
    data: {
      email: "admin@loyaltyos.dev",
      name: "Admin Demo",
      role: "SUPER_ADMIN",
      passwordHash: "demo-hash-not-for-production",
      programId: program.id,
    },
  });
  console.log(`Created admin user: ${adminUser.email}`);

  // === Tiers ===
  const tiers = await Promise.all([
    prisma.tier.create({
      data: {
        programId: program.id,
        name: "Silver",
        rank: 1,
        minPoints: 0,
        color: "#94a3b8",
      },
    }),
    prisma.tier.create({
      data: {
        programId: program.id,
        name: "Gold",
        rank: 2,
        minPoints: 5000,
        color: "#eab308",
      },
    }),
    prisma.tier.create({
      data: {
        programId: program.id,
        name: "Platinum",
        rank: 3,
        minPoints: 20000,
        color: "#a855f7",
      },
    }),
  ]);
  console.log(`Created ${String(tiers.length)} tiers: ${tiers.map((t) => t.name).join(", ")}`);

  // === Point Rules ===
  const rules = await Promise.all([
    prisma.pointRule.create({
      data: {
        programId: program.id,
        eventType: "purchase",
        multiplier: 10,
        conditions: {},
        startsAt: new Date("2024-01-01"),
      },
    }),
    prisma.pointRule.create({
      data: {
        programId: program.id,
        eventType: "purchase",
        multiplier: 2,
        conditions: {},
        startsAt: new Date("2024-01-01"),
      },
    }),
  ]);
  console.log(`Created ${String(rules.length)} point rules`);

  // === Members ===
  const now = new Date();
  const daysAgo = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  const memberData = [
    {
      firstName: "Carlos",
      lastName: "Mendoza",
      email: "carlos@example.com",
      phone: "+521234567890",
      joinedAt: daysAgo(180),
    },
    {
      firstName: "Ana",
      lastName: "García",
      email: "ana@example.com",
      phone: "+521234567891",
      joinedAt: daysAgo(150),
    },
    {
      firstName: "Luis",
      lastName: "Hernández",
      email: "luis@example.com",
      phone: null,
      joinedAt: daysAgo(120),
    },
    {
      firstName: "María",
      lastName: "López",
      email: "maria@example.com",
      phone: "+521234567893",
      joinedAt: daysAgo(90),
    },
    { firstName: "Pedro", lastName: "Ramírez", email: "pedro@example.com", joinedAt: daysAgo(80) },
    {
      firstName: "Sofía",
      lastName: "Díaz",
      email: "sofia@example.com",
      phone: "+521234567895",
      joinedAt: daysAgo(70),
    },
    { firstName: "Diego", lastName: "Torres", email: "diego@example.com", joinedAt: daysAgo(60) },
    {
      firstName: "Elena",
      lastName: "Flores",
      email: "elena@example.com",
      phone: "+521234567897",
      joinedAt: daysAgo(45),
    },
    { firstName: "Javier", lastName: "Reyes", email: "javier@example.com", joinedAt: daysAgo(30) },
    {
      firstName: "Lucía",
      lastName: "Morales",
      email: "lucia@example.com",
      phone: "+521234567899",
      joinedAt: daysAgo(15),
    },
    {
      firstName: "Roberto",
      lastName: "Ortega",
      email: "roberto@example.com",
      joinedAt: daysAgo(10),
    },
    {
      firstName: "Gabriela",
      lastName: "Vargas",
      email: "gabriela@example.com",
      phone: null,
      joinedAt: daysAgo(5),
    },
  ];

  const members = await Promise.all(
    memberData.map((m) =>
      prisma.member.create({
        data: {
          programId: program.id,
          firstName: m.firstName,
          lastName: m.lastName,
          email: m.email,
          phone: m.phone ?? null,
          tags: [],
          joinedAt: m.joinedAt,
        },
      }),
    ),
  );
  console.log(`Created ${String(members.length)} members`);

  // === Point Accounts ===
  const accountData = [80000, 12300, 45000, 3200, 7800, 15000, 1200, 25000, 5200, 1800, 900, 35000];
  const accounts = await Promise.all(
    members.map((member, i) =>
      prisma.pointAccount.create({
        data: {
          memberId: member.id,
          programId: program.id,
          balance: accountData[i] ?? 0,
          pendingBalance: 0,
          totalEarned: accountData[i] ?? 0,
          totalRedeemed: 0,
        },
      }),
    ),
  );
  console.log(`Created ${String(accounts.length)} point accounts`);

  // === Point Transactions ===
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const account = accounts[i];
    if (!member || !account) continue;

    // Earn transactions
    const earnCount = 3 + Math.floor(Math.random() * 5);
    let balanceAfter = 0;
    for (let j = 0; j < earnCount; j++) {
      const amount = 500 + Math.floor(Math.random() * 5000);
      balanceAfter += amount;
      await prisma.pointTransaction.create({
        data: {
          accountId: account.id,
          type: "EARN",
          amount,
          balanceAfter,
          source: j === 0 ? "signup_bonus" : "event:purchase",
          createdAt: daysAgo(Math.floor(Math.random() * 180)),
          idempotencyKey: `seed-${member.id}-earn-${String(j)}`,
        },
      });
    }

    // Some redeem transactions for select members
    if (i < 5) {
      const redeemAmount = Math.floor(balanceAfter * 0.3);
      balanceAfter -= redeemAmount;
      await prisma.pointTransaction.create({
        data: {
          accountId: account.id,
          type: "REDEEM",
          amount: redeemAmount,
          balanceAfter,
          source: "reward_redemption",
          createdAt: daysAgo(Math.floor(Math.random() * 30)),
          idempotencyKey: `seed-${member.id}-redeem-1`,
        },
      });

      // Update the account
      await prisma.pointAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalRedeemed: redeemAmount },
      });
    }
  }
  console.log("Created point transactions");

  // === Campaigns ===
  const campaigns = await Promise.all([
    prisma.campaign.create({
      data: {
        programId: program.id,
        name: "Weekend Double Points",
        type: "BONUS_POINTS",
        isActive: true,
        multiplier: 2,
        maxBudget: 100000,
        startsAt: daysAgo(30),
        endsAt: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      },
    }),
    prisma.campaign.create({
      data: {
        programId: program.id,
        name: "Summer Flash Sale",
        type: "FLASH_SALE",
        isActive: false,
        multiplier: 1,
        maxBudget: 50000,
        startsAt: daysAgo(90),
        endsAt: daysAgo(60),
      },
    }),
  ]);
  console.log(`Created ${String(campaigns.length)} campaigns`);

  // === Coupons ===
  const coupons = await Promise.all([
    prisma.coupon.create({
      data: {
        programId: program.id,
        code: "WELCOME10",
        mode: "SHARED",
        discountType: "PERCENTAGE",
        discountValue: 10,
        usedCount: 3,
      },
    }),
    prisma.coupon.create({
      data: {
        programId: program.id,
        code: "VIP500",
        mode: "INDIVIDUAL",
        discountType: "FIXED",
        discountValue: 500,
        maxUses: 1,
        usedCount: 1,
      },
    }),
  ]);
  console.log(`Created ${String(coupons.length)} coupons`);

  // === Rewards ===
  const rewards = await Promise.all([
    prisma.reward.create({
      data: {
        programId: program.id,
        name: "Gift Card $200 MXN",
        pointsCost: 2000,
        stock: 50,
        category: "gift_cards",
        isActive: true,
      },
    }),
    prisma.reward.create({
      data: {
        programId: program.id,
        name: "Free Coffee",
        pointsCost: 300,
        stock: 100,
        category: "food_drinks",
        isActive: true,
      },
    }),
    prisma.reward.create({
      data: {
        programId: program.id,
        name: "Movie Ticket",
        pointsCost: 1500,
        stock: 25,
        category: "entertainment",
        isActive: true,
      },
    }),
  ]);
  console.log(`Created ${String(rewards.length)} rewards`);

  // === Badges ===
  const badges = await Promise.all([
    prisma.badge.create({
      data: {
        programId: program.id,
        name: "Early Adopter",
        type: "STATUS",
        conditions: {},
      },
    }),
    prisma.badge.create({
      data: {
        programId: program.id,
        name: "Big Spender",
        type: "ACHIEVEMENT",
        conditions: {},
      },
    }),
  ]);
  console.log(`Created ${String(badges.length)} badges`);

  // Assign badges to some members
  const [m0, m1, m2, , , , m6] = members;
  const [badge0, badge1] = badges;
  const [tier0, tier1, tier2] = tiers;
  if (!(m0 && m1 && m2 && m6 && badge0 && badge1 && tier0 && tier1 && tier2)) {
    throw new Error("Seed data consistency error: missing expected members, badges, or tiers");
  }

  await Promise.all([
    prisma.memberBadge.create({
      data: { memberId: m0.id, badgeId: badge0.id, progress: 1, unlockedAt: daysAgo(150) },
    }),
    prisma.memberBadge.create({
      data: { memberId: m1.id, badgeId: badge0.id, progress: 1, unlockedAt: daysAgo(100) },
    }),
    prisma.memberBadge.create({
      data: { memberId: m0.id, badgeId: badge1.id, progress: 1, unlockedAt: daysAgo(90) },
    }),
  ]);

  // Assign tiers
  await Promise.all([
    prisma.memberTier.create({
      data: { memberId: m0.id, tierId: tier2.id, upgradedAt: daysAgo(90) },
    }),
    prisma.memberTier.create({
      data: { memberId: m1.id, tierId: tier1.id, upgradedAt: daysAgo(60) },
    }),
    prisma.memberTier.create({
      data: { memberId: m2.id, tierId: tier1.id, upgradedAt: daysAgo(45) },
    }),
    prisma.memberTier.create({
      data: { memberId: m6.id, tierId: tier0.id, upgradedAt: daysAgo(30) },
    }),
  ]);

  // === Segment ===
  await prisma.segment.create({
    data: {
      programId: program.id,
      name: "High Value Members",
      type: "DYNAMIC",
      rules: { field: "totalEarned", operator: "$gte", value: 10000 },
    },
  });

  // === Events ===
  await Promise.all(
    members.slice(0, 6).map((m, i) =>
      prisma.event.create({
        data: {
          programId: program.id,
          type: i < 2 ? "registration" : "purchase",
          memberId: m.id,
          payload: i < 2 ? {} : { amount: 2500 + i * 500 },
          idempotencyKey: `seed-event-${String(i)}`,
          processed: true,
          processedAt: m.joinedAt,
        },
      }),
    ),
  );
  console.log("Created events, tiers, badges, and segment assignments\n");

  // === Summary ===
  const counts = {
    programs: await prisma.program.count(),
    members: await prisma.member.count(),
    pointAccounts: await prisma.pointAccount.count(),
    pointTransactions: await prisma.pointTransaction.count(),
    tiers: await prisma.tier.count(),
    campaigns: await prisma.campaign.count(),
    coupons: await prisma.coupon.count(),
    rewards: await prisma.reward.count(),
    badges: await prisma.badge.count(),
    apiKeys: await prisma.apiKey.count(),
    adminUsers: await prisma.adminUser.count(),
  };

  console.log("Seed complete!\n");
  console.table(counts);
  console.log("\nAdmin UI ready at http://localhost:5173");
  console.log("API ready at http://localhost:3000");
}

main()
  .then(() => {
    void prisma.$disconnect();
  })
  .catch((err: unknown) => {
    console.error("Seed failed:", err);
    void prisma.$disconnect();
    process.exit(1);
  });
