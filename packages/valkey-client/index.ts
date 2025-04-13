/**
 * Client interface for the Valkey Redis proxy server
 */
export class ValkeyClient {
  private baseUrl: string;

  /**
   * Creates a new Valkey client
   * @param baseUrl The URL of the Valkey proxy server
   */
  constructor(baseUrl = "http://34.244.249.177:3000") {
    this.baseUrl = baseUrl;
  }

  /**
   * Retrieves a value from Redis by key
   * @param key The key to retrieve
   * @returns The value associated with the key or null if not found
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const response = await fetch(`${this.baseUrl}/get`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get key: ${response.statusText}`);
      }

      const data = await response.json();
      return data.value as T;
    } catch (error) {
      console.error("Error retrieving value from Valkey:", error);
      throw error;
    }
  }

  /**
   * Sets a value in Redis by key
   * @param key The key to set
   * @param value The value to store
   * @returns A boolean indicating success
   */
  async set(key: string, value: any): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/set`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, value: JSON.stringify(value) }),
      });

      if (!response.ok) {
        throw new Error(`Failed to set key: ${response.statusText}`);
      }

      const data = await response.json();
      return data.ok === true;
    } catch (error) {
      console.error("Error setting value in Valkey:", error);
      throw error;
    }
  }

  /**
   * Invalidates (deletes) keys matching a pattern
   * @param pattern The pattern to match keys against (e.g., "user:*")
   * @returns The number of keys cleared
   */
  async invalidate(pattern: string): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/invalidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pattern }),
      });

      if (!response.ok) {
        throw new Error(`Failed to invalidate keys: ${response.statusText}`);
      }

      const data = await response.json();
      return data.keysCleared;
    } catch (error) {
      console.error("Error invalidating keys in Valkey:", error);
      throw error;
    }
  }
}

// Example usage:
// const cache = new ValkeyClient();
// await cache.set('user:123', { name: 'John', email: 'john@example.com' });
// const user = await cache.get('user:123');
// await cache.invalidate('user:*');
