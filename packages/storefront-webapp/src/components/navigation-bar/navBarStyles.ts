/**
 * Navigation Bar Styling Utilities
 * Functions to determine appropriate CSS classes based on navbar state
 */

import {
  AppLocation,
  NavBarLayout,
  PRIMARY_BG_CLASS,
  FIXED_BG_CLASS,
  CHECKOUT_BG_CLASS,
  STICKY_MENU_ACTIVE_CLASS,
  FIXED_MENU_ACTIVE_CLASS,
  MENU_INACTIVE_CLASS,
  STICKY_HOMEPAGE_HOVER_CLASS,
  DEFAULT_HOVER_CLASS,
  STICKY_HOMEPAGE_BANNER_TEXT_CLASS,
  DEFAULT_BANNER_BG_CLASS,
  STICKY_NAVBAR_WRAPPER_CLASS,
  OVERLAY_CLASS,
} from "./navBarConstants";

/**
 * Determines the main wrapper background class
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @returns CSS class string for the main navbar wrapper
 */
export function getMainWrapperClass(navBarLayout: NavBarLayout): string {
  return navBarLayout === "sticky"
    ? `absolute ${PRIMARY_BG_CLASS}`
    : FIXED_BG_CLASS;
}

/**
 * Determines the navbar background class based on state and location
 * Handles special styling for checkout flow
 *
 * @param isMenuActive - Whether a dropdown menu is currently active
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @param appLocation - The current application location/context
 * @returns CSS class string for the navbar background
 */
export function getNavBGClass(
  isMenuActive: boolean,
  navBarLayout: NavBarLayout,
  appLocation: AppLocation
): string {
  // Menu active styling
  if (isMenuActive) {
    // Checkout flow uses accent5 background when menu is active
    if (appLocation === "checkout") {
      return CHECKOUT_BG_CLASS;
    }
    return navBarLayout === "sticky"
      ? STICKY_MENU_ACTIVE_CLASS
      : FIXED_MENU_ACTIVE_CLASS;
  }

  // Checkout flow uses accent5 background when no menu is active
  if (appLocation === "checkout") {
    return CHECKOUT_BG_CLASS;
  }

  // Default inactive state
  return MENU_INACTIVE_CLASS;
}

/**
 * Determines the hover text color class for navbar elements
 * Different styling for sticky layout on homepage vs other contexts
 *
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @param appLocation - The current application location/context
 * @returns CSS class string for hover text styling
 */
export function getHoverClass(
  navBarLayout: NavBarLayout,
  appLocation: AppLocation
): string {
  return navBarLayout === "sticky" && appLocation === "homepage"
    ? STICKY_HOMEPAGE_HOVER_CLASS
    : DEFAULT_HOVER_CLASS;
}

/**
 * Determines the submenu background class
 * Aligns submenu styling with the main navbar background
 *
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @param appLocation - The current application location/context
 * @returns CSS class string for the submenu background
 */
export function getSubmenuBGClass(
  navBarLayout: NavBarLayout,
  appLocation: AppLocation
): string {
  // Checkout flow uses accent5 for submenu background
  if (appLocation === "checkout") {
    return CHECKOUT_BG_CLASS;
  }

  // Fixed layout uses white background
  if (navBarLayout === "fixed") {
    return "bg-opacity-95 bg-white";
  }

  // Sticky layout uses semi-transparent background
  return "bg-opacity-95";
}

/**
 * Determines the site banner text color class
 * Homepage with sticky layout shows white text, otherwise default
 *
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @param appLocation - The current application location/context
 * @returns CSS class string for the banner text color
 */
export function getBannerTextClass(
  navBarLayout: NavBarLayout,
  appLocation: AppLocation
): string {
  return navBarLayout === "sticky" && appLocation === "homepage"
    ? STICKY_HOMEPAGE_BANNER_TEXT_CLASS
    : "";
}

/**
 * Determines the site banner background class
 * Homepage with sticky layout is transparent, otherwise uses accent5
 *
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @param appLocation - The current application location/context
 * @returns CSS class string for the banner background
 */
export function getBannerBGClass(
  navBarLayout: NavBarLayout,
  appLocation: AppLocation
): string {
  return navBarLayout === "sticky" && appLocation === "homepage"
    ? ""
    : DEFAULT_BANNER_BG_CLASS;
}

/**
 * Determines the animation delay for site banner
 * Homepage delays the animation, other locations show immediately
 *
 * @param appLocation - The current application location/context
 * @returns Animation delay in seconds
 */
export function getBannerAnimationDelay(appLocation: AppLocation): number {
  return appLocation === "homepage" ? 1.85 : 0;
}

/**
 * Determines the navbar wrapper positioning class
 * Sticky layout requires positioning utilities
 *
 * @param navBarLayout - The navbar layout mode (sticky or fixed)
 * @returns CSS class string for navbar wrapper positioning
 */
export function getNavBarWrapperClass(navBarLayout: NavBarLayout): string {
  return navBarLayout === "sticky" ? STICKY_NAVBAR_WRAPPER_CLASS : "";
}

/**
 * Determines animation delay for navbar appearance
 * Homepage delays the animation longer than other locations
 *
 * @param appLocation - The current application location/context
 * @returns Animation delay in seconds
 */
export function getNavBarAnimationDelay(appLocation: AppLocation): number {
  return appLocation === "homepage" ? 2.2 : 0;
}

/**
 * Determines the overlay class for menu backdrop
 * Shows a full-screen translucent overlay when menu is active
 *
 * @returns CSS class string for the overlay
 */
export function getOverlayClass(): string {
  return OVERLAY_CLASS;
}
