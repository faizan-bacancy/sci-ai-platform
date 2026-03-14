export const dynamic = "force-dynamic";
import { getDashboardData } from "@/features/dashboard/dashboard-data";
import { DashboardPage } from "@/features/dashboard/dashboard-page";

export default async function DashboardRoute({
  searchParams,
}: {
  searchParams?: { range?: string; warehouse?: string };
}) {
  const payload = await getDashboardData({
    range: searchParams?.range,
    warehouse: searchParams?.warehouse,
  });

  return <DashboardPage payload={payload} />;
}
