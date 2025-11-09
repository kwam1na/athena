import { Product } from "@/components/pos/types";

interface UseProductSearchResultsParams {
  searchResults: Product[] | undefined;
  barcodeSearchResult: Product | Product[] | null | undefined;
  productIdSearchResults: Product[] | null | undefined;
  inputIsUrlOrBarcode: boolean;
  debouncedQuery: string;
}

interface UseProductSearchResultsReturn {
  filteredProducts: Product[];
  isLoading: boolean;
  hasResults: boolean;
  showNoResultsMessage: boolean;
}

/**
 * Hook to consolidate product search result logic with proper prioritization
 *
 * Priority order:
 * 1. Product ID results (exact product lookup by ID)
 * 2. Barcode array results (product ID that returns multiple SKUs)
 * 3. Regular search results (text search)
 */
export function useProductSearchResults({
  searchResults,
  barcodeSearchResult,
  productIdSearchResults,
  inputIsUrlOrBarcode,
  debouncedQuery,
}: UseProductSearchResultsParams): UseProductSearchResultsReturn {
  // Extract barcode results if it's an array
  const barcodeResults = Array.isArray(barcodeSearchResult)
    ? barcodeSearchResult
    : [];

  // Determine which results to show with proper priority
  const filteredProducts = (() => {
    // Priority 1: Product ID results (exact product lookup)
    if (productIdSearchResults && productIdSearchResults.length > 0) {
      return productIdSearchResults;
    }

    // Priority 2: Barcode array results (product ID -> multiple SKUs)
    if (barcodeResults.length > 0) {
      return barcodeResults;
    }

    // Priority 3: Regular search results
    return searchResults || [];
  })();

  // Check if currently loading search results
  const isLoading =
    !inputIsUrlOrBarcode &&
    searchResults === undefined &&
    !productIdSearchResults;

  // Check if we have any results
  const hasResults = filteredProducts.length > 0;

  // Determine if we should show "no results" message for barcode/URL input
  // Only show when:
  // 1. Input is a barcode/URL
  // 2. Query has been debounced (search completed)
  // 3. No barcode result found (null or empty array)
  // 4. No product ID results found
  const hasNoBarcode =
    !barcodeSearchResult ||
    (Array.isArray(barcodeSearchResult) && barcodeSearchResult.length === 0);

  const hasNoProductIdResults =
    !productIdSearchResults || productIdSearchResults.length === 0;

  const showNoResultsMessage =
    inputIsUrlOrBarcode &&
    debouncedQuery.trim().length > 0 &&
    hasNoBarcode &&
    hasNoProductIdResults;

  return {
    filteredProducts,
    isLoading,
    hasResults,
    showNoResultsMessage,
  };
}
