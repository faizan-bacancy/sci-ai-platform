import { PurchaseOrderDetailPage } from "@/features/purchase-orders/purchase-order-detail-page";

export default async function PurchaseOrderDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PurchaseOrderDetailPage purchaseOrderId={id} />;
}