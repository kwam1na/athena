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
        await getSubcategory(req, res);
        break;
      case "PUT":
        await updateSubcategory(req, res);
        break;
      case "DELETE":
        await deleteSubcategory(req, res);
        break;
      default:
        res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error });
  }
}

async function getSubcategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const category = await db.subcategories.getSubcategoryById(id as string);
  res.status(200).json(category);
}

async function updateSubcategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const category = await db.subcategories.updateSubcategory(
    id as string,
    req.body
  );
  res.status(200).json(category);
}

async function deleteSubcategory(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  await db.subcategories.deleteSubcategory(id as string);
  res.status(200).json({ success: "Item deleted successfully." });
}
