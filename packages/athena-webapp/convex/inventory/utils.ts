/**
 * Implementation lives in `shared/orderMath` so order presentation in the web
 * app can compute the same discount and order totals without importing a
 * Convex module. Convex code keeps importing the math from here.
 */
export * from "../../shared/orderMath";
