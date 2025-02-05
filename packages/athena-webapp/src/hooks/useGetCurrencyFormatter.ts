import { currencyFormatter } from "../lib/utils";
import useGetActiveStore from "./useGetActiveStore";

export const useGetCurrencyFormatter = () => {
  const { activeStore } = useGetActiveStore();

  return currencyFormatter(activeStore?.currency || "GHS");
};
