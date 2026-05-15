import { Outlet } from "react-router-dom";

import { Sidebar } from "./sidebar";

export function AppLayout(): JSX.Element {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="ml-64 flex-1 p-8">{<Outlet />}</main>
    </div>
  );
}
