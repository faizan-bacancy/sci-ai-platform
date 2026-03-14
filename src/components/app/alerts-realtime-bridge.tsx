"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/browser";
import { useAlertsStore } from "@/stores/alerts-store";

type AlertRealtimeRow = {
  [key: string]: unknown;
  id: string;
  severity: unknown;
  title: unknown;
  message: unknown;
  is_acknowledged: unknown;
  is_dismissed: unknown;
  auto_resolves_at: unknown;
};

export function AlertsRealtimeBridge() {
  const router = useRouter();
  const setCriticalUnacknowledgedCount = useAlertsStore((state) => state.setCriticalUnacknowledgedCount);

  useEffect(() => {
    const supabase = createClient();

    const refreshCriticalCount = async () => {
      const { count, error } = await supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("severity", "critical")
        .eq("is_acknowledged", false)
        .eq("is_dismissed", false)
        .is("auto_resolves_at", null);

      if (!error) {
        setCriticalUnacknowledgedCount(count ?? 0);
      }
    };

    const channel = supabase
      .channel("global-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        (payload) => {
          void refreshCriticalCount();

          if (payload.eventType !== "INSERT") {
            return;
          }

          const row = payload.new as AlertRealtimeRow;
          const severity = String(row.severity ?? "").toLowerCase();
          const isAcknowledged = row.is_acknowledged === true || row.is_acknowledged === "true" || row.is_acknowledged === "t";
          const isDismissed = row.is_dismissed === true || row.is_dismissed === "true" || row.is_dismissed === "t";
          const isOpenCritical = severity === "critical" && !isAcknowledged && !isDismissed && !row.auto_resolves_at;

          if (!isOpenCritical) {
            return;
          }

          toast.error(String(row.title ?? "Critical alert"), {
            description: String(row.message ?? "A new critical alert was created."),
            action: {
              label: "View",
              onClick: () => {
                router.push(`/alerts?alertId=${String(row.id)}`);
              },
            },
          });
        },
      )
      .subscribe();

    void refreshCriticalCount();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, setCriticalUnacknowledgedCount]);

  return null;
}


