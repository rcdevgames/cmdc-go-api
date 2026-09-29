import { loadConfig } from "./config.js";
import { createCommandCodeClient } from "./commandcode/client.js";
import { CredentialPool } from "./credential-pool.js";
import { buildServer } from "./server.js";

export async function start(): Promise<void> {
  const config = loadConfig(process.env);
  const credentialPool = new CredentialPool(config.upstreamCredentials);
  const app = buildServer({
    commandCodeClient: createCommandCodeClient({ config }),
    config,
    credentialPool,
  });

  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.main) {
  await start();
}
