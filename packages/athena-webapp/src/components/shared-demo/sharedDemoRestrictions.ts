import {
  classifyAthenaViewSurface,
  isSharedDemoSurfaceVisible,
} from "./sharedDemoSurfaceCatalog";

export const classifySharedDemoSurface = classifyAthenaViewSurface;

export function isSharedDemoRestrictedPath(pathname: string) {
  return !isSharedDemoSurfaceVisible(pathname);
}
