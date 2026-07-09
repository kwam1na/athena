type PosVisibilityFields = {
  isVisible?: boolean | null;
  posVisible?: boolean | null;
};

type PosSearchProjectionVisibilityFields = {
  isVisible?: boolean | null;
  posVisible?: boolean | null;
  productIsVisible?: boolean | null;
  productPosVisible?: boolean | null;
};

export function isPosCatalogVisible(value: PosVisibilityFields) {
  return (value.posVisible ?? value.isVisible) !== false;
}

export function isProjectionProductPosCatalogVisible(
  value: PosSearchProjectionVisibilityFields,
) {
  return (value.productPosVisible ?? value.productIsVisible) !== false;
}

export function isProjectionSkuPosCatalogVisible(
  value: PosSearchProjectionVisibilityFields,
) {
  return (value.posVisible ?? value.isVisible) !== false;
}
