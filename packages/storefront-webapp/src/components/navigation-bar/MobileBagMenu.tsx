import { BagMenu } from "./BagMenu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

export function MobileBagMenu({
  onCloseClick,
  setActiveMenu,
}: {
  onCloseClick: () => void;
  setActiveMenu: (menu: string | null) => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onCloseClick()}>
      <SheetContent
        side="right"
        className="w-full max-w-none overflow-y-auto px-gutter pb-safe-bottom sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Your bag and account</SheetTitle>
          <SheetDescription>
            Review bag, saved items, orders, rewards, and account destinations.
          </SheetDescription>
        </SheetHeader>
        <div className="pt-layout-xl">
          <BagMenu
            isMobile
            setActiveMenu={setActiveMenu}
            onCloseClick={onCloseClick}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
