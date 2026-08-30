import { convexToJson, type Value } from "convex/values";

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { TableNames } from "../_generated/dataModel";
import schema from "../schema";

export type ReadCost = {
  calls: number;
  returnedDocuments: number;
  serializedBytes: number;
};

export type ReadCostSnapshot = {
  total: ReadCost;
  byTable: Record<string, ReadCost>;
};

const emptyCost = (): ReadCost => ({
  calls: 0,
  returnedDocuments: 0,
  serializedBytes: 0,
});

/** UTF-8 size of one Convex-JSON document, excluding query/result envelopes. */
export function serializedReadPayloadBytes(document: Value): number {
  return new TextEncoder().encode(JSON.stringify(convexToJson(document)))
    .byteLength;
}

/**
 * Test-only source hydration recorder, based on weeklyScale's DB wrapper.
 * Counts returned documents each time they are read, including repeated gets.
 * These are serialized fixture payloads, NOT Convex billing/index-scan bytes:
 * filtered-out rows, storage encoding, server overhead and internal pagination
 * probes are invisible here. Empty/failed terminal calls count as calls only.
 * Writes and scheduler calls delegate unchanged and are not measured.
 */
export function recordReadCosts<Ctx extends QueryCtx | MutationCtx>(ctx: Ctx) {
  const byTable: Record<string, ReadCost> = {};
  const start = (table: string) => {
    const cost = (byTable[table] ??= emptyCost());
    cost.calls += 1;
    return (documents: readonly Value[]) => {
      cost.returnedDocuments += documents.length;
      for (const document of documents) {
        cost.serializedBytes += serializedReadPayloadBytes(document);
      }
    };
  };

  const wrapQuery = (table: string, query: object): object =>
    new Proxy(query, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        if (property === Symbol.asyncIterator) {
          return () => {
            const record = start(table);
            const iterator = Reflect.apply(
              value,
              target,
              [],
            ) as AsyncIterator<Value>;
            return {
              async next() {
                const result = await iterator.next();
                if (!result.done) record([result.value]);
                return result;
              },
              async return() {
                return iterator.return
                  ? iterator.return()
                  : { done: true as const, value: undefined };
              },
              [Symbol.asyncIterator]() {
                return this;
              },
            };
          };
        }
        return (...args: unknown[]) => {
          if (
            property === "withIndex" ||
            property === "withSearchIndex" ||
            property === "order" ||
            property === "filter" ||
            property === "fullTableScan"
          ) {
            return wrapQuery(table, Reflect.apply(value, target, args));
          }
          if (
            property === "take" ||
            property === "collect" ||
            property === "first" ||
            property === "unique" ||
            property === "paginate"
          ) {
            const record = start(table);
            return Promise.resolve(Reflect.apply(value, target, args)).then(
              (result: Value | Value[] | { page: Value[] } | null) => {
                if (property === "paginate") {
                  record((result as { page: Value[] }).page);
                } else if (property === "take" || property === "collect") {
                  record(result as Value[]);
                } else if (result !== null) {
                  record([result as Value]);
                }
                return result;
              },
            );
          }
          return Reflect.apply(value, target, args);
        };
      },
    });

  const db = new Proxy(ctx.db, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      if (property === "query") {
        return (table: string) =>
          wrapQuery(table, Reflect.apply(value, target, [table]));
      }
      if (property === "get") {
        return (...args: string[]) => {
          // Legacy get(id) remains supported without a DB read or assumptions
          // about Convex IDs' encoding. New code should use get(table, id).
          const table =
            args.length === 2
              ? args[0]
              : (Object.keys(schema.tables) as TableNames[]).find(
                  (candidate) =>
                    target.normalizeId(candidate, args[0]) !== null,
                );
          if (!table)
            throw new Error("Cannot attribute read to a Convex table");
          const record = start(table);
          return Promise.resolve(Reflect.apply(value, target, args)).then(
            (document: Value | null) => {
              if (document !== null) record([document]);
              return document;
            },
          );
        };
      }
      return value.bind(target);
    },
  });

  return {
    ctx: { ...ctx, db } as Ctx,
    snapshot(): ReadCostSnapshot {
      const total = emptyCost();
      const tables: Record<string, ReadCost> = {};
      for (const [table, cost] of Object.entries(byTable)) {
        tables[table] = { ...cost };
        total.calls += cost.calls;
        total.returnedDocuments += cost.returnedDocuments;
        total.serializedBytes += cost.serializedBytes;
      }
      return { total, byTable: tables };
    },
  };
}
