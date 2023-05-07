import { db } from "@/db";
import { Store, UserProfile } from "@/lib/types";
import { isNumber } from "@/lib";
import { supabase } from "@/lib/supabase";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case "GET":
      await getProfile(req, res);
      break;
    case "PUT":
      await updateStore(req, res);
      break;
    case "DELETE":
      await deleteStore(req, res);
      break;
    default:
      res.status(405).json({ error: "Method Not Allowed" });
  }
}

async function getProfile(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const user = await db.profiles.get(id as string);
  if (!user) {
    return res.status(404).json({ error: "No user with the given id" });
  }

  const store = await db.stores.get(user.store_associated_with);

  if (!store) {
    return res
      .status(404)
      .json({ error: "This user is not associated with any stores" });
  }

  const userProfile: UserProfile = {
    id: user.id,
    store_associated_with: user.store_associated_with,
    store: {
      id: store.id,
      name: store.name,
      created_at: store.created_at,
      is_subscribed: store.is_subscribed,
    },
  };

  res.status(200).json(userProfile);
}

// PUT: Update an existing store
async function updateStore(req: NextApiRequest, res: NextApiResponse) {
  //   const { id } = req.query;
  //   if (!isNumber(id as string)) {
  //     res.status(400).json({ error: "Invalid id given." });
  //     return;
  //   }
  //   const updatedStore: Store = {
  //     name: req.body?.name,
  //     is_subscribed: req.body?.is_subscribed,
  //   };
  //   const { data, error } = await supabase
  //     .from("stores")
  //     .update(updatedStore)
  //     .match({ id: id })
  //     .select();
  //   if (error) {
  //     res.status(500).json({ error: error.message });
  //   } else {
  //     res.status(200).json({ store: data[0] });
  //   }
}

// DELETE: Remove a store
async function deleteStore(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const { data, error } = await supabase
    .from("stores")
    .delete()
    .match({ id: Number(id) })
    .select();

  if (data?.length == 0) {
    res.status(404).json({ error: "Store with given id not found." });
  } else if (error) {
    res.status(500).json({ error: error.message });
  } else {
    res.status(200).json({ success: "Store deleted successfully." });
  }
}
