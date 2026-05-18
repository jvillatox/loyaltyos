import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "./components/layout/app-layout";
import { isAuthenticated } from "./lib/auth";
import Badges from "./pages/badges";
import Home from "./pages/home";
import Profile from "./pages/profile";
import RewardDetail from "./pages/reward-detail";
import Rewards from "./pages/rewards";
import Transactions from "./pages/transactions";
import Verify from "./pages/verify";

function AuthGuard({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/verify" element={<Verify />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route
          path="/transactions"
          element={
            <AuthGuard>
              <Transactions />
            </AuthGuard>
          }
        />
        <Route
          path="/rewards"
          element={
            <AuthGuard>
              <Rewards />
            </AuthGuard>
          }
        />
        <Route
          path="/rewards/:id"
          element={
            <AuthGuard>
              <RewardDetail />
            </AuthGuard>
          }
        />
        <Route
          path="/badges"
          element={
            <AuthGuard>
              <Badges />
            </AuthGuard>
          }
        />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
