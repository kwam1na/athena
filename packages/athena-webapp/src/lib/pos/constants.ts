/**
 * POS System Constants
 * Centralized configuration for timing and behavior in the POS system
 */

/**
 * Debounce delay for barcode/product search lookups (in milliseconds)
 *
 * This delay prevents the "no product found" UI from flickering while
 * the user is still typing. The search will only execute after the user
 * stops typing for this duration.
 *
 * @default 300ms - Balances responsiveness with preventing premature searches
 */
export const POS_SEARCH_DEBOUNCE_MS = 300;

/**
 * Delay before auto-adding a matched product to the cart (in milliseconds)
 *
 * This delay provides time for:
 * 1. The barcode search to complete (after the 450ms debounce)
 * 2. The user to verify the matched product before it's added
 * 3. Preventing accidental additions during rapid typing
 *
 * Total time from typing to auto-add: ~950ms (450ms debounce + 500ms auto-add)
 *
 * @default 500ms - Allows search completion while maintaining rapid scanning workflow
 */
export const POS_AUTO_ADD_DELAY_MS = 500;

/**
 * Additional buffer time for query execution when showing "no results" UI (in milliseconds)
 *
 * This extra time accounts for the Convex query execution after the debounce completes.
 * Without this buffer, the "no results" message would flicker briefly while the query
 * is still loading.
 *
 * Total delay for "no results": POS_SEARCH_DEBOUNCE_MS + POS_QUERY_BUFFER_MS = 750ms
 *
 * @default 300ms - Provides adequate time for typical query execution
 */
export const POS_QUERY_BUFFER_MS = 300;
