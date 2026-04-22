export function validateServiceIntakeInput(args: {
  assignedStaffProfileId?: string | null;
  customerFullName?: string | null;
  customerProfileId?: string | null;
  depositAmount?: number | null;
  depositMethod?: string | null;
  serviceTitle?: string | null;
}) {
  const errors: string[] = [];

  if (!args.assignedStaffProfileId) {
    errors.push("An assignee is required.");
  }

  if (!args.serviceTitle?.trim()) {
    errors.push("A service title is required.");
  }

  if (!args.customerProfileId && !args.customerFullName?.trim()) {
    errors.push("A customer name is required when no customer is linked.");
  }

  if (args.depositAmount !== undefined && args.depositAmount !== null) {
    if (args.depositAmount <= 0) {
      errors.push("Deposit amount must be greater than zero.");
    }

    if (!args.depositMethod) {
      errors.push("Select how the deposit was collected.");
    }
  }

  return errors;
}
