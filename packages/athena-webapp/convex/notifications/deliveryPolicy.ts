/**
 * Implementation lives in `shared/notificationDeliveryPolicy` so the store
 * configuration UI can read the subscription cap without importing a Convex
 * module. Convex code keeps importing the policy from here.
 */
export * from "../../shared/notificationDeliveryPolicy";
