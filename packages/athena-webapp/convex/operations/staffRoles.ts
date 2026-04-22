import { v } from "convex/values";

export const OPERATIONAL_ROLE_VALUES = [
  "manager",
  "front_desk",
  "stylist",
  "technician",
  "cashier",
] as const;

export type OperationalRole = (typeof OPERATIONAL_ROLE_VALUES)[number];

export const operationalRoleValidator = v.union(
  v.literal("manager"),
  v.literal("front_desk"),
  v.literal("stylist"),
  v.literal("technician"),
  v.literal("cashier")
);

export function deriveDefaultOperationalRoles(
  memberRole: "full_admin" | "pos_only"
): OperationalRole[] {
  if (memberRole === "full_admin") {
    return ["manager"];
  }

  return ["front_desk", "cashier"];
}

export function uniqueOperationalRoles(
  roles: OperationalRole[]
): OperationalRole[] {
  return Array.from(new Set(roles));
}
