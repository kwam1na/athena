// @vitest-environment node
/**
 * Advisory field scan: reads of result fields a capability does not declare
 * are named back to the model instead of silently yielding `undefined` (the
 * misread that gets narrated to an operator as "could not be read").
 */
import { describe, expect, it } from "vitest";

import { collectProgramFieldAdvisories } from "./programValidation";
import type { AgentProgramFacadeEntry } from "./types";

const FACADE: readonly AgentProgramFacadeEntry[] = [
  { package: "reports", resource: "daySales", verbs: ["get"], fields: ["grossRevenue", "paymentGroups", "topItems", "operatingDate"] },
  { package: "cash", resource: "registerSessions", verbs: ["list"], fields: ["sessionRef", "status"] },
];

describe("collectProgramFieldAdvisories", () => {
  it("flags a direct read of an undeclared field and names the declared ones", () => {
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       return { total: day.kind === "result" ? day.envelope.data.totalSales ?? null : null };`,
      FACADE,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({ namespace: "reports.daySales", field: "totalSales" });
    expect(advisories[0].message).toContain("grossRevenue");
    expect(advisories[0].message).toContain("paymentGroups");
  });

  it("does not flag declared fields, including through optional chains", () => {
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       return { revenue: day?.envelope?.data?.grossRevenue ?? null, items: day.envelope.data.topItems };`,
      FACADE,
    );
    expect(advisories).toEqual([]);
  });

  it("follows an alias of envelope.data and a destructure of it", () => {
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       const data = day.envelope.data;
       const { payments, topItems } = day.envelope.data;
       return { p: data.payments, payments, topItems };`,
      FACADE,
    );
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({ namespace: "reports.daySales", field: "payments" });
  });

  it("flags an undeclared field through an optional-chained read", () => {
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       return { total: day?.envelope?.data?.totalRevenue };`,
      FACADE,
    );
    expect(advisories).toMatchObject([{ field: "totalRevenue" }]);
  });

  it("dedupes repeated reads of the same undeclared field", () => {
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       return { a: day.envelope.data.payments, b: day.envelope.data.payments };`,
      FACADE,
    );
    expect(advisories).toHaveLength(1);
  });

  it("leaves list reads alone: element shapes flow through callbacks it does not follow", () => {
    const advisories = collectProgramFieldAdvisories(
      `const sessions = await athena.cash.registerSessions.list({ operatingDate: "2026-08-23" });
       const open = sessions.kind === "result" ? sessions.envelope.data.filter((s) => s.status === "open") : [];
       return { open: open.length };`,
      FACADE,
    );
    expect(advisories).toEqual([]);
  });

  it("returns nothing for a program that does not parse (validation owns syntax)", () => {
    expect(collectProgramFieldAdvisories("const day = await athena.reports.daySales.get({", FACADE)).toEqual([]);
  });

  it("returns nothing when the facade carries no field names", () => {
    const bare = FACADE.map(({ fields: _fields, ...entry }) => entry);
    const advisories = collectProgramFieldAdvisories(
      `const day = await athena.reports.daySales.get({ operatingDate: "2026-08-23" });
       return { total: day.envelope.data.totalSales };`,
      bare,
    );
    expect(advisories).toEqual([]);
  });
});
