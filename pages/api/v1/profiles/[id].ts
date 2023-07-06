import { db } from "@/db";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case "GET":
        await getUserProfile(req, res);
        break;
      case "PUT":
        await updateUserProfile(req, res);
        break;
      case "DELETE":
        await deleteUserProfile(req, res);
        break;
      default:
        res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error });
  }
}

async function getUserProfile(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const profile = await db.profiles.getUserProfileById(id as string);
  res.status(200).json(profile);
}

async function updateUserProfile(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const profile = await db.profiles.updateUserProfile(id as string, req.body);
  res.status(200).json(profile);
}

async function deleteUserProfile(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  await db.profiles.deleteUserProfile(id as string);
  res.status(200).json({ success: "Item deleted successfully." });
}

// async function getProfile(req: NextApiRequest, res: NextApiResponse) {
//   const { id } = req.query;
//   const user = await db.profiles.get(id as string);
//   if (!user) {
//     return res.status(404).json({ error: "No user with the given id" });
//   }

//   const store = await db.stores.get(user.store_associated_with);

//   if (!store) {
//     return res
//       .status(404)
//       .json({ error: "This user is not associated with any stores" });
//   }

//   const userProfile: UserProfile = {
//     id: user.id,
//     store_associated_with: user.store_associated_with,
//     store: {
//       id: store.id,
//       name: store.name,
//       created_at: store.created_at,
//       is_subscribed: store.is_subscribed,
//     },
//   };

//   res.status(200).json(userProfile);
// }
