import { createContext, useContext, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";

type SheetContextType = {
  toggleSheet: (open: boolean) => void;
  setSheetContent: (content: React.ReactNode) => void;
};

const SheetContext = createContext<SheetContextType | null>(null);

export const useSheet = () => {
  const context = useContext(SheetContext);
  if (!context) {
    throw new Error("useSheet must be used within a SheetProvider");
  }
  return context;
};

export const SheetProvider = ({ children }: { children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState<React.ReactNode>(null);

  return (
    <SheetContext.Provider
      value={{ toggleSheet: setIsOpen, setSheetContent: setContent }}
    >
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTitle />
        <SheetContent side={"bottom"}>{content}</SheetContent>
      </Sheet>
      {children}
    </SheetContext.Provider>
  );
};
