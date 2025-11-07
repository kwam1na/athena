/**
 * Barcode Utility Functions
 * Helper functions for handling barcode extraction, validation, and URL parsing
 */

/**
 * Result of extracting a value from input (barcode or product ID)
 * Uses discriminated union to prevent race conditions with boolean flags
 */
export type ExtractResult =
  | { type: "barcode"; value: string }
  | { type: "productId"; value: string };

const CONVEX_ID_PATTERN = /^[a-z0-9]{32}$/;

export function isValidConvexId(value: string): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  return CONVEX_ID_PATTERN.test(trimmed);
}

/**
 * Extracts a barcode or product ID from input that could be either a URL or a plain barcode
 *
 * Priority order:
 * 1. If URL has 'barcode' query param, extract that (takes precedence)
 * 2. If URL matches product path pattern (/shop/product/{id} or /product/{id}), extract product ID
 * 3. Otherwise, return input as-is (plain barcode)
 *
 * @param input - The input string (URL or barcode)
 * @returns Discriminated union with type and value
 *
 * @example
 * // URL with barcode parameter (takes precedence)
 * extractBarcodeFromInput("https://example.com/product?barcode=123456")
 * // Returns: { type: "barcode", value: "123456" }
 *
 * @example
 * // URL with product ID in path
 * extractBarcodeFromInput("http://localhost:5174/shop/product/ks74we8e7q912ypcgfzef27ct17az438")
 * // Returns: { type: "productId", value: "ks74we8e7q912ypcgfzef27ct17az438" }
 *
 * @example
 * // Plain barcode
 * extractBarcodeFromInput("123456")
 * // Returns: { type: "barcode", value: "123456" }
 */
export function extractBarcodeFromInput(input: string): ExtractResult {
  // Check if input is a URL
  try {
    const url = new URL(input);

    // Check for barcode query param first (takes precedence)
    const barcodeParam = url.searchParams.get("barcode");
    if (barcodeParam) {
      return { type: "barcode", value: barcodeParam };
    }

    // Check for product ID in path: /shop/product/{id} or /product/{id}
    const pathname = url.pathname;
    const productPathMatch = pathname.match(/\/(?:shop\/)?product\/([^/?]+)/);
    if (productPathMatch && productPathMatch[1]) {
      return { type: "productId", value: productPathMatch[1] };
    }
  } catch {
    // Not a valid URL, treat as regular barcode
  }

  return { type: "barcode", value: input };
}

/**
 * Determines if an input string is a URL or a barcode (as opposed to a product search term)
 *
 * A string is considered a URL/barcode if it:
 * - Is a valid URL, OR
 * - Contains only digits, spaces, and hyphens (barcode pattern)
 *
 * @param input - The input string to check
 * @returns true if the input is a URL or barcode, false otherwise
 *
 * @example
 * isUrlOrBarcode("https://example.com") // true
 * isUrlOrBarcode("123456") // true
 * isUrlOrBarcode("123-456-789") // true
 * isUrlOrBarcode("product name") // false
 * isUrlOrBarcode("") // false
 */
export function isUrlOrBarcode(input: string): boolean {
  if (!input.trim()) return false;

  // Check if it's a URL
  try {
    new URL(input);
    return true;
  } catch {
    // Not a URL, continue checking
  }

  // Check if it's a barcode (only digits, possibly with dashes/spaces)
  return /^[\d\s-]+$/.test(input.trim());
}
