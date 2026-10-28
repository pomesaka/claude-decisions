import { test, expect } from "bun:test";
import { AnthropicModel, AnthropicTransport } from "../src/adapters/anthropic";
import { EnvCredentialStore } from "../src/adapters/credentials";
import { BunImageLoader } from "../src/adapters/bun-images";
import { requestSchema } from "../src/contract/request";
import type { ModelTransport } from "../src/adapters/anthropic";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { message, fullRequest, predicate } from "./fixtures";
const signal = new AbortController().signal;
test("preserves evidence boundaries, image inputs, ids and measured cache usage", async () => {
  let sent: MessageCreateParamsNonStreaming | undefined;
  const transport: ModelTransport = {
    async send(body) {
      sent = body;
      return message([
        {
          id: 0,
          refusal: false,
          probability: 0.8,
          weights: null,
          confidence: null,
        },
      ]);
    },
  };
  const adapter = new AnthropicModel(transport, new BunImageLoader());
  const result = await adapter.evaluate(
    requestSchema.parse(fullRequest),
    [{ id: 0, question: predicate }],
    signal,
  );
  expect(sent?.model).toBe("claude-haiku-5-5");
  expect(sent?.messages).toHaveLength(1);
  expect(sent?.messages[0]?.role).toBe("user");
  const content = sent?.messages[0]?.content;
  expect(typeof content).not.toBe("string");
  if (Array.isArray(content)) {
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(JSON.stringify(content)).toContain("evidence_role");
  }
  expect(result.usage).toEqual({
    input_tokens: 15,
    output_tokens: 5,
    total_tokens: 20,
    input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
    output_tokens_details: { reasoning_tokens: 0 },
  });
});
test.each(["max_tokens", "refusal", "model_context_window_exceeded"])(
  "does not disguise provider stop %s as question refusal",
  async (stop) => {
    const transport: ModelTransport = {
      async send() {
        const result = message([]);
        if (
          stop === "max_tokens" ||
          stop === "refusal" ||
          stop === "model_context_window_exceeded"
        )
          result.stop_reason = stop;
        return result;
      },
    };
    await expect(
      new AnthropicModel(transport, new BunImageLoader()).evaluate(
        requestSchema.parse({ input: "x", questions: [predicate] }),
        [{ id: 0, question: predicate }],
        signal,
      ),
    ).rejects.toThrow();
  },
);
test("missing provider key is sanitized", async () =>
  await expect(
    new AnthropicTransport(new EnvCredentialStore({})).send(
      {
        model: "claude-haiku-5-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "x" }],
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: "provider_not_configured" }));

test("direct and gateway transport use rotating credentials without leaking errors", async () => {
  const values = {
    ANTHROPIC_API_KEY: "provider-first",
    CF_AIG_TOKEN: "gateway-token",
  };
  const seen: Request[] = [];
  const transport = new AnthropicTransport(
    new EnvCredentialStore(values),
    "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic",
    true,
    async (input, init) => {
      seen.push(
        input instanceof Request
          ? new Request(input, init)
          : new Request(String(input), init),
      );
      return Response.json(message([]));
    },
  );
  const body: MessageCreateParamsNonStreaming = {
    model: "claude-haiku-5-5",
    max_tokens: 10,
    messages: [{ role: "user", content: "x" }],
  };
  await transport.send(body, signal);
  values.ANTHROPIC_API_KEY = "provider-second";
  await transport.send(body, signal);
  expect(seen[0]?.url).toBe(
    "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/messages",
  );
  expect(seen[0]?.headers.get("x-api-key")).toBe("provider-first");
  expect(seen[1]?.headers.get("x-api-key")).toBe("provider-second");
  expect(seen[0]?.headers.get("cf-aig-authorization")).toBe(
    "Bearer gateway-token",
  );
});
test.each([401, 403, 429, 500])(
  "sanitizes provider HTTP %i",
  async (status) => {
    const transport = new AnthropicTransport(
      new EnvCredentialStore({ ANTHROPIC_API_KEY: "provider-secret" }),
      undefined,
      false,
      async () =>
        Response.json(
          { error: { type: "api_error", message: "provider-secret" } },
          { status },
        ),
    );
    try {
      await transport.send(
        {
          model: "claude-haiku-5-5",
          max_tokens: 10,
          messages: [{ role: "user", content: "x" }],
        },
        signal,
      );
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).not.toContain("provider-secret");
      expect(error).toMatchObject({ status: status === 429 ? 429 : 502 });
    }
  },
);
test("Structured Outputs schema removes unsupported numeric bounds", async () => {
  const transport: ModelTransport = {
    async send(body) {
      expect(JSON.stringify(body.output_config)).not.toContain('"minimum"');
      return message([
        {
          id: 0,
          refusal: false,
          probability: 1,
          weights: null,
          confidence: null,
        },
      ]);
    },
  };
  await new AnthropicModel(transport, new BunImageLoader()).evaluate(
    requestSchema.parse({ input: "x", questions: [predicate] }),
    [{ id: 0, question: predicate }],
    signal,
  );
});
