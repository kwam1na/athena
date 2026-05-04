import { useMemo } from "react";

import {
  buildRegisterCatalogIndex,
  type RegisterCatalogSearchRow,
} from "./catalogSearch";

export function useRegisterCatalogIndex(
  rows: readonly RegisterCatalogSearchRow[] | null | undefined,
) {
  return useMemo(() => buildRegisterCatalogIndex(rows ?? []), [rows]);
}
