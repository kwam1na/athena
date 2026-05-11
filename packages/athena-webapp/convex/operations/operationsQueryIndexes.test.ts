import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import schema from "../schema";

type IndexExpectation = {
  table: string;
  descriptor: string;
  fields: string[];
};

function getTableIndexes(tableName: string) {
  return ((schema as any).tables[tableName]?.indexes ?? []) as Array<{
    indexDescriptor: string;
    fields: string[];
  }>;
}

function expectIndex({ table, descriptor, fields }: IndexExpectation) {
  expect(getTableIndexes(table)).toContainEqual({
    indexDescriptor: descriptor,
    fields,
  });
}

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("operations query indexing", () => {
  it("defines additive schema indexes for the operations rails", () => {
    [
      {
        table: "customerProfile",
        descriptor: "by_storeId_email",
        fields: ["storeId", "email"],
      },
      {
        table: "customerProfile",
        descriptor: "by_storeId_phoneNumber",
        fields: ["storeId", "phoneNumber"],
      },
      {
        table: "customerProfile",
        descriptor: "by_storeFrontUserId",
        fields: ["storeFrontUserId"],
      },
      {
        table: "customerProfile",
        descriptor: "by_guestId",
        fields: ["guestId"],
      },
      {
        table: "customerProfile",
        descriptor: "by_posCustomerId",
        fields: ["posCustomerId"],
      },
      {
        table: "staffProfile",
        descriptor: "by_storeId_linkedUserId",
        fields: ["storeId", "linkedUserId"],
      },
      {
        table: "staffProfile",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "staffRoleAssignment",
        descriptor: "by_staffProfileId",
        fields: ["staffProfileId"],
      },
      {
        table: "staffRoleAssignment",
        descriptor: "by_storeId_role",
        fields: ["storeId", "role"],
      },
      {
        table: "staffCredential",
        descriptor: "by_staffProfileId_status",
        fields: ["staffProfileId", "status"],
      },
      {
        table: "staffCredential",
        descriptor: "by_storeId_username",
        fields: ["storeId", "username"],
      },
      {
        table: "operationalWorkItem",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "operationalEvent",
        descriptor: "by_storeId_subject",
        fields: ["storeId", "subjectType", "subjectId"],
      },
      {
        table: "operationalEvent",
        descriptor: "by_storeId_createdAt",
        fields: ["storeId", "createdAt"],
      },
      {
        table: "inventoryMovement",
        descriptor: "by_storeId_productSkuId",
        fields: ["storeId", "productSkuId"],
      },
      {
        table: "inventoryMovement",
        descriptor: "by_storeId_source",
        fields: ["storeId", "sourceType", "sourceId"],
      },
      {
        table: "cycleCountDraft",
        descriptor: "by_storeId_status_scope_owner",
        fields: ["storeId", "status", "scopeKey", "ownerUserId"],
      },
      {
        table: "cycleCountDraft",
        descriptor: "by_storeId_status_scope",
        fields: ["storeId", "status", "scopeKey"],
      },
      {
        table: "cycleCountDraftLine",
        descriptor: "by_draftId",
        fields: ["draftId"],
      },
      {
        table: "cycleCountDraftLine",
        descriptor: "by_draftId_productSkuId",
        fields: ["draftId", "productSkuId"],
      },
      {
        table: "paymentAllocation",
        descriptor: "by_storeId_target",
        fields: ["storeId", "targetType", "targetId"],
      },
      {
        table: "registerSession",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "registerSession",
        descriptor: "by_storeId_registerNumber",
        fields: ["storeId", "registerNumber"],
      },
      {
        table: "approvalRequest",
        descriptor: "by_storeId_subject",
        fields: ["storeId", "subjectType", "subjectId"],
      },
      {
        table: "dailyClose",
        descriptor: "by_storeId_operatingDate",
        fields: ["storeId", "operatingDate"],
      },
      {
        table: "dailyClose",
        descriptor: "by_storeId_operatingDate_lifecycleStatus",
        fields: ["storeId", "operatingDate", "lifecycleStatus"],
      },
      {
        table: "dailyClose",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "dailyClose",
        descriptor: "by_storeId_isCurrent",
        fields: ["storeId", "isCurrent"],
      },
      {
        table: "dailyClose",
        descriptor: "by_storeId_status_operatingDate",
        fields: ["storeId", "status", "operatingDate"],
      },
      {
        table: "dailyOpening",
        descriptor: "by_storeId_operatingDate",
        fields: ["storeId", "operatingDate"],
      },
      {
        table: "dailyOpening",
        descriptor: "by_storeId_status",
        fields: ["storeId", "status"],
      },
      {
        table: "dailyOpening",
        descriptor: "by_storeId_status_operatingDate",
        fields: ["storeId", "status", "operatingDate"],
      },
    ].forEach(expectIndex);
  });

  it("uses indexed lookups in the operations modules", () => {
    const customerProfilesSource = getSource("./customerProfiles.ts");
    const staffProfilesSource = getSource("./staffProfiles.ts");
    const inventoryMovementsSource = getSource("./inventoryMovements.ts");
    const paymentAllocationsSource = getSource("./paymentAllocations.ts");
    const operationalEventsSource = getSource("./operationalEvents.ts");
    const dailyOperationsSource = getSource("./dailyOperations.ts");
    const dailyCloseSource = getSource("./dailyClose.ts");
    const dailyOpeningSource = getSource("./dailyOpening.ts");

    expect(customerProfilesSource).toContain(
      '.withIndex("by_storeFrontUserId"',
    );
    expect(customerProfilesSource).toContain('.withIndex("by_guestId"');
    expect(customerProfilesSource).toContain('.withIndex("by_posCustomerId"');
    expect(customerProfilesSource).toContain('.withIndex("by_storeId_email"');
    expect(customerProfilesSource).toContain(
      '.withIndex("by_storeId_phoneNumber"',
    );

    expect(staffProfilesSource).toContain(
      '.withIndex("by_storeId_linkedUserId"',
    );
    expect(staffProfilesSource).toContain('.withIndex("by_staffProfileId"');
    expect(inventoryMovementsSource).toContain(
      '.withIndex("by_storeId_productSkuId"',
    );
    expect(paymentAllocationsSource).toContain(
      '.withIndex("by_storeId_target"',
    );
    expect(operationalEventsSource).toContain(
      '.withIndex("by_storeId_subject"',
    );
    expect(dailyOperationsSource).toContain(
      '.withIndex("by_storeId_createdAt"',
    );
    expect(dailyCloseSource).toContain('.withIndex("by_storeId_operatingDate"');
    expect(dailyCloseSource).toContain(
      '.withIndex("by_storeId_operatingDate_lifecycleStatus"',
    );
    expect(dailyCloseSource).toContain(
      '.withIndex("by_storeId_status_operatingDate"',
    );
    expect(dailyCloseSource).toContain('.withIndex("by_storeId_isCurrent"');
    expect(dailyOpeningSource).toContain(
      '.withIndex("by_storeId_operatingDate"',
    );
    expect(dailyOpeningSource).toContain(
      '.withIndex("by_storeId_status_operatingDate"',
    );

    const cycleCountDraftsSource = getSource("../stockOps/cycleCountDrafts.ts");

    expect(cycleCountDraftsSource).toContain(
      '.withIndex("by_storeId_status_scope_owner"',
    );
    expect(cycleCountDraftsSource).toContain(
      '.withIndex("by_draftId_productSkuId"',
    );
  });

  it("threads operations roles into membership and POS customer linking surfaces", () => {
    const organizationMemberSource = getSource(
      "../schemas/inventory/organizationMember.ts",
    );
    const posCustomersSource = getSource(
      "../pos/infrastructure/repositories/customerRepository.ts",
    );
    const typesSource = getSource("../schema.ts");

    expect(organizationMemberSource).toContain("operationalRoles");
    expect(posCustomersSource).toContain(
      "ensureCustomerProfileFromSourcesWithCtx",
    );
    expect(typesSource).toContain("customerProfileSchema");
    expect(typesSource).toContain("staffProfileSchema");
    expect(typesSource).toContain("staffCredentialSchema");
  });
});
