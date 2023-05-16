import { db } from "@/db";
import { isNumber } from "@/lib";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case "GET":
        await getItem(req, res);
        break;
      case "PUT":
        await updateItem(req, res);
        break;
      case "DELETE":
        await deleteItem(req, res);
        break;
      default:
        res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error });
  }
}

async function getItem(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const item = await db.items.getItemById(id as string);
  res.status(200).json(item);
}

async function updateItem(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const item = await db.items.updateItem(id as string, req.body);
  res.status(200).json(item);
}

async function deleteItem(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  await db.items.deleteItem(id as string);
  res.status(200).json({ success: "Item deleted successfully." });
}
