import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (context) => {
  return context.json({
    ok: true,
    service: "sync-api",
  });
});

const port = Number.parseInt(process.env.PORT ?? "4000", 10);

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`sync-api listening on http://localhost:${info.port}`);
  },
);

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, closing sync-api`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
