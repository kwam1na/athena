import { createContext, useContext, useState } from "react";
import { Id } from "~/convex/_generated/dataModel";
import { Analytic } from "~/types";

interface LogItemsContextType {
  loadMore: () => void;
  selectedLog: Analytic | null;
  setSelectedLog: (log: Analytic) => void;
}

const LogItemsContext = createContext<LogItemsContextType | undefined>(
  undefined
);

export function LogItemsProvider({
  children,
  loadMore,
  selectedLog,
  setSelectedLog,
}: {
  children: React.ReactNode;
  loadMore: () => void;
  selectedLog: Analytic | null;
  setSelectedLog: (log: Analytic) => void;
}) {
  return (
    <LogItemsContext.Provider
      value={{
        loadMore,
        selectedLog,
        setSelectedLog,
      }}
    >
      {children}
    </LogItemsContext.Provider>
  );
}

export function useLogItems() {
  const context = useContext(LogItemsContext);
  if (!context) {
    throw new Error("useLogItems must be used within a LogItemsProvider");
  }

  return context;
}
