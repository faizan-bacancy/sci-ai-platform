import { SupplierDetailPage } from "@/features/suppliers/supplier-detail-page";

export default async function SupplierDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SupplierDetailPage supplierId={id} />;
}