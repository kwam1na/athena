import { create } from 'zustand';

interface UserState {
   name?: string;
   email?: string;
   storeId?: string;
   userId?: string;
   authToken?: string;
   setUser: (
      name: string,
      email: string,
      userId: string,
      storeId: string,
      authToken?: string,
   ) => void;
   resetUser: () => void;
}

export const useUserStore = create<UserState>((set) => ({
   name: undefined,
   email: undefined,
   storeId: undefined,
   userId: undefined,
   authToken: undefined,
   setUser: (
      name: string,
      email: string,
      userId: string,
      storeId: string,
      authToken?: string,
   ) => set({ name, email, userId, storeId, authToken }),
   resetUser: () =>
      set({
         name: undefined,
         email: undefined,
         userId: undefined,
         storeId: undefined,
         authToken: undefined,
      }),
}));
