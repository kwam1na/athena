import { Hono } from "hono";
import { storefrontRoutes } from "../../packages/athena-webapp/convex/http/domains/customerChannel/routes/storefront";
import { LOGGED_IN_USER_ID_KEY } from "../../packages/athena-webapp/src/lib/constants";

const port = Number.parseInt(process.env.HARNESS_BEHAVIOR_PORT ?? "4312", 10);
const FIXTURE_STORE_NAME = "athena-harness-store";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Athena Runtime Harness Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        margin: 2rem;
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 1rem;
      }
      button {
        border: 1px solid #222;
        background: #f3f3f3;
        border-radius: 6px;
        padding: 0.6rem 0.9rem;
        cursor: pointer;
      }
      [data-auth-state],
      [data-storefront-state] {
        margin-top: 0.75rem;
        font-weight: 600;
      }
      [data-auth-user-id] {
        margin-top: 0.35rem;
      }
    </style>
  </head>
  <body>
    <h1>Athena Admin Shell Fixture</h1>
    <p>This runtime fixture mirrors Athena auth-shell + Convex-route composition contracts.</p>
    <p data-auth-state="booting">booting</p>
    <p data-auth-user-id>none</p>
    <div class="actions">
      <button id="load-storefront" type="button">Load storefront inventory</button>
      <button id="load-storefront-missing" type="button">Load storefront without store name</button>
    </div>
    <p data-storefront-state="idle">idle</p>
    <script>
      const AUTH_KEY = ${JSON.stringify(LOGGED_IN_USER_ID_KEY)};
      const FIXTURE_STORE_NAME = ${JSON.stringify(FIXTURE_STORE_NAME)};
      const authStateNode = document.querySelector("[data-auth-state]");
      const authUserNode = document.querySelector("[data-auth-user-id]");
      const storefrontNode = document.querySelector("[data-storefront-state]");

      async function reportAdminBoot(userId) {
        try {
          await fetch("/runtime/admin-shell-boot", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId }),
          });
        } catch (error) {
          console.error("admin shell runtime signal failed", error);
        }
      }

      async function loadStorefront(url) {
        storefrontNode.setAttribute("data-storefront-state", "loading");
        storefrontNode.textContent = "loading";

        try {
          const response = await fetch(url, { credentials: "include" });
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            const errorMessage = payload && payload.error ? payload.error : "unknown-error";
            storefrontNode.setAttribute("data-storefront-state", "error");
            storefrontNode.textContent = "error:" + errorMessage;
            return;
          }

          const storeName = payload && payload.name ? payload.name : "unknown-store";
          const skuCount = payload && typeof payload.inventorySkuCount === "number"
            ? payload.inventorySkuCount
            : 0;
          storefrontNode.setAttribute("data-storefront-state", "inventory-ready");
          storefrontNode.textContent = "inventory-ready:" + storeName + ":" + skuCount;
        } catch (error) {
          storefrontNode.setAttribute("data-storefront-state", "error");
          storefrontNode.textContent = "error:network-failure";
          console.error("storefront request failed", error);
        }
      }

      async function bootShell() {
        const url = new URL(window.location.href);
        const bootstrapUserId = url.searchParams.get("bootstrapUserId");
        if (bootstrapUserId) {
          window.localStorage.setItem(AUTH_KEY, bootstrapUserId);
        }

        const userId = window.localStorage.getItem(AUTH_KEY);
        if (!userId) {
          authStateNode.setAttribute("data-auth-state", "login-required");
          authStateNode.textContent = "login-required";
          authUserNode.textContent = "none";
          return;
        }

        authStateNode.setAttribute("data-auth-state", "authed");
        authStateNode.textContent = "authed";
        authUserNode.textContent = userId;
        await reportAdminBoot(userId);
      }

      document
        .getElementById("load-storefront")
        .addEventListener("click", () =>
          void loadStorefront("/storefront?storeName=" + encodeURIComponent(FIXTURE_STORE_NAME))
        );

      document
        .getElementById("load-storefront-missing")
        .addEventListener("click", () => void loadStorefront("/storefront"));

      void bootShell();
    </script>
  </body>
</html>`;

const fixtureStore = {
  _id: "m1773nc3djfy0qg7m0wp4v1bn9786n2y",
  organizationId: "kn7fw2ezvfrvp06ctjkb689tpd786c4j",
  name: FIXTURE_STORE_NAME,
  slug: "athena-harness-store",
  inventorySkuCount: 7,
};

type ConvexRuntimeEnv = {
  runQuery: (reference: unknown, args: Record<string, unknown>) => Promise<unknown>;
  runMutation: (reference: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

const convexRuntimeEnv: ConvexRuntimeEnv = {
  async runQuery(_reference, args) {
    if ("name" in args) {
      const storeName = String(args.name ?? "");
      console.log("RUNTIME_SIGNAL:convex-storefront-query");
      return storeName === FIXTURE_STORE_NAME ? fixtureStore : null;
    }

    if ("marker" in args) {
      console.log("RUNTIME_SIGNAL:convex-storefront-marker-query");
      return null;
    }

    return null;
  },
  async runMutation(_reference, args) {
    if ("marker" in args) {
      console.log("RUNTIME_SIGNAL:convex-storefront-marker-create");
    }

    return {
      _id: "guest_fixture_runtime_id",
    };
  },
};

const app = new Hono();

app.get("/health", () => {
  return new Response("ok");
});

app.get("/", () => {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
});

app.post("/runtime/admin-shell-boot", async (c) => {
  const payload = await c.req.json<{ userId?: string }>().catch(() => ({}));
  console.log(
    `RUNTIME_SIGNAL:athena-admin-shell-boot:${payload.userId ?? "unknown-user"}`
  );
  return c.json({ ok: true });
});

app.route("/storefront", storefrontRoutes as any);

const server = Bun.serve({
  port,
  fetch(request) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname.startsWith("/storefront")) {
      console.log("RUNTIME_SIGNAL:convex-storefront-route-hit");
    }

    return app.fetch(request, convexRuntimeEnv as never);
  },
});

console.log(`SERVER_READY:${port}`);

async function shutdown() {
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
