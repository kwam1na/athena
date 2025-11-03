import { useState, useEffect } from "react";

/**
 * Custom hook that debounces a value by delaying its update
 * @param value - The value to debounce
 * @param delay - The delay in milliseconds
 * @returns The debounced value
 *
 * @example
 * const debouncedSearchTerm = useDebounce(searchTerm, 300);
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up a timeout to update the debounced value after the delay
    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup: cancel the timeout if value changes before delay completes
    return () => clearTimeout(timeoutId);
  }, [value, delay]);

  return debouncedValue;
}
