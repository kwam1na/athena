import { db } from "@/db";
import { Store } from "@/lib/types";
import { isNumber } from "@/lib";
import { supabase } from "@/lib/supabase";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case "GET":
      await getStore(req, res);
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

async function getStore(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .match({ id: id });

  const store = await db.stores.get(id as string);

  if (data?.length == 0) {
    res.status(404).json({ error: "No store with the given id" });
  } else if (error) {
    res.status(500).json({ error: error.message });
  } else {
    res.status(200).json(data);
  }
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
