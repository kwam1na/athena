import { describe, expect, it } from "vitest";

import { billingDetailsSchema } from "./billingDetailsSchema";
import { checkoutFormSchema } from "./checkoutFormSchema";
import { customerDetailsSchema } from "./customerDetailsSchema";
import { deliveryDetailsSchema } from "./deliveryDetailsSchema";

const getIssueMap = (issues: { path: (string | number)[]; message: string }[]) =>
  new Map(issues.map((issue) => [issue.path.join("."), issue.message]));

describe("customerDetailsSchema", () => {
  it("accepts a valid customer record", () => {
    expect(
      customerDetailsSchema.safeParse({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phoneNumber: "5555551234",
      }).success
    ).toBe(true);
  });

  it("rejects invalid names and whitespace-only values", () => {
    const result = customerDetailsSchema.safeParse({
      firstName: "   ",
      lastName: "123",
      email: "ada@example.com",
      phoneNumber: "5555551234",
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const issues = getIssueMap(result.error.issues);

    expect(issues.get("firstName")).toBe("First name cannot be empty or whitespace");
    expect(issues.get("lastName")).toBe("Last name contains invalid characters");
  });
});

describe("billingDetailsSchema", () => {
  it("requires state and zip for US addresses", () => {
    const result = billingDetailsSchema.safeParse({
      address: "123 Main St",
      city: "Austin",
      country: "US",
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const issues = getIssueMap(result.error.issues);

    expect(issues.get("state")).toBe("State is required");
    expect(issues.get("zip")).toBe("Zip code is required");
  });

  it("accepts non-US addresses without state and zip", () => {
    expect(
      billingDetailsSchema.safeParse({
        address: "8 Oxford Street",
        city: "Accra",
        country: "GH",
      }).success
    ).toBe(true);
  });
});

describe("deliveryDetailsSchema", () => {
  it("requires a region for Ghana deliveries", () => {
    const result = deliveryDetailsSchema.safeParse({
      country: "GH",
      address: "East Legon",
      city: "Accra",
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const issues = getIssueMap(result.error.issues);

    expect(issues.get("region")).toBe("Region is required");
  });

  it("requires a five-digit zip for US deliveries", () => {
    const result = deliveryDetailsSchema.safeParse({
      address: "1 Market Street",
      city: "San Francisco",
      state: "CA",
      zip: "9410",
      country: "US",
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const issues = getIssueMap(result.error.issues);

    expect(issues.get("zip")).toBe("Zip code must be a 5-digit number");
  });
});

describe("checkoutFormSchema", () => {
  it("accepts a minimal pickup checkout payload", () => {
    expect(
      checkoutFormSchema.safeParse({
        deliveryMethod: "pickup",
        customerDetails: {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phoneNumber: "5555551234",
        },
        deliveryDetails: {
          country: "GH",
        },
        billingDetails: {
          country: "GH",
        },
      }).success
    ).toBe(true);
  });

  it("requires Ghana-specific delivery fields for delivery orders", () => {
    const result = checkoutFormSchema.safeParse({
      deliveryMethod: "delivery",
      customerDetails: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phoneNumber: "5555551234",
      },
      deliveryDetails: {
        country: "GH",
      },
      billingDetails: {
        address: "123 Main St",
        city: "Accra",
        country: "GH",
      },
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const issues = getIssueMap(result.error.issues);

    expect(issues.get("deliveryDetails.region")).toBe("Region is required");
    expect(issues.get("deliveryDetails.street")).toBe("Street is required");
    expect(issues.get("deliveryDetails.houseNumber")).toBe(
      "Apt/House number is required"
    );
    expect(issues.get("deliveryDetails.neighborhood")).toBe(
      "Neighborhood is required"
    );
  });
});
