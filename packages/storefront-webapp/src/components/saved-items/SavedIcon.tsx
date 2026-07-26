import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { HeartIcon } from "lucide-react";

interface SavedIconProps {
  notificationCount?: number;
}

const SavedIcon: React.FC<SavedIconProps> = ({ notificationCount }) => {
  return (
    <span className="relative inline-flex" aria-hidden="true">
      {Boolean(notificationCount) && <HeartIconFilled width={16} height={16} />}
      {!Boolean(notificationCount) && <HeartIcon className="w-4 h-4" />}
    </span>
  );
};

export default SavedIcon;
