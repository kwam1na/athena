import { postAnalytics } from "@/api/analytics";
import { useCallback, useRef, useEffect } from "react";

interface TrackingEvent {
  action: string;
  data: Record<string, any>;
  timestamp: number;
  id: string;
}

interface TrackingConfig {
  batchSize: number;
  batchTimeout: number;
  maxQueueSize: number;
  retryAttempts: number;
  rateLimitWindow: number;
  maxEventsPerWindow: number;
}

const DEFAULT_CONFIG: TrackingConfig = {
  batchSize: 10,
  batchTimeout: 5000, // 5 seconds
  maxQueueSize: 100,
  retryAttempts: 3,
  rateLimitWindow: 60000, // 1 minute
  maxEventsPerWindow: 50,
};

export const useEnhancedTracking = (config: Partial<TrackingConfig> = {}) => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  const queueRef = useRef<TrackingEvent[]>([]);
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rateLimitRef = useRef<{ count: number; windowStart: number }>({
    count: 0,
    windowStart: Date.now(),
  });
  const offlineQueueRef = useRef<TrackingEvent[]>([]);
  const isOnlineRef = useRef(navigator.onLine);

  // Generate unique event ID
  const generateEventId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Check rate limit
  const isRateLimited = useCallback(() => {
    const now = Date.now();
    const { count, windowStart } = rateLimitRef.current;

    // Reset window if expired
    if (now - windowStart > finalConfig.rateLimitWindow) {
      rateLimitRef.current = { count: 0, windowStart: now };
      return false;
    }

    return count >= finalConfig.maxEventsPerWindow;
  }, [finalConfig]);

  // Send batch of events
  const sendBatch = useCallback(
    async (events: TrackingEvent[], retryCount = 0) => {
      if (events.length === 0) return;

      try {
        // Send all events in parallel (they're already batched)
        await Promise.all(
          events.map((event) =>
            postAnalytics({
              action: event.action,
              data: {
                ...event.data,
                timestamp: event.timestamp,
                url: window.location.href,
                userAgent: navigator.userAgent,
                eventId: event.id,
              },
            })
          )
        );

        console.debug(`Successfully sent batch of ${events.length} events`);
      } catch (error) {
        console.warn(`Batch send failed (attempt ${retryCount + 1}):`, error);

        // Retry logic
        if (retryCount < finalConfig.retryAttempts) {
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          setTimeout(() => {
            sendBatch(events, retryCount + 1);
          }, delay);
        } else {
          // Move to offline queue if all retries failed
          offlineQueueRef.current.push(...events);
          console.warn(
            `Failed to send batch after ${finalConfig.retryAttempts} attempts, queued for retry`
          );
        }
      }
    },
    [finalConfig.retryAttempts]
  );

  // Flush current queue
  const flushQueue = useCallback(() => {
    if (queueRef.current.length === 0) return;

    const eventsToSend = [...queueRef.current];
    queueRef.current = [];

    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = null;
    }

    if (isOnlineRef.current) {
      sendBatch(eventsToSend);
    } else {
      offlineQueueRef.current.push(...eventsToSend);
    }
  }, [sendBatch]);

  // Schedule batch send
  const scheduleBatchSend = useCallback(() => {
    if (batchTimeoutRef.current) return;

    batchTimeoutRef.current = setTimeout(() => {
      flushQueue();
    }, finalConfig.batchTimeout);
  }, [flushQueue, finalConfig.batchTimeout]);

  // Process offline queue when back online
  const processOfflineQueue = useCallback(() => {
    if (offlineQueueRef.current.length === 0) return;

    const eventsToSend = [...offlineQueueRef.current];
    offlineQueueRef.current = [];

    // Send in smaller batches to avoid overwhelming the server
    const batchSize = Math.min(finalConfig.batchSize, 5);
    for (let i = 0; i < eventsToSend.length; i += batchSize) {
      const batch = eventsToSend.slice(i, i + batchSize);
      setTimeout(() => sendBatch(batch), i * 100); // Stagger sends
    }
  }, [sendBatch, finalConfig.batchSize]);

  // Handle online/offline status
  useEffect(() => {
    const handleOnline = () => {
      isOnlineRef.current = true;
      processOfflineQueue();
    };

    const handleOffline = () => {
      isOnlineRef.current = false;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [processOfflineQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
      // Flush any remaining events
      flushQueue();
    };
  }, [flushQueue]);

  // Core tracking function
  const trackEvent = useCallback(
    (action: string, data: Record<string, any> = {}) => {
      // Rate limiting check
      if (isRateLimited()) {
        console.warn(
          `Rate limit exceeded for tracking. Dropping event: ${action}`
        );
        return;
      }

      // Update rate limit counter
      rateLimitRef.current.count++;

      // Create event
      const event: TrackingEvent = {
        action,
        data,
        timestamp: Date.now(),
        id: generateEventId(),
      };

      // Add to queue
      queueRef.current.push(event);

      // Check if queue is full or should be flushed immediately
      if (queueRef.current.length >= finalConfig.batchSize) {
        flushQueue();
      } else {
        scheduleBatchSend();
      }

      // Prevent queue from growing too large
      if (queueRef.current.length > finalConfig.maxQueueSize) {
        console.warn("Tracking queue overflow, dropping oldest events");
        queueRef.current = queueRef.current.slice(-finalConfig.maxQueueSize);
      }
    },
    [isRateLimited, generateEventId, flushQueue, scheduleBatchSend, finalConfig]
  );

  // Immediate tracking for critical events (bypasses batching)
  const trackEventImmediate = useCallback(
    async (action: string, data: Record<string, any> = {}) => {
      if (isRateLimited()) {
        console.warn(
          `Rate limit exceeded for immediate tracking. Dropping event: ${action}`
        );
        return;
      }

      rateLimitRef.current.count++;

      const event: TrackingEvent = {
        action,
        data,
        timestamp: Date.now(),
        id: generateEventId(),
      };

      if (isOnlineRef.current) {
        await sendBatch([event]);
      } else {
        offlineQueueRef.current.push(event);
      }
    },
    [isRateLimited, generateEventId, sendBatch]
  );

  // Specific tracking functions for common e-commerce actions
  const trackProductView = useCallback(
    (productId: string, productData?: any) => {
      trackEvent("viewed_product", {
        product: productId,
        ...productData,
      });
    },
    [trackEvent]
  );

  const trackAddToCart = useCallback(
    (productId: string, quantity: number = 1, productData?: any) => {
      trackEvent("added_product_to_bag", {
        product: productId,
        quantity,
        ...productData,
      });
    },
    [trackEvent]
  );

  const trackRemoveFromCart = useCallback(
    (productId: string, quantity: number = 1) => {
      trackEvent("removed_product_from_bag", {
        product: productId,
        quantity,
      });
    },
    [trackEvent]
  );

  const trackCheckoutStarted = useCallback(
    (cartValue: number, itemCount: number) => {
      // Use immediate tracking for critical conversion events
      trackEventImmediate("initiated_checkout", {
        cart_value: cartValue,
        item_count: itemCount,
      });
    },
    [trackEventImmediate]
  );

  const trackCheckoutCompleted = useCallback(
    (orderId: string, orderValue: number) => {
      // Critical event - send immediately
      trackEventImmediate("finalized_checkout", {
        order_id: orderId,
        order_value: orderValue,
      });
    },
    [trackEventImmediate]
  );

  const trackSearch = useCallback(
    (query: string, resultCount?: number) => {
      trackEvent("performed_search", {
        query,
        result_count: resultCount,
      });
    },
    [trackEvent]
  );

  const trackPageView = useCallback(
    (pageName: string, additionalData?: Record<string, any>) => {
      trackEvent("viewed_page", {
        page_name: pageName,
        ...additionalData,
      });
    },
    [trackEvent]
  );

  const trackEmailSignup = useCallback(
    (source: string) => {
      trackEvent("signed_up_email", {
        source,
      });
    },
    [trackEvent]
  );

  const trackPromoCodeUsed = useCallback(
    (promoCode: string, discount: number) => {
      trackEvent("used_promo_code", {
        promo_code: promoCode,
        discount_amount: discount,
      });
    },
    [trackEvent]
  );

  const trackSavedBagAdd = useCallback(
    (productId: string, productData?: any) => {
      trackEvent("added_product_to_saved", {
        product: productId,
        ...productData,
      });
    },
    [trackEvent]
  );

  const trackSavedBagRemove = useCallback(
    (productId: string) => {
      trackEvent("removed_product_from_saved", {
        product: productId,
      });
    },
    [trackEvent]
  );

  const trackPromoAlertDismissed = useCallback(
    (promoData?: Record<string, any>) => {
      trackEvent("dismissed_promo_alert", {
        ...promoData,
      });
    },
    [trackEvent]
  );

  const trackRewardsAlertDismissed = useCallback(() => {
    trackEvent("dismissed_rewards_alert", {});
  }, [trackEvent]);

  const trackShopNowClicked = useCallback(
    (origin: string, additionalData?: Record<string, any>) => {
      trackEvent("clicked_shop_now", {
        origin,
        ...additionalData,
      });
    },
    [trackEvent]
  );

  // Utility functions
  const getQueueStats = useCallback(() => {
    return {
      queueSize: queueRef.current.length,
      offlineQueueSize: offlineQueueRef.current.length,
      isOnline: isOnlineRef.current,
      rateLimitCount: rateLimitRef.current.count,
      rateLimitWindowStart: rateLimitRef.current.windowStart,
    };
  }, []);

  const forceFlush = useCallback(() => {
    flushQueue();
  }, [flushQueue]);

  return {
    trackEvent,
    trackEventImmediate,
    trackProductView,
    trackAddToCart,
    trackRemoveFromCart,
    trackCheckoutStarted,
    trackCheckoutCompleted,
    trackSearch,
    trackPageView,
    trackEmailSignup,
    trackPromoCodeUsed,
    trackSavedBagAdd,
    trackSavedBagRemove,
    trackPromoAlertDismissed,
    trackRewardsAlertDismissed,
    trackShopNowClicked,
    // Utility functions
    getQueueStats,
    forceFlush,
  };
};
