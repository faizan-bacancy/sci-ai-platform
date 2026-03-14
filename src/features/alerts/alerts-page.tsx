"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { parseAsString, useQueryState } from "nuqs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "@/components/app/profile-context";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SlideOverPanel } from "@/components/shared/slide-over-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { canWrite } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/browser";

type AlertType =
  | "stockout_risk"
  | "reorder_required"
  | "overstock"
  | "po_overdue"
  | "supplier_performance"
  | "low_forecast_accuracy";

type AlertSeverity = "critical" | "warning" | "info";

type AlertFilterStatus = "active" | "open" | "acknowledged" | "dismissed";

type AlertRow = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  product_id: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  purchase_order_id: string | null;
  title: string;
  message: string;
  recommended_action: string | null;
  is_acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  is_dismissed: boolean;
  dismissed_by: string | null;
  dismissed_at: string | null;
  auto_resolves_at: string | null;
  created_at: string;
  product?: { id: string; name: string; sku: string } | null;
  supplier?: { id: string; company_name: string } | null;
  warehouse?: { id: string; name: string; code: string } | null;
  purchase_order?: { id: string; po_number: string } | null;
};

type AlertSummary = {
  critical: number;
  warning: number;
  info: number;
  unacknowledged: number;
};

type WarehouseOption = { id: string; name: string; code: string };

type TriggeringHealth = {
  days_of_stock_remaining: number | null;
  stock_status: string;
  quantity_available: number;
  reorder_point: number;
  safety_stock: number;
  eoq: number;
  avg_daily_demand: number;
  recommended_action: string;
};

const alertTypeLabels: Record<AlertType, string> = {
  stockout_risk: "Stockout risk",
  reorder_required: "Reorder required",
  overstock: "Overstock",
  po_overdue: "PO overdue",
  supplier_performance: "Supplier performance",
  low_forecast_accuracy: "Forecast accuracy",
};

function getAlertStatus(alert: AlertRow): "open" | "acknowledged" | "dismissed" {
  if (alert.is_dismissed || alert.auto_resolves_at) return "dismissed";
  if (alert.is_acknowledged) return "acknowledged";
  return "open";
}

function severityBadge(severity: AlertSeverity) {
  if (severity === "critical") {
    return <Badge variant="destructive">Critical</Badge>;
  }
  if (severity === "warning") {
    return <Badge className="bg-orange-100 text-orange-700">Warning</Badge>;
  }
  return <Badge variant="secondary">Info</Badge>;
}

function summaryCardTone(severity: AlertSeverity) {
  if (severity === "critical") return "border-destructive/40 bg-destructive/5";
  if (severity === "warning") return "border-orange-200 bg-orange-50";
  return "border-border bg-muted/20";
}

function affectedEntityLabel(alert: AlertRow) {
  if (alert.product) return `${alert.product.name} (${alert.product.sku})`;
  if (alert.supplier) return alert.supplier.company_name;
  if (alert.purchase_order) return `PO ${alert.purchase_order.po_number}`;
  return "-";
}

async function fetchAlertSummary(): Promise<AlertSummary> {
  const supabase = createClient();

  const [{ count: critical }, { count: warning }, { count: info }, { count: unacknowledged }] = await Promise.all([
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical")
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("severity", "warning")
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("severity", "info")
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("is_acknowledged", false)
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null),
  ]);

  return {
    critical: critical ?? 0,
    warning: warning ?? 0,
    info: info ?? 0,
    unacknowledged: unacknowledged ?? 0,
  };
}

async function fetchWarehouses() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("id,name,code")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as WarehouseOption[];
}

async function fetchAlerts(params: {
  q: string;
  severity: string;
  type: string;
  status: AlertFilterStatus;
  warehouse: string;
}) {
  const supabase = createClient();

  let query = supabase
    .from("alerts")
    .select(
      "id,type,severity,product_id,supplier_id,warehouse_id,purchase_order_id,title,message,recommended_action,is_acknowledged,acknowledged_by,acknowledged_at,is_dismissed,dismissed_by,dismissed_at,auto_resolves_at,created_at,product:products(id,name,sku),supplier:suppliers(id,company_name),warehouse:warehouses(id,name,code),purchase_order:purchase_orders(id,po_number)",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (params.q.trim()) {
    const search = params.q.trim();
    query = query.or(`title.ilike.%${search}%,message.ilike.%${search}%`);
  }

  if (params.severity !== "all") {
    query = query.eq("severity", params.severity);
  }

  if (params.type !== "all") {
    query = query.eq("type", params.type);
  }

  if (params.warehouse !== "all") {
    query = query.eq("warehouse_id", params.warehouse);
  }

  if (params.status === "active") {
    query = query.eq("is_dismissed", false).is("auto_resolves_at", null);
  } else if (params.status === "open") {
    query = query
      .eq("is_acknowledged", false)
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null);
  } else if (params.status === "acknowledged") {
    query = query
      .eq("is_acknowledged", true)
      .eq("is_dismissed", false)
      .is("auto_resolves_at", null);
  } else {
    query = query.or("is_dismissed.eq.true,auto_resolves_at.not.is.null");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []) as unknown as AlertRow[];
}

export function AlertsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const writable = canWrite(profile.role);

  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [severity, setSeverity] = useQueryState("severity", parseAsString.withDefault("all"));
  const [type, setType] = useQueryState("type", parseAsString.withDefault("all"));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("active"));
  const [warehouse, setWarehouse] = useQueryState("warehouse", parseAsString.withDefault("all"));
  const [sort, setSort] = useQueryState("sort", parseAsString.withDefault("newest"));
  const [alertId, setAlertId] = useQueryState("alertId", parseAsString.withDefault(""));

  const alertsParams = useMemo(
    () => ({
      q,
      severity,
      type,
      status: status as AlertFilterStatus,
      warehouse,
    }),
    [q, severity, status, type, warehouse],
  );

  const { data: alerts, isLoading, error } = useQuery({
    queryKey: ["alerts", alertsParams],
    queryFn: () => fetchAlerts(alertsParams),
  });

  const { data: summary } = useQuery({
    queryKey: ["alerts_summary"],
    queryFn: fetchAlertSummary,
  });

  const { data: warehouseOptions } = useQuery({
    queryKey: ["alerts_warehouses"],
    queryFn: fetchWarehouses,
  });

  const selectedAlert = useMemo(
    () => (alerts ?? []).find((item) => item.id === alertId) ?? null,
    [alerts, alertId],
  );

  const sortedAlerts = useMemo(() => {
    const rows = [...(alerts ?? [])];

    if (sort === "oldest") {
      rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return rows;
    }

    if (sort === "severity") {
      const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
      rows.sort((a, b) => {
        const diff = rank[a.severity] - rank[b.severity];
        if (diff !== 0) return diff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      return rows;
    }

    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return rows;
  }, [alerts, sort]);

  const { data: triggeringData, isLoading: isTriggeringDataLoading } = useQuery({
    queryKey: ["alert_triggering_data", selectedAlert?.id],
    enabled: !!selectedAlert?.product_id && !!selectedAlert?.warehouse_id,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_inventory_health", {
        p_product_id: selectedAlert?.product_id,
        p_warehouse_id: selectedAlert?.warehouse_id,
      });

      if (rpcError) throw new Error(rpcError.message);
      return ((data as TriggeringHealth[] | null) ?? [])[0] ?? null;
    },
  });

  const updateAlertMutation = useMutation({
    mutationFn: async (payload: Partial<AlertRow> & { id: string }) => {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("alerts")
        .update(payload)
        .eq("id", payload.id);

      if (updateError) throw new Error(updateError.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["alerts_summary"] });
    },
  });

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("alerts-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["alerts"] });
        void queryClient.invalidateQueries({ queryKey: ["alerts_summary"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        subtitle="Monitor inventory, purchase order, and supplier exceptions in real time."
        actions={<Link href="/inventory" className="text-sm text-primary underline">Go to inventory</Link>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className={summaryCardTone("critical")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary?.critical ?? 0}</div>
          </CardContent>
        </Card>
        <Card className={summaryCardTone("warning")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary?.warning ?? 0}</div>
          </CardContent>
        </Card>
        <Card className={summaryCardTone("info")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary?.info ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unacknowledged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary?.unacknowledged ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={status} onValueChange={(value) => { void setStatus(value); }}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="acknowledged">Acknowledged</TabsTrigger>
          <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar>
        <div className="flex flex-1 items-center gap-2">
          <Input
            placeholder="Search alerts..."
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
        </div>

        <Select value={severity} onValueChange={(value) => { void setSeverity(value); }}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={type} onValueChange={(value) => { void setType(value); }}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="stockout_risk">Stockout risk</SelectItem>
            <SelectItem value="reorder_required">Reorder required</SelectItem>
            <SelectItem value="overstock">Overstock</SelectItem>
            <SelectItem value="po_overdue">PO overdue</SelectItem>
            <SelectItem value="supplier_performance">Supplier performance</SelectItem>
          </SelectContent>
        </Select>

        <Select value={warehouse} onValueChange={(value) => { void setWarehouse(value); }}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Warehouse">
              {(() => {
                if (!warehouse || warehouse === "all") return "All warehouses";
                const selected = (warehouseOptions ?? []).find((item) => item.id === warehouse);
                return selected?.name ?? "All warehouses";
              })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {(warehouseOptions ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(value) => { void setSort(value); }}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="severity">Severity</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? <div className="rounded-md border p-4 text-sm text-destructive">{(error as Error).message}</div> : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Affected</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Recommended action</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  Loading alerts...
                </TableCell>
              </TableRow>
            ) : sortedAlerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  No alerts found.
                </TableCell>
              </TableRow>
            ) : (
              sortedAlerts.map((alert) => {
                const statusValue = getAlertStatus(alert);
                return (
                  <TableRow
                    key={alert.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setAlertId(alert.id);
                    }}
                  >
                    <TableCell>{severityBadge(alert.severity)}</TableCell>
                    <TableCell>{alertTypeLabels[alert.type]}</TableCell>
                    <TableCell>{affectedEntityLabel(alert)}</TableCell>
                    <TableCell className="max-w-[340px] truncate" title={alert.message}>{alert.message}</TableCell>
                    <TableCell className="max-w-[280px] truncate" title={alert.recommended_action ?? ""}>
                      {alert.recommended_action ?? "-"}
                    </TableCell>
                    <TableCell>
                      <span suppressHydrationWarning>{formatDistanceToNowStrict(new Date(alert.created_at), { addSuffix: true })}</span>
                    </TableCell>
                    <TableCell>
                      {statusValue === "open" ? (
                        <Badge variant="outline">Open</Badge>
                      ) : statusValue === "acknowledged" ? (
                        <Badge variant="secondary">Acknowledged</Badge>
                      ) : (
                        <Badge variant="outline">Dismissed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <SlideOverPanel
        open={!!selectedAlert}
        onOpenChange={(open) => {
          if (!open) {
            setAlertId("");
          }
        }}
        title={selectedAlert ? selectedAlert.title : "Alert detail"}
        footer={
          selectedAlert ? (
            <div className="flex flex-wrap justify-end gap-2">
              {selectedAlert.product_id && selectedAlert.warehouse_id && selectedAlert.recommended_action?.toLowerCase().includes("reorder") ? (
                <Button
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams({
                      prefillProductId: selectedAlert.product_id ?? "",
                      prefillWarehouseId: selectedAlert.warehouse_id ?? "",
                    });

                    if (triggeringData?.eoq && triggeringData.eoq > 0) {
                      params.set("prefillQty", Math.ceil(triggeringData.eoq).toString());
                    }

                    router.push(`/purchase-orders?${params.toString()}`);
                  }}
                >
                  Create purchase order
                </Button>
              ) : null}

              {writable && !selectedAlert.is_acknowledged && !selectedAlert.is_dismissed ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    updateAlertMutation.mutate({
                      id: selectedAlert.id,
                      is_acknowledged: true,
                      acknowledged_by: profile.id,
                      acknowledged_at: new Date().toISOString(),
                    });
                  }}
                  disabled={updateAlertMutation.isPending}
                >
                  Acknowledge
                </Button>
              ) : null}

              {writable && !selectedAlert.is_dismissed ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    updateAlertMutation.mutate({
                      id: selectedAlert.id,
                      is_dismissed: true,
                      dismissed_by: profile.id,
                      dismissed_at: new Date().toISOString(),
                    });
                  }}
                  disabled={updateAlertMutation.isPending}
                >
                  Dismiss
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {selectedAlert ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {severityBadge(selectedAlert.severity)}
              <Badge variant="outline">{alertTypeLabels[selectedAlert.type]}</Badge>
              <Badge variant="outline">{getAlertStatus(selectedAlert)}</Badge>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Message</div>
              <div className="text-sm">{selectedAlert.message}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Recommended action</div>
              <div className="text-sm">{selectedAlert.recommended_action ?? "-"}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Affected entity</div>
              <div className="text-sm">{affectedEntityLabel(selectedAlert)}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground">Created</div>
              <div className="text-sm"><span suppressHydrationWarning>{new Date(selectedAlert.created_at).toLocaleString()}</span></div>
            </div>

            {selectedAlert.product_id && selectedAlert.warehouse_id ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Triggering data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  {isTriggeringDataLoading ? (
                    <div className="text-muted-foreground">Loading stock metrics...</div>
                  ) : triggeringData ? (
                    <>
                      <div>Quantity available: {Number(triggeringData.quantity_available).toFixed(2)}</div>
                      <div>Reorder point: {Number(triggeringData.reorder_point).toFixed(2)}</div>
                      <div>Safety stock: {Number(triggeringData.safety_stock).toFixed(2)}</div>
                      <div>Days of stock: {triggeringData.days_of_stock_remaining ? Number(triggeringData.days_of_stock_remaining).toFixed(1) : "N/A"}</div>
                      <div>Stock status: {triggeringData.stock_status}</div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">No triggering metrics available.</div>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {selectedAlert.purchase_order ? (
              <div className="text-sm">
                Related purchase order: <Link href={`/purchase-orders/${selectedAlert.purchase_order.id}`} className="text-primary underline">{selectedAlert.purchase_order.po_number}</Link>
              </div>
            ) : null}

            {updateAlertMutation.error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {(updateAlertMutation.error as Error).message}
              </div>
            ) : null}
          </div>
        ) : null}
      </SlideOverPanel>
    </div>
  );
}



