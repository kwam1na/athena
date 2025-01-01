import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { HeartIcon } from "lucide-react";

interface SavedIconProps {
  notificationCount?: number; // Optional prop to display the count
}

const SavedIcon: React.FC<SavedIconProps> = ({ notificationCount }) => {
  return (
    <div className="relative inline-block">
      {Boolean(notificationCount) && <HeartIconFilled width={16} height={16} />}
      {!Boolean(notificationCount) && <HeartIcon className="w-4 h-4" />}

      {/* Notification Dot */}
      {/* {Boolean(notificationCount) && (
        <span className="absolute top-0 left-4 w-2 h-2 bg-accent2 rounded-full flex items-center justify-center text-xs text-white" />
      )} */}
    </div>
  );
};

export default SavedIcon;
