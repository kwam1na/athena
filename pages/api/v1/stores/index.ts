import { isNumber } from "@/lib";
import { Store } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case "GET":
      await getStores(req, res);
      break;
    case "POST":
      await createStore(req, res);
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

// GET: Retrieve all stores
async function getStores(req: NextApiRequest, res: NextApiResponse) {
  console.log("here?");
  const { data, error } = await supabase.from("stores").select("*");
  if (error) {
    res.status(500).json({ error: error.message });
  } else {
    res.status(200).json(data);
  }
}

// POST: Create a new store
async function createStore(req: NextApiRequest, res: NextApiResponse) {
  //   if (!req.body.name) {
  //     res.status(404).json({ error: "The name of the store is required." });
  //     return;
  //   }
  //   const store: Store = {
  //     name: req.body.name,
  //     is_subscribed: req.body?.is_subscribed || false,
  //     created_at: new Date().toISOString(),
  //   };
  //   const { data, error } = await supabase.from("stores").insert([store]);
  //   if (error) {
  //     res.status(500).json({ error: error.message });
  //   } else {
  //     res.status(201).json({ store: store });
  //   }
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
  //     .match({ id: id });
  //   if (error) {
  //     res.status(500).json({ error: error.message });
  //   } else {
  //     res.status(200).json({ success: "Store updated successfully." });
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
