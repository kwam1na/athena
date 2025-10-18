/**
 * Navigation Bar Constants and Types
 * Centralized definitions for navbar styling and layout configuration
 */

/**
 * Represents the current location in the application
 * Used to determine navbar styling and behavior
 */
export type AppLocation = "homepage" | "shop" | "checkout" | null;

/**
 * Navbar layout options
 */
export type NavBarLayout = "sticky" | "fixed";

/**
 * Primary color for navbar wrapper in sticky mode
 */
export const PRIMARY_BG_CLASS = "bg-primary/20";

/**
 * Fixed layout background color
 */
export const FIXED_BG_CLASS = "bg-white";

/**
 * Checkout flow background accent color
 */
export const CHECKOUT_BG_CLASS = "bg-accent5";

/**
 * Menu active state styling for sticky layout
 */
export const STICKY_MENU_ACTIVE_CLASS =
  "bg-white bg-opacity-20 backdrop-blur-md";

/**
 * Menu active state styling for fixed layout
 */
export const FIXED_MENU_ACTIVE_CLASS = "bg-white";

/**
 * Menu inactive state styling
 */
export const MENU_INACTIVE_CLASS = "bg-transparent";

/**
 * Hover text colors for sticky layout on homepage
 */
export const STICKY_HOMEPAGE_HOVER_CLASS = "hover:text-gray-300 text-white";

/**
 * Default hover text colors
 */
export const DEFAULT_HOVER_CLASS = "hover:text-gray-500";

/**
 * Site banner styling for sticky layout on homepage
 */
export const STICKY_HOMEPAGE_BANNER_TEXT_CLASS = "text-white";

/**
 * Default site banner background (used when not on homepage with sticky layout)
 */
export const DEFAULT_BANNER_BG_CLASS = "bg-accent5";

/**
 * Navbar wrapper class for sticky layout
 */
export const STICKY_NAVBAR_WRAPPER_CLASS = "w-full sticky z-50 top-0";

/**
 * Overlay styling for menu backdrop
 */
export const OVERLAY_CLASS =
  "w-full h-screen bg-white bg-opacity-20 backdrop-blur-md z-10";
