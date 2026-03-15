import { jwtVerify } from "jose";
import { Context } from "hono";
import { STOREFRONT_ACTOR_SIGNING_KEY } from "../../../../env";

const encoder = new TextEncoder();

type ActorType = "guest" | "user" | "system";

type ActorClaims = {
  actorId: string;
  storeId: string;
  organizationId: string;
  actorType?: ActorType;
};

const ALLOWED_ACTOR_TYPES: ActorType[] = ["guest", "user", "system"];

export async function getActorClaims(c: Context): Promise<ActorClaims | null> {
  if (!STOREFRONT_ACTOR_SIGNING_KEY) {
    return null;
  }

  const token = c.req.header("x-athena-actor-token");

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      token,
      encoder.encode(STOREFRONT_ACTOR_SIGNING_KEY),
      {
        algorithms: ["HS256"],
      }
    );

    const actorId = payload.sub;
    const storeId = payload.storeId;
    const organizationId = payload.organizationId;

    if (
      typeof actorId !== "string" ||
      typeof storeId !== "string" ||
      typeof organizationId !== "string"
    ) {
      return null;
    }

    const rawActorType = payload.actorType;
    const actorType = ALLOWED_ACTOR_TYPES.includes(rawActorType as ActorType)
      ? (rawActorType as ActorType)
      : undefined;

    return { actorId, storeId, organizationId, actorType };
  } catch {
    return null;
  }
}

export async function enforceActorAccess(c: Context, userIdParam = "userId") {
  if (!STOREFRONT_ACTOR_SIGNING_KEY) {
    return c.json(
      { error: "Storefront actor signing key is not configured." },
      500
    );
  }

  const claims = await getActorClaims(c);

  if (!claims) {
    return c.json({ error: "Unauthorized request." }, 401);
  }

  const userId = c.req.param(userIdParam);
  const storeId = c.req.param("storeId");
  const organizationId = c.req.param("organizationId");

  if (!userId || !storeId || !organizationId) {
    return c.json({ error: "Invalid route context." }, 400);
  }

  if (
    claims.actorId !== userId ||
    claims.storeId !== storeId ||
    claims.organizationId !== organizationId
  ) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return null;
}

export async function enforceActorStoreAccess(c: Context) {
  if (!STOREFRONT_ACTOR_SIGNING_KEY) {
    return c.json(
      { error: "Storefront actor signing key is not configured." },
      500
    );
  }

  const claims = await getActorClaims(c);

  if (!claims) {
    return c.json({ error: "Unauthorized request." }, 401);
  }

  const storeId = c.req.param("storeId");
  const organizationId = c.req.param("organizationId");

  if (!storeId || !organizationId) {
    return c.json({ error: "Invalid route context." }, 400);
  }

  if (
    claims.storeId !== storeId ||
    claims.organizationId !== organizationId
  ) {
    return c.json({ error: "Forbidden." }, 403);
  }

  return null;
}
