/**
 * Per-surface product-lexicon overlays (composition root).
 *
 * The app-wide lexicon lives in `shared/agentHarness/productLexicon.ts`; each
 * profile (surface) may overlay labels for the vocabulary its operators use.
 * The runtime host resolves the merged lexicon by profile id and hands it to
 * the tone sensor — an unknown profile gets the app lexicon unchanged.
 */
import {
  APP_PRODUCT_LEXICON,
  mergeLexicons,
  type AgentProductLexicon,
} from "../../../shared/agentHarness/productLexicon";
import { DAILY_OPERATIONS_PROFILE_ID } from "./dailyOperations";

/** Daily Operations speaks the operations floor's language (docs/product-copy-tone.md). */
export const DAILY_OPERATIONS_TONE_LEXICON: AgentProductLexicon = {
  enumLabels: {
    close_blocked: "close blocked",
    daily_close: "daily close",
    operations_queue: "operations queue",
    in_stock: "in stock",
  },
  fieldLabels: {
    registerSession: "drawer",
    registerSessions: "drawers",
    registerBlockerCount: "registers blocking the close",
    attentionCount: "items needing attention",
    openWorkItemCount: "open work items",
    lifecycleStage: "where the day stands",
    stockState: "stock level",
    skuCode: "SKU",
    displayName: "item",
    observedAt: "as of",
    operatingDate: "store day",
    grossRevenue: "revenue",
    transactionCount: "number of sales",
    unitsSold: "units sold",
  },
};

const OVERLAYS: { readonly [profileId: string]: AgentProductLexicon } = {
  [DAILY_OPERATIONS_PROFILE_ID]: DAILY_OPERATIONS_TONE_LEXICON,
};

export function profileLexicon(profileId: string): AgentProductLexicon {
  const overlay = OVERLAYS[profileId];
  return overlay ? mergeLexicons(APP_PRODUCT_LEXICON, overlay) : APP_PRODUCT_LEXICON;
}
