import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  Truck,
  FileUp,
} from "lucide-react";

export const navSections = [
  {
    label: "Core",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/products", label: "Products", icon: Package },
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/suppliers", label: "Suppliers", icon: Truck },
      { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
    ],
  },
  {
    label: "Data",
    items: [{ href: "/import", label: "Import Center", icon: FileUp }],
  },
  {
    label: "Insights",
    items: [
      { href: "/forecasting", label: "Forecasting", icon: BarChart3 },
      { href: "/alerts", label: "Alerts", icon: AlertTriangle },
    ],
  },
  {
    label: "Settings",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
] as const;
