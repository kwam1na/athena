import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case "GET":
        const categories = await db.categories.getCategories();
        res.status(200).json(categories);
        break;
      case "POST":
        const newCategory = await db.categories.createCategory(req.body);
        res.status(201).json(newCategory);
        break;
      default:
        res.setHeader("Allow", ["GET", "POST"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
