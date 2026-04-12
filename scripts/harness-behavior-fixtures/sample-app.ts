const port = Number.parseInt(process.env.HARNESS_BEHAVIOR_PORT ?? "4311", 10);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Harness Behavior Fixture</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        margin: 2rem;
      }
      button {
        border: 1px solid #222;
        background: #f3f3f3;
        border-radius: 6px;
        padding: 0.6rem 0.9rem;
        cursor: pointer;
      }
      [data-signal="done"] {
        display: inline-block;
        margin-left: 0.6rem;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <h1>Harness Behavior Fixture</h1>
    <p>This minimal app emits runtime signals for harness verification.</p>
    <button id="trigger" type="button">Trigger runtime signal</button>
    <span data-signal="done">pending</span>
    <script>
      const triggerButton = document.getElementById("trigger");
      const signalNode = document.querySelector("[data-signal='done']");

      async function triggerSignal() {
        signalNode.textContent = "running";
        try {
          const response = await fetch("/signal", {
            method: "POST",
          });
          signalNode.textContent = await response.text();
        } catch (error) {
          signalNode.textContent = "failed";
          console.error("signal request failed", error);
        }
      }

      triggerButton.addEventListener("click", triggerSignal);
    </script>
  </body>
</html>`;

const server = Bun.serve({
  port,
  async fetch(request) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === "/health") {
      return new Response("ok");
    }

    if (requestUrl.pathname === "/signal" && request.method === "POST") {
      console.log("RUNTIME_SIGNAL:browser-clicked");
      return new Response("signal-recorded");
    }

    if (requestUrl.pathname === "/") {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    return new Response("not found", {
      status: 404,
    });
  },
});

console.log(`SERVER_READY:${port}`);

async function shutdown() {
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
