import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { XIcon } from "lucide-react";
import { BagMenu } from "./BagMenu";
import { useEffect } from "react";

export function MobileBagMenu({
  onCloseClick,
  setActiveMenu,
}: {
  onCloseClick: () => void;
  setActiveMenu: (menu: string | null) => void;
}) {
  useEffect(() => {
    // Disable scrolling when component mounts
    document.body.style.overflow = "hidden";

    // Re-enable scrolling when component unmounts
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  return (
    <motion.div
      initial="hidden"
      animate="show"
      className="fixed inset-0 z-50 w-full h-screen bg-background pb-24 flex flex-col"
    >
      <div className="flex pt-4 px-2 sticky top-0 bg-background">
        <Button className="ml-auto" variant={"clear"} onClick={onCloseClick}>
          <XIcon className="w-5 h-5" />
        </Button>
      </div>

      <div className="px-8 py-2 flex-1 overflow-y-auto">
        <BagMenu
          isMobile
          setActiveMenu={setActiveMenu}
          onCloseClick={onCloseClick}
        />
      </div>
    </motion.div>
  );
}
