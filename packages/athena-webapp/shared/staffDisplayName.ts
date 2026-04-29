export type StaffDisplayNameParts = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
};

function normalizeNamePart(value?: string | null) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed || undefined;
}

export function formatStaffDisplayName(
  staffProfile?: StaffDisplayNameParts | null,
) {
  if (!staffProfile) {
    return null;
  }

  const firstName = normalizeNamePart(staffProfile.firstName);
  const lastName = normalizeNamePart(staffProfile.lastName);

  if (firstName && lastName) {
    return `${firstName} ${lastName.charAt(0)}.`;
  }

  if (firstName) {
    return firstName;
  }

  const fullName = normalizeNamePart(staffProfile.fullName);
  if (fullName) {
    const nameParts = fullName.split(/\s+/);
    const firstFullNamePart = nameParts[0];
    const lastFullNamePart = nameParts.at(-1);

    if (firstFullNamePart && lastFullNamePart && nameParts.length >= 2) {
      return `${firstFullNamePart} ${lastFullNamePart.charAt(0)}.`;
    }

    return fullName;
  }

  return lastName ?? null;
}

export function formatStaffDisplayNameOrFallback(
  staffProfile: StaffDisplayNameParts | null | undefined,
  fallback: string,
) {
  return formatStaffDisplayName(staffProfile) ?? fallback;
}
