import { isNumber } from "@/lib";
import { Store } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case "GET":
      const sessionUser = await db.auth.getSessionUser();
      console.log("session user:", sessionUser);
      if (!sessionUser) {
        return res.status(403).json({ error: "Not authenticated" });
      }

      res.status(200).json({ data: sessionUser });
      break;
    default:
      res.status(405).json({ error: "Method Not Allowed" });
  }
}
