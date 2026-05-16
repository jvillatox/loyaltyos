import { Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/layout/app-layout";
import { CampaignBuilderPage } from "@/pages/campaign-builder";
import { CampaignsListPage } from "@/pages/campaigns-list";
import { CouponBulkGeneratePage } from "@/pages/coupon-bulk-generate";
import { CouponsListPage } from "@/pages/coupons-list";
import { DashboardPage } from "@/pages/dashboard";
import { MemberDetailPage } from "@/pages/member-detail";
import { MembersListPage } from "@/pages/members-list";
import { SegmentBuilderPage } from "@/pages/segment-builder";
import { SegmentsListPage } from "@/pages/segments-list";

export function App(): JSX.Element {
  return (
    <Routes>
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
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound(): JSX.Element {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Page not found</p>
        <a href="/" className="mt-4 inline-block text-primary underline">
          Back to Dashboard
        </a>
      </div>
    </div>
  );
}
