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
        await getTransaction(req, res);
        break;
      case "DELETE":
        await deleteTransaction(req, res);
        break;
      default:
        res.setHeader("Allow", ["GET", "DELETE"]);
        res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error });
  }
}

async function getTransaction(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  const transaction = await db.transactions.getTransactionById(id as string);
  res.status(200).json(transaction);
}

async function deleteTransaction(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!isNumber(id as string)) {
    res.status(400).json({ error: "Invalid id given." });
    return;
  }
  await db.transactions.deleteTransaction(id as string);
  res.status(200).json({ success: "Item deleted successfully." });
}
