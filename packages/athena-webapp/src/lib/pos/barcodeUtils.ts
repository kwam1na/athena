/**
 * Barcode Utility Functions
 * Helper functions for handling barcode extraction, validation, and URL parsing
 */

/**
 * Extracts a barcode from input that could be either a URL or a plain barcode
 *
 * If the input is a URL with a 'barcode' query parameter, extracts and returns
 * just the barcode value. Otherwise, returns the input as-is.
 *
 * @param input - The input string (URL or barcode)
 * @returns The extracted barcode or the original input
 *
 * @example
 * // URL with barcode parameter
 * extractBarcodeFromInput("https://example.com/product?barcode=123456")
 * // Returns: "123456"
 *
 * @example
 * // Plain barcode
 * extractBarcodeFromInput("123456")
 * // Returns: "123456"
 */
export function extractBarcodeFromInput(input: string): string {
  // Check if input is a URL
  try {
    const url = new URL(input);
    const barcodeParam = url.searchParams.get("barcode");
    if (barcodeParam) {
      return barcodeParam;
    }
  } catch {
    // Not a valid URL, treat as regular barcode
  }
  return input;
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
