import React, { createContext, useContext, useState } from "react";
import { UserType } from "@/lib/schemas/user";
import { OG_ORGANIZTION_ID } from "@/lib/constants";

type UserContextType = {
  user: UserType;
  setActiveStore: (storeId: string) => void;
};

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<UserType>({
    organizationId: OG_ORGANIZTION_ID,
    userName: "The Boy",
    activeStoreId: "1",
  });

  const setActiveStore = (storeId: string) => {
    setUser((prev) => ({ ...prev, activeStoreId: storeId }));
  };

  return (
    <UserContext.Provider
      value={{
        user,
        setActiveStore,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUserContext = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUserContext must be used within a UserProvider");
  }
  return context;
};
