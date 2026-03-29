import { describe, expect, it } from "vitest";

import { webOrderSchema } from "./webOrderSchema";

const validCustomerDetails = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  phoneNumber: "5555551234",
};

const getIssueMap = (issues: { path: (string | number)[]; message: string }[]) =>
  new Map(issues.map((issue) => [issue.path.join("."), issue.message]));

describe("webOrderSchema", () => {
  describe("pickup orders", () => {
    it("accepts a valid pickup order with a pickup location", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomerDetails,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: "wigclub-hair-studio",
        deliveryDetails: null,
        discount: null,
      });

      expect(result.success).toBe(true);
    });

    it("rejects a pickup order without a pickup location", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomerDetails,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: null,
        deliveryDetails: null,
        discount: null,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("pickupLocation")).toBe("Pickup location is required");
      }
    });

    it("rejects a pickup order with whitespace-only pickup location", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomerDetails,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: "   ",
        deliveryDetails: null,
        discount: null,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("pickupLocation")).toBe(
          "Pickup location cannot be empty or whitespace"
        );
      }
    });

    it("does not require delivery details for pickup orders", () => {
      const result = webOrderSchema.safeParse({
        customerDetails: validCustomerDetails,
        deliveryMethod: "pickup",
        deliveryOption: null,
        deliveryFee: null,
        pickupLocation: "wigclub-hair-studio",
        deliveryDetails: null,
        discount: null,
      });

      expect(result.success).toBe(true);
    });
  });

  it("rejects an unknown delivery method", () => {
    const result = webOrderSchema.safeParse({
      customerDetails: validCustomerDetails,
      deliveryMethod: "shipping",
      deliveryOption: null,
      deliveryFee: null,
      pickupLocation: null,
      deliveryDetails: null,
      discount: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects orders with invalid customer details", () => {
    const result = webOrderSchema.safeParse({
      customerDetails: {
        firstName: "",
        lastName: "",
        email: "not-an-email",
        phoneNumber: "123",
      },
      deliveryMethod: "pickup",
      deliveryOption: null,
      deliveryFee: null,
      pickupLocation: "wigclub-hair-studio",
      deliveryDetails: null,
      discount: null,
    });

    expect(result.success).toBe(false);
  });

  describe("Ghana delivery orders", () => {
    const ghanaDeliveryBase = {
      customerDetails: validCustomerDetails,
      deliveryMethod: "delivery" as const,
      deliveryOption: "within-accra",
      deliveryFee: 30,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid Ghana delivery order with all required fields", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Oxford Street",
          neighborhood: "osu",
        },
      });

      expect(result.success).toBe(true);
    });

    it("requires region for Ghana addresses", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: {
          country: "GH",
          street: "Oxford Street",
          neighborhood: "osu",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.region")).toBe("Region is required");
      }
    });

    it("requires street for Ghana addresses", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          neighborhood: "osu",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.street")).toBe("Street is required");
      }
    });

    it("requires neighborhood for Ghana addresses", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Oxford Street",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.neighborhood")).toBe(
          "Neighborhood is required"
        );
      }
    });

    it("does not require address or city for Ghana addresses", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Oxford Street",
          neighborhood: "osu",
        },
      });

      expect(result.success).toBe(true);
    });

    it("requires delivery fee for delivery orders", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryFee: null,
        deliveryDetails: {
          country: "GH",
          region: "GA",
          street: "Oxford Street",
          neighborhood: "osu",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryFee")).toBe("Delivery fee is required");
      }
    });

    it("requires delivery details object for delivery orders", () => {
      const result = webOrderSchema.safeParse({
        ...ghanaDeliveryBase,
        deliveryDetails: null,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails")).toBe(
          "Delivery details are required"
        );
      }
    });
  });

  describe("US delivery orders", () => {
    const usDeliveryBase = {
      customerDetails: validCustomerDetails,
      deliveryMethod: "delivery" as const,
      deliveryOption: "intl",
      deliveryFee: 800,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid US delivery order", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "Austin",
          state: "TX",
          zip: "78701",
        },
      });

      expect(result.success).toBe(true);
    });

    it("requires state for US addresses", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "Austin",
          zip: "78701",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.state")).toBe("State is required");
      }
    });

    it("requires zip for US addresses", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "Austin",
          state: "TX",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.zip")).toBe("Zip is required");
      }
    });

    it("rejects non-5-digit zip codes for US addresses", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "Austin",
          state: "TX",
          zip: "9410",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.zip")).toBe(
          "Zip code must be a 5-digit number"
        );
      }
    });

    it("rejects whitespace-only zip codes for US addresses", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          city: "Austin",
          state: "TX",
          zip: "   ",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (issue) =>
              issue.path.join(".") === "deliveryDetails.zip" &&
              issue.message === "Zip code cannot be empty or whitespace"
          )
        ).toBe(true);
      }
    });

    it("requires address for US orders", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          city: "Austin",
          state: "TX",
          zip: "78701",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.address")).toBe(
          "Address is required"
        );
      }
    });

    it("requires city for US orders", () => {
      const result = webOrderSchema.safeParse({
        ...usDeliveryBase,
        deliveryDetails: {
          country: "US",
          address: "123 Main St",
          state: "TX",
          zip: "78701",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.city")).toBe("City is required");
      }
    });
  });

  describe("international (non-US, non-GH) delivery orders", () => {
    const intlDeliveryBase = {
      customerDetails: validCustomerDetails,
      deliveryMethod: "delivery" as const,
      deliveryOption: "intl",
      deliveryFee: 800,
      pickupLocation: null,
      discount: null,
    };

    it("accepts a valid international delivery order", () => {
      const result = webOrderSchema.safeParse({
        ...intlDeliveryBase,
        deliveryDetails: {
          country: "GB",
          address: "10 Downing St",
          city: "London",
        },
      });

      expect(result.success).toBe(true);
    });

    it("requires address for international orders", () => {
      const result = webOrderSchema.safeParse({
        ...intlDeliveryBase,
        deliveryDetails: {
          country: "GB",
          city: "London",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.address")).toBe(
          "Address is required"
        );
      }
    });

    it("requires city for international orders", () => {
      const result = webOrderSchema.safeParse({
        ...intlDeliveryBase,
        deliveryDetails: {
          country: "GB",
          address: "10 Downing St",
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = getIssueMap(result.error.issues);
        expect(issues.get("deliveryDetails.city")).toBe("City is required");
      }
    });

    it("requires country for all delivery orders", () => {
      const result = webOrderSchema.safeParse({
        ...intlDeliveryBase,
        deliveryDetails: {
          address: "10 Downing St",
          city: "London",
        },
      });

      expect(result.success).toBe(false);
    });

    it("does not require state or zip for non-US international orders", () => {
      const result = webOrderSchema.safeParse({
        ...intlDeliveryBase,
        deliveryDetails: {
          country: "GB",
          address: "10 Downing St",
          city: "London",
        },
      });

      expect(result.success).toBe(true);
    });
  });
});
