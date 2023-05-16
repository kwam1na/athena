import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case "GET":
        const transactions = await db.transactions.getTransactions();
        res.status(200).json(transactions);
        break;
      case "POST":
        const transaction = await db.transactions.createTransaction(req.body);
        res.status(201).json(transaction);
        break;
      default:
        res.setHeader("Allow", ["GET", "POST"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    res.status(500).json({ error: error });
  }
}
