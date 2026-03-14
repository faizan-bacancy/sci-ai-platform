import type { UserRole } from "@/lib/types";

export function canWrite(role: UserRole) {
  return role !== "viewer";
}

export function canDelete(role: UserRole) {
  return role === "admin" || role === "manager";
}