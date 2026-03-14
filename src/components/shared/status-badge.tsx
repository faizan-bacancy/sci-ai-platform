import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export function StatusBadge({
  label,
  variant = "secondary",
  className,
}: {
  label: string;
  variant?: StatusBadgeVariant;
  className?: string;
}) {
  return (
    <Badge variant={variant} className={cn("whitespace-nowrap", className)}>
      {label}
    </Badge>
  );
}