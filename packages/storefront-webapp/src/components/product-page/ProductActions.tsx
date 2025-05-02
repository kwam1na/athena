import { SavedBagItem } from "@athena/webapp";
import { HeartIcon, AlertCircleIcon } from "lucide-react";
import { LoadingButton } from "../ui/loading-button";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { motion } from "framer-motion";

interface ProductActionsProps {
  handleUpdateBag: () => Promise<void>;
  handleUpdateSavedBag: () => Promise<void>;
  isUpdatingBag: boolean;
  savedBagItem?: SavedBagItem;
  isSoldOut: boolean;
  addedItemSuccessfully: boolean | null;
  className?: string;
}

export function ProductActions({
  handleUpdateBag,
  handleUpdateSavedBag,
  isUpdatingBag,
  savedBagItem,
  isSoldOut,
  addedItemSuccessfully,
  className = "",
}: ProductActionsProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex gap-4">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeInOut" },
          }}
        >
          <LoadingButton
            className="w-[288px]"
            isLoading={false}
            onClick={handleUpdateBag}
            disabled={isSoldOut}
          >
            {isUpdatingBag ? "Adding to Bag.." : "Add to Bag"}
          </LoadingButton>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ease: "easeInOut" },
          }}
        >
          <LoadingButton
            variant={"outline"}
            isLoading={false}
            onClick={handleUpdateSavedBag}
            disabled={isSoldOut}
            className={`${savedBagItem ? "border-[#EC4683] shadow-md" : ""} hover:shadow-md`}
          >
            {!savedBagItem && (
              <HeartIcon className="w-4 h-4 text-muted-foreground" />
            )}
            {savedBagItem && <HeartIconFilled width={16} height={16} />}
          </LoadingButton>
        </motion.div>
      </div>

      {addedItemSuccessfully === false && (
        <div className="flex gap-1 items-center text-destructive">
          <AlertCircleIcon className="w-3.5 h-3.5" />
          <p className="text-sm">
            An error occurred processing your last request
          </p>
        </div>
      )}
    </div>
  );
}
