// pages/api/items/index.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case "GET":
        const items = await db.items.getItems();
        res.status(200).json(items);
        break;
      case "POST":
        const newItem = await db.items.createItem(req.body);
        res.status(201).json(newItem);
        break;
      default:
        res.setHeader("Allow", ["GET", "POST"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
