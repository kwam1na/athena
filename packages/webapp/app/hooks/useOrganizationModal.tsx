import { create } from "zustand";

interface useOrganizaationModalStore {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const useOrganizationModal = create<useOrganizaationModalStore>(
  (set) => ({
    isOpen: false,
    onOpen: () => set({ isOpen: true }),
    onClose: () => set({ isOpen: false }),
  })
);
