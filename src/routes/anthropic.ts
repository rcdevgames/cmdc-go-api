import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CredentialPool } from "../credential-pool.js";
import { resolveCredential } from "../auth.js";
import type { CommandCodeClient } from "../commandcode/client.js";
import type { CommandCodeEvent } from "../commandcode/types.js";
import type { ProxyConfig } from "../config.js";
import { UpstreamStreamError } from "../errors.js";
import { toCommandCodeGenerateRequest } from "../translate/generate-request.js";
import { aggregateChatEvents } from "../translate/chat.js";

type AnthropicBody = {
  model?: string;
  system?: string | Array<{ type?: string; text?: string }>;
  messages?: Array<{ role: string; content: unknown }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
};

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    if (item.type === "text") return typeof item.text === "string" ? item.text : "";
    if (item.type === "thinking") return typeof item.thinking === "string" ? item.thinking : "";
    if (item.type === "tool_use") return JSON.stringify({ name: item.name, input: item.input ?? {} });
    if (item.type === "tool_result") return contentText(item.content ?? item.result);
    return "";
  }).join("");
}

function parseToolInput(argumentsText: string): unknown {
  try { return JSON.parse(argumentsText || "{}"); }
  catch { return {}; }
}

function toChat(body: AnthropicBody, config: ProxyConfig) {
  const system = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.system) ? body.system.map((x) => x.text ?? "").join("\n") : "";
  const messages = (body.messages ?? []).flatMap((message) => {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      const blocks = message.content as Array<Record<string, unknown>>;
      const text = blocks.filter((x) => x.type === "text" || x.type === "thinking")
        .map((x) => x.type === "text" ? String(x.text ?? "") : String(x.thinking ?? "")).join("");
      const toolCalls = blocks.filter((x) => x.type === "tool_use").map((x) => ({
        id: String(x.id ?? randomUUID()), type: "function" as const,
        function: { name: String(x.name ?? ""), arguments: JSON.stringify(x.input ?? {}) },
      }));
      return [{ role: "assistant" as const, content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }];
    }
    if (message.role === "user" && Array.isArray(message.content)) {
      const results = (message.content as Array<Record<string, unknown>>).filter((x) => x.type === "tool_result");
      if (results.length) return results.map((x) => ({ role: "tool" as const, tool_call_id: String(x.tool_use_id ?? ""), content: contentText(x.content ?? x.result) }));
    }
    return [{ role: message.role as "user" | "assistant" | "tool", content: contentText(message.content) }];
  });
  return {
    model: config.fixedModel,
    messages: [...(system ? [{ role: "system" as const, content: system }] : []), ...messages],
    stream: body.stream,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    tools: body.tools?.map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    })),
  };
}

function anthropicResponse(body: AnthropicBody, events: CommandCodeEvent[]) {
  const state = aggregateChatEvents(events);
  return {
    id: `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content: [
      ...(state.reasoning ? [{ type: "thinking", thinking: state.reasoning }] : []),
      ...(state.text ? [{ type: "text", text: state.text }] : []),
      ...state.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: parseToolInput(call.arguments) })),
    ],
    stop_reason: state.toolCalls.length ? "tool_use" : state.finishReason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: state.usage ? { input_tokens: state.usage.prompt_tokens, output_tokens: state.usage.completion_tokens } : { input_tokens: 0, output_tokens: 0 },
  };
}

function sendError(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ type: "error", error: { type: status === 401 ? "authentication_error" : "api_error", message } });
}

export async function registerAnthropic(app: FastifyInstance, dependencies: { commandCodeClient: CommandCodeClient; config: ProxyConfig; credentialPool: CredentialPool }) {
  for (const path of ["/v1/messages", "/message"]) app.post(path, async (request: FastifyRequest, reply: FastifyReply) => {
    const credential = resolveCredential(request.headers, dependencies.config, dependencies.credentialPool);
    if (!credential) return sendError(reply, 401, "Missing or invalid proxy API key");
    const apiKey = credential.upstreamKey;
    const raw = request.body as AnthropicBody;
    if (!Array.isArray(raw?.messages) || raw.messages.length === 0) return sendError(reply, 400, "messages is required");
    const chat = toChat(raw, dependencies.config);
    const lifecycle = new AbortController();
    try {
      const events: CommandCodeEvent[] = [];
      for await (const event of dependencies.commandCodeClient.stream({
        apiKey, signal: lifecycle.signal, request: toCommandCodeGenerateRequest(chat as never, { defaultMaxTokens: dependencies.config.defaultMaxTokens }),
      })) events.push(event);
      const output = anthropicResponse(raw, events);
      if (!raw.stream) return reply.send(output);
      reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      reply.raw.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { ...output, content: [] } })}\n\n`);
      output.content.forEach((block, index) => {
        const value = block as Record<string, unknown>;
        const contentBlock = block.type === "text"
          ? { type: "text", text: "" }
          : block.type === "thinking"
            ? { type: "thinking", thinking: "" }
            : { type: "tool_use", id: String(value.id), name: String(value.name), input: {} };
        reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index, content_block: contentBlock })}\n\n`);
        if (block.type === "text") {
          reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "text_delta", text: String(value.text ?? "") } })}\n\n`);
        } else if (block.type === "thinking") {
          reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: String(value.thinking ?? "") } })}\n\n`);
        } else {
          reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(value.input ?? {}) } })}\n\n`);
        }
        reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`);
      });
      reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: output.stop_reason }, usage: output.usage })}\n\n`);
      reply.raw.end("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
    } catch (error) {
    const status = error instanceof UpstreamStreamError ? error.status : 502;
      if (!reply.sent) return sendError(reply, status, error instanceof Error ? error.message : String(error));
      reply.raw.end();
    }
  });
}
