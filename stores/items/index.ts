import { Item } from "@/lib/types";
import { create } from "zustand";
import axiosInstance from "@/lib/axios";

type ItemStore = {
  items: Item[];
  setItems: (items: Item[]) => void;
  fetchItems: () => Promise<void>;
};

export const useItemStore = create<ItemStore>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
  fetchItems: async () => {
    const res = await axiosInstance.get("/items");
    const items = await res.data;
    set({ items });
  },
}));
