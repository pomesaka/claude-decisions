import { configure } from "./config";
import { BunImageLoader } from "../adapters/bun-images";
const { app, port } = configure(Bun.env, new BunImageLoader());
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: app.fetch,
  idleTimeout: 180,
});
console.info(`Claude Decisions listening on http://127.0.0.1:${server.port}`);
