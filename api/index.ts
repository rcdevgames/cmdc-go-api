import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../src/config.js";
import { createCommandCodeClient } from "../src/commandcode/client.js";
import { buildServer } from "../src/server.js";

let appPromise: ReturnType<typeof createApp> | undefined;

async function createApp() {
  const config = loadConfig(process.env);
  if (!config.commandCodeApiKey) throw new Error("auth_cc is not configured");
  if (!config.proxyApiKey) throw new Error("apikey is not configured");
  const app = buildServer({
    commandCodeClient: createCommandCodeClient({ config }),
    config,
  });
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= createApp();
  const app = await appPromise;
  app.server.emit("request", req, res);
}
