import { useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { BagDetails } from "../user-bags/BagView";

export const UserBag = () => {
  const { userId } = useParams({ strict: false });

  const user = useQuery(
    api.storeFront.user.getByIdentifier,
    userId ? { id: userId as Id<"storeFrontUser"> } : "skip"
  );

  const bag = useQuery(
    api.storeFront.bag.getByUserId,
    user ? { storeFrontUserId: user._id } : "skip"
  );

  if (!bag)
    return (
      <p className="text-sm text-muted-foreground">This user's bag is empty.</p>
    );

  return <BagDetails bag={bag} />;
};
