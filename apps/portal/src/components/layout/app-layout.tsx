import { Outlet } from "react-router-dom";

import BottomNav from "./bottom-nav";

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-surface)] text-[var(--color-text)]">
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
