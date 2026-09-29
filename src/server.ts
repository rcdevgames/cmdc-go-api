import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import type { CommandCodeClient } from "./commandcode/client.js";
import { loadConfig, type ProxyConfig } from "./config.js";
import { registerChatCompletions } from "./routes/chat-completions.js";
import { registerHealth } from "./routes/health.js";
import { registerModels } from "./routes/models.js";
import { registerResponses } from "./routes/responses.js";
import { registerAnthropic } from "./routes/anthropic.js";
import { openAiError } from "./errors.js";
import { CredentialPool } from "./credential-pool.js";

export type ServerDependencies = {
  commandCodeClient: CommandCodeClient;
  config?: ProxyConfig;
  credentialPool?: CredentialPool;
  logger?: FastifyServerOptions["logger"];
};

function withSafeRequestSerializer(
  logger: FastifyServerOptions["logger"],
): FastifyServerOptions["logger"] {
  if (!logger || typeof logger !== "object") {
    return logger;
  }

  return {
    ...logger,
    serializers: {
      ...logger.serializers,
      req: (request) => ({
        ...(logger.serializers?.req?.(request) ?? {}),
        method: request.method,
        url: request.url.split("?", 1)[0],
      }),
    },
  };
}

export function buildServer(dependencies: ServerDependencies): FastifyInstance {
  const config = dependencies.config ?? loadConfig(process.env);
  const credentialPool = dependencies.credentialPool ?? new CredentialPool(config.upstreamCredentials);
  const app = Fastify({
    logger: withSafeRequestSerializer(dependencies.logger ?? {
        level: "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.x-commandcode-api-key",
          ],
          censor: "[REDACTED]",
        },
      }),
    bodyLimit: config.maxRequestBytes,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (reply.sent) {
      return;
    }

    const code = (error as { code?: string }).code;
    const errorStatus = (error as { statusCode?: number }).statusCode;
    const status = code === "FST_ERR_CTP_BODY_TOO_LARGE"
      ? 413
      : errorStatus && errorStatus >= 400
        ? errorStatus
        : 400;
    const message = code === "FST_ERR_CTP_INVALID_JSON"
      ? "Invalid JSON body"
      : status === 413
        ? "Request body is too large"
        : "Request failed";
    return reply.code(status).send(openAiError(status, message, {
      type: "invalid_request_error",
      code: code === "FST_ERR_CTP_BODY_TOO_LARGE" ? "request_too_large" : "invalid_request",
    }));
  });

  void registerChatCompletions(app, { ...dependencies, config, credentialPool });
  void registerAnthropic(app, { ...dependencies, config, credentialPool });
  void registerResponses(app, { ...dependencies, config, credentialPool });
  void registerModels(app, config);
  void registerHealth(app);

  app.all("/v1/*", async (_request, reply) => {
    return reply.code(501).send(openAiError(501, "This OpenAI API endpoint is not supported by the CommandCode proxy", {
      type: "api_error",
      code: "unsupported_endpoint",
    }));
  });

  return app;
}
