import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-layout";
import { BadgeEditorPage } from "@/pages/badge-editor";
import { BadgesListPage } from "@/pages/badges-list";
import { CampaignBuilderPage } from "@/pages/campaign-builder";
import { CampaignsListPage } from "@/pages/campaigns-list";
import { CoalitionConfigPage } from "@/pages/coalition/config";
import { CoalitionLinkedMembersPage } from "@/pages/coalition/linked-members";
import { CoalitionTransactionsPage } from "@/pages/coalition/transactions";
import { CouponBulkGeneratePage } from "@/pages/coupon-bulk-generate";
import { CouponsListPage } from "@/pages/coupons-list";
import { DashboardPage } from "@/pages/dashboard";
import { LoginPage } from "@/pages/login";
import { MemberDetailPage } from "@/pages/member-detail";
import { MembersListPage } from "@/pages/members-list";
import { RewardsEditorPage } from "@/pages/rewards/rewards-editor";
import { RewardsListPage } from "@/pages/rewards/rewards-list";
import { RewardsRedemptionsPage } from "@/pages/rewards/rewards-redemptions";
import { SegmentBuilderPage } from "@/pages/segment-builder";
import { SegmentsListPage } from "@/pages/segments-list";
import { TiersListPage } from "@/pages/tiers-list";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/members" element={<MembersListPage />} />
        <Route path="/members/:id" element={<MemberDetailPage />} />
        <Route path="/campaigns" element={<CampaignsListPage />} />
        <Route path="/campaigns/new" element={<CampaignBuilderPage />} />
        <Route path="/campaigns/:id/edit" element={<CampaignBuilderPage />} />
        <Route path="/coupons" element={<CouponsListPage />} />
        <Route path="/coupons/generate" element={<CouponBulkGeneratePage />} />
        <Route path="/segments" element={<SegmentsListPage />} />
        <Route path="/segments/new" element={<SegmentBuilderPage />} />
        <Route path="/segments/:id/edit" element={<SegmentBuilderPage />} />
        <Route path="/badges" element={<BadgesListPage />} />
        <Route path="/badges/new" element={<BadgeEditorPage />} />
        <Route path="/badges/:id/edit" element={<BadgeEditorPage />} />
        <Route path="/tiers" element={<TiersListPage />} />
        <Route path="/rewards" element={<RewardsListPage />} />
        <Route path="/rewards/new" element={<RewardsEditorPage />} />
        <Route path="/rewards/:id/edit" element={<RewardsEditorPage />} />
        <Route path="/rewards/:id/redemptions" element={<RewardsRedemptionsPage />} />
        <Route path="/coalition" element={<CoalitionConfigPage />} />
        <Route path="/coalition/transactions" element={<CoalitionTransactionsPage />} />
        <Route path="/coalition/members" element={<CoalitionLinkedMembersPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">{t("errors.pageNotFound")}</p>
        <a href="/" className="mt-4 inline-block text-primary underline">
          {t("errors.backToDashboard")}
        </a>
      </div>
    </div>
  );
}
