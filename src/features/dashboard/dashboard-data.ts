import { createClient } from "@/lib/supabase/server";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "partially_received"
  | "received"
  | "cancelled";

type InventoryRecord = {
  id: string;
  qty_on_hand: number;
  qty_reserved: number;
  warehouse_id: string;
  product?: { id: string; sku: string; name: string; unit_cost: number | null };
  warehouse?: { id: string; name: string };
  inventory_parameters?: { calculated_reorder_point: number | null } | null;
};

type PurchaseOrderRecord = {
  id: string;
  po_number: string;
  status: PurchaseOrderStatus;
  order_date: string | null;
  expected_delivery_date: string | null;
  total_amount: number | null;
  created_at: string;
  supplier?: { company_name: string };
};

type AuditLogRecord = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

type ProfileRow = { id: string; name: string; email: string };

export type DashboardFilters = {
  rangeDays: 7 | 30 | 90;
  warehouseId: string | "all";
};

export type DashboardKpis = {
  inventoryValue: number;
  atRiskSkus: number;
  stockoutSkus: number;
  openPoCount: number;
  openPoValue: number;
};

export type DashboardTrendPoint = {
  date: string;
  spend: number;
};

export type DashboardRiskBar = {
  status: "Stockout" | "At Risk" | "Healthy";
  count: number;
};

export type LowStockRow = {
  id: string;
  sku: string;
  productName: string;
  warehouseName: string;
  available: number;
  reorderPoint: number;
};

export type OpenPoRow = {
  id: string;
  poNumber: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  totalAmount: number;
};

export type RecentItem = {
  id: string;
  timestamp: string;
  actor: string;
  entity: string;
  action: string;
  summary: string;
};

export type DashboardPayload = {
  greetingName: string;
  filters: DashboardFilters;
  warehouses: { id: string; name: string }[];
  kpis: DashboardKpis;
  spendTrend: DashboardTrendPoint[];
  riskDistribution: DashboardRiskBar[];
  lowStockRows: LowStockRow[];
  openPurchaseOrders: OpenPoRow[];
  recentItems: RecentItem[];
};

const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "sent",
  "confirmed",
  "partially_received",
];

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function clampRangeDays(value?: string): 7 | 30 | 90 {
  if (value === "7") return 7;
  if (value === "90") return 90;
  return 30;
}

function startDateFromRange(days: 7 | 30 | 90) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
}

function buildDateAxis(days: 7 | 30 | 90) {
  const start = startDateFromRange(days);
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    return toIsoDate(d);
  });
}

function normalizeNumber(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export async function getDashboardData(input: {
  range?: string;
  warehouse?: string;
}): Promise<DashboardPayload> {
  const rangeDays = clampRangeDays(input.range);
  const warehouseId = input.warehouse && input.warehouse !== "all" ? input.warehouse : "all";
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("name").eq("id", user.id).single()
    : { data: null };

  const { data: warehouseRows } = await supabase
    .from("warehouses")
    .select("id,name")
    .order("name", { ascending: true });

  let inventoryQuery = supabase
    .from("inventory")
    .select(
      "id,qty_on_hand,qty_reserved,warehouse_id,product:products(id,sku,name,unit_cost),warehouse:warehouses(id,name),inventory_parameters:inventory_parameters(calculated_reorder_point)",
    );

  if (warehouseId !== "all") {
    inventoryQuery = inventoryQuery.eq("warehouse_id", warehouseId);
  }

  const { data: inventoryRowsData } = await inventoryQuery;
  const inventoryRows = (inventoryRowsData ?? []) as unknown as InventoryRecord[];

  const dateStart = toIsoDate(startDateFromRange(rangeDays));

  let poQuery = supabase
    .from("purchase_orders")
    .select("id,po_number,status,order_date,expected_delivery_date,total_amount,created_at,supplier:suppliers(company_name)")
    .gte("order_date", dateStart)
    .order("created_at", { ascending: false });

  if (warehouseId !== "all") {
    poQuery = poQuery.eq("warehouse_id", warehouseId);
  }

  const { data: poRowsData } = await poQuery;
  const poRows = (poRowsData ?? []) as unknown as PurchaseOrderRecord[];

  const recentAuditLimit = 20;
  const { data: auditRowsData } = await supabase
    .from("audit_logs")
    .select("id,action,entity_type,entity_id,actor_user_id,created_at,metadata")
    .order("created_at", { ascending: false })
    .limit(recentAuditLimit);

  const auditRows = (auditRowsData ?? []) as unknown as AuditLogRecord[];

  const actorIds = Array.from(
    new Set(auditRows.map((row) => row.actor_user_id).filter(Boolean) as string[]),
  );

  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await supabase
      .from("profiles")
      .select("id,name,email")
      .in("id", actorIds);

    for (const profileRow of (actorProfiles ?? []) as ProfileRow[]) {
      actorMap.set(profileRow.id, profileRow.name || profileRow.email);
    }
  }

  const kpis = inventoryRows.reduce<DashboardKpis>(
    (acc, row) => {
      const onHand = normalizeNumber(row.qty_on_hand);
      const reserved = normalizeNumber(row.qty_reserved);
      const available = onHand - reserved;
      const unitCost = normalizeNumber(row.product?.unit_cost);
      const reorderPoint = normalizeNumber(row.inventory_parameters?.calculated_reorder_point);

      acc.inventoryValue += onHand * unitCost;
      if (available <= 0) {
        acc.stockoutSkus += 1;
        acc.atRiskSkus += 1;
      } else if (available <= (reorderPoint > 0 ? reorderPoint : 10)) {
        acc.atRiskSkus += 1;
      }

      return acc;
    },
    {
      inventoryValue: 0,
      atRiskSkus: 0,
      stockoutSkus: 0,
      openPoCount: 0,
      openPoValue: 0,
    },
  );

  for (const po of poRows) {
    if (OPEN_PO_STATUSES.includes(po.status)) {
      kpis.openPoCount += 1;
      kpis.openPoValue += normalizeNumber(po.total_amount);
    }
  }

  const dateAxis = buildDateAxis(rangeDays);
  const spendByDate = new Map<string, number>(dateAxis.map((date) => [date, 0]));

  for (const po of poRows) {
    const date = po.order_date ?? po.created_at.slice(0, 10);
    if (spendByDate.has(date)) {
      spendByDate.set(date, normalizeNumber(spendByDate.get(date)) + normalizeNumber(po.total_amount));
    }
  }

  const spendTrend: DashboardTrendPoint[] = dateAxis.map((date) => ({
    date,
    spend: normalizeNumber(spendByDate.get(date)),
  }));

  const riskCounts = {
    stockout: 0,
    atRisk: 0,
    healthy: 0,
  };

  for (const row of inventoryRows) {
    const available = normalizeNumber(row.qty_on_hand) - normalizeNumber(row.qty_reserved);
    const reorderPoint = normalizeNumber(row.inventory_parameters?.calculated_reorder_point);
    const riskThreshold = reorderPoint > 0 ? reorderPoint : 10;

    if (available <= 0) {
      riskCounts.stockout += 1;
    } else if (available <= riskThreshold) {
      riskCounts.atRisk += 1;
    } else {
      riskCounts.healthy += 1;
    }
  }

  const riskDistribution: DashboardRiskBar[] = [
    { status: "Stockout", count: riskCounts.stockout },
    { status: "At Risk", count: riskCounts.atRisk },
    { status: "Healthy", count: riskCounts.healthy },
  ];

  const lowStockRows = inventoryRows
    .map((row) => {
      const available = normalizeNumber(row.qty_on_hand) - normalizeNumber(row.qty_reserved);
      const reorderPoint = normalizeNumber(row.inventory_parameters?.calculated_reorder_point || 10);
      return {
        id: row.id,
        sku: row.product?.sku ?? "-",
        productName: row.product?.name ?? "Unknown",
        warehouseName: row.warehouse?.name ?? "Unknown",
        available,
        reorderPoint,
      };
    })
    .filter((row) => row.available <= row.reorderPoint)
    .sort((a, b) => a.available - b.available)
    .slice(0, 8);

  const openPurchaseOrders: OpenPoRow[] = poRows
    .filter((row) => OPEN_PO_STATUSES.includes(row.status))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      poNumber: row.po_number,
      supplierName: row.supplier?.company_name ?? "Unknown",
      status: row.status,
      orderDate: row.order_date,
      expectedDeliveryDate: row.expected_delivery_date,
      totalAmount: normalizeNumber(row.total_amount),
    }));

  const auditItems: RecentItem[] = auditRows.map((row) => ({
    id: `audit-${row.id}`,
    timestamp: row.created_at,
    actor: row.actor_user_id ? actorMap.get(row.actor_user_id) ?? "User" : "System",
    entity: row.entity_type ?? "record",
    action: row.action,
    summary: row.entity_id
      ? `${row.action} ${row.entity_type ?? "record"}`
      : `${row.action} ${row.entity_type ?? "record"}`,
  }));

  const poItems: RecentItem[] = poRows.slice(0, 10).map((row) => ({
    id: `po-${row.id}`,
    timestamp: row.created_at,
    actor: "System",
    entity: "purchase_order",
    action: row.status,
    summary: `${row.po_number} is ${row.status.replace("_", " ")}`,
  }));

  const recentItems = [...auditItems, ...poItems]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  return {
    greetingName: profile?.name ?? "",
    filters: { rangeDays, warehouseId },
    warehouses: (warehouseRows ?? []) as { id: string; name: string }[],
    kpis: {
      inventoryValue: Number(kpis.inventoryValue.toFixed(2)),
      atRiskSkus: kpis.atRiskSkus,
      stockoutSkus: kpis.stockoutSkus,
      openPoCount: kpis.openPoCount,
      openPoValue: Number(kpis.openPoValue.toFixed(2)),
    },
    spendTrend,
    riskDistribution,
    lowStockRows,
    openPurchaseOrders,
    recentItems,
  };
}
