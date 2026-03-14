"use client";

import { create } from "zustand";

type AlertsState = {
  criticalUnacknowledgedCount: number;
  setCriticalUnacknowledgedCount: (count: number) => void;
};

export const useAlertsStore = create<AlertsState>((set) => ({
  criticalUnacknowledgedCount: 0,
  setCriticalUnacknowledgedCount: (criticalUnacknowledgedCount) => set({ criticalUnacknowledgedCount }),
}));
