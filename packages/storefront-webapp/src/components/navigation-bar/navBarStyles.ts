import type { AppLocation, NavBarLayout } from "./navBarConstants";
export const getMainWrapperClass = (_layout: NavBarLayout) => "";
export const getNavBGClass = (
  menu: boolean,
  layout: NavBarLayout,
  location: AppLocation,
) =>
  location === "checkout"
    ? "bg-surface-subtle/95 backdrop-blur-md"
    : menu || layout === "fixed"
      ? "bg-surface/95 backdrop-blur-md"
      : "bg-transparent";
export const getHoverClass = (layout: NavBarLayout, location: AppLocation) =>
  layout === "sticky" && location === "homepage"
    ? "text-white hover:text-white/80"
    : "text-foreground hover:text-muted-foreground";
export const getSubmenuBGClass = (
  _layout: NavBarLayout,
  location: AppLocation,
) =>
  location === "checkout"
    ? "bg-surface-subtle/95 backdrop-blur-md"
    : "bg-surface/95 backdrop-blur-md";
export const getBannerTextClass = (layout: NavBarLayout, location: AppLocation) =>
  layout === "sticky" && location === "homepage"
    ? "text-white"
    : "text-foreground";
export const getBannerBGClass = (layout: NavBarLayout, location: AppLocation) =>
  layout === "sticky" && location === "homepage"
    ? "bg-transparent"
    : "bg-surface-subtle";
export const getBannerAnimationDelay = (_location: AppLocation) => 0;
export const getNavBarAnimationDelay = (_location: AppLocation) => 0;
export const getNavBarWrapperClass = (layout: NavBarLayout) =>
  layout === "sticky"
    ? "absolute inset-x-0 top-0 z-50 w-full"
    : "sticky top-0 z-50 w-full";
export const getOverlayClass = () =>
  "fixed inset-0 z-40 bg-overlay/20 backdrop-blur-sm";
