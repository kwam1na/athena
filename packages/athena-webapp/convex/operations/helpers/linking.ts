import { Doc, Id } from "../../_generated/dataModel";

import {
  deriveDefaultOperationalRoles,
  type OperationalRole,
  uniqueOperationalRoles,
} from "../staffRoles";

export type CustomerProfileDraft = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  preferredContactChannel?: string;
  status: "active";
  storeFrontUserId?: Id<"storeFrontUser">;
  guestId?: Id<"guest">;
  posCustomerId?: Id<"posCustomer">;
};

export type CustomerProfileMatch = Pick<
  Doc<"customerProfile">,
  | "_id"
  | "storeId"
  | "organizationId"
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phoneNumber"
  | "preferredContactChannel"
  | "status"
  | "storeFrontUserId"
  | "guestId"
  | "posCustomerId"
>;

export type CustomerLinkSources = {
  storeFrontUser?: Doc<"storeFrontUser"> | null;
  guest?: Doc<"guest"> | null;
  posCustomer?: Doc<"posCustomer"> | null;
  fallbackStoreId?: Id<"store">;
  fallbackOrganizationId?: Id<"organization">;
};

export type CustomerMatchArgs = {
  storeId: Id<"store">;
  storeFrontUserId?: Id<"storeFrontUser">;
  guestId?: Id<"guest">;
  posCustomerId?: Id<"posCustomer">;
  email?: string;
  phoneNumber?: string;
};

export function normalizeLookupValue(value?: string | null) {
  return value?.trim().toLowerCase() || undefined;
}

export function normalizePhoneNumber(value?: string | null) {
  return value?.trim() || undefined;
}

function splitFullName(name?: string | null) {
  const trimmed = name?.trim();

  if (!trimmed) {
    return { firstName: undefined, lastName: undefined };
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: undefined };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function buildFullName(parts: {
  firstName?: string | null;
  lastName?: string | null;
  fallbackName?: string | null;
  fallbackEmail?: string | null;
}) {
  const firstName = parts.firstName?.trim();
  const lastName = parts.lastName?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (fullName.length > 0) {
    return fullName;
  }

  if (parts.fallbackName?.trim()) {
    return parts.fallbackName.trim();
  }

  if (parts.fallbackEmail?.trim()) {
    return parts.fallbackEmail.trim();
  }

  return "Customer";
}

export function buildCustomerProfileDraft(
  sources: CustomerLinkSources
): CustomerProfileDraft {
  const storeId =
    sources.storeFrontUser?.storeId ??
    sources.guest?.storeId ??
    sources.posCustomer?.storeId ??
    sources.fallbackStoreId;

  if (!storeId) {
    throw new Error("Customer profile draft requires a store scope");
  }

  const organizationId =
    sources.storeFrontUser?.organizationId ??
    sources.guest?.organizationId ??
    sources.fallbackOrganizationId;

  const nameFromPos = splitFullName(sources.posCustomer?.name);
  const firstName =
    sources.storeFrontUser?.firstName ??
    sources.guest?.firstName ??
    nameFromPos.firstName;
  const lastName =
    sources.storeFrontUser?.lastName ??
    sources.guest?.lastName ??
    nameFromPos.lastName;
  const email =
    normalizeLookupValue(
      sources.storeFrontUser?.email ??
        sources.guest?.email ??
        sources.posCustomer?.email
    );
  const phoneNumber =
    normalizePhoneNumber(
      sources.storeFrontUser?.phoneNumber ??
        sources.guest?.phoneNumber ??
        sources.posCustomer?.phone
    );
  const fullName = buildFullName({
    firstName,
    lastName,
    fallbackName: sources.posCustomer?.name,
    fallbackEmail: email,
  });

  return {
    storeId,
    organizationId,
    fullName,
    firstName,
    lastName,
    email,
    phoneNumber,
    preferredContactChannel: email ? "email" : phoneNumber ? "phone" : undefined,
    status: "active",
    storeFrontUserId: sources.storeFrontUser?._id,
    guestId: sources.guest?._id,
    posCustomerId: sources.posCustomer?._id,
  };
}

export function findMatchingCustomerProfile(
  profiles: CustomerProfileMatch[],
  args: CustomerMatchArgs
) {
  const directMatch = profiles.find(
    (profile) =>
      profile.storeId === args.storeId &&
      ((args.storeFrontUserId && profile.storeFrontUserId === args.storeFrontUserId) ||
        (args.guestId && profile.guestId === args.guestId) ||
        (args.posCustomerId && profile.posCustomerId === args.posCustomerId))
  );

  if (directMatch) {
    return directMatch;
  }

  const normalizedEmail = normalizeLookupValue(args.email);

  if (normalizedEmail) {
    const emailMatch = profiles.find(
      (profile) =>
        profile.storeId === args.storeId &&
        normalizeLookupValue(profile.email) === normalizedEmail
    );

    if (emailMatch) {
      return emailMatch;
    }
  }

  const normalizedPhone = normalizeLookupValue(args.phoneNumber);

  if (!normalizedPhone) {
    return null;
  }

  return (
    profiles.find(
      (profile) =>
        profile.storeId === args.storeId &&
        normalizeLookupValue(profile.phoneNumber) === normalizedPhone
    ) ?? null
  );
}

export {
  deriveDefaultOperationalRoles,
  uniqueOperationalRoles,
  type OperationalRole,
};
