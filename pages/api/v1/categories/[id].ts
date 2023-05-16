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
        await getCategory(req, res);
        break;
      case "PUT":
        await updateCategory(req, res);
        break;
      case "DELETE":
        await deleteCategory(req, res);
        break;
      default:
        res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error });
  }
}

async function getCategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const category = await db.categories.getCategoryById(id as string);
  res.status(200).json(category);
}

async function updateCategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const category = await db.categories.updateCategory(id as string, req.body);
  res.status(200).json(category);
}

async function deleteCategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  await db.categories.deleteCategory(id as string);
  res.status(200).json({ success: "Item deleted successfully." });
}
