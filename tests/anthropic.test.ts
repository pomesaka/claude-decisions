import { test, expect } from "bun:test";
import { AnthropicModel, AnthropicTransport } from "../src/adapters/anthropic";
import { EnvCredentialStore } from "../src/adapters/credentials";
import { BunImageLoader } from "../src/adapters/bun-images";
import { requestSchema } from "../src/contract/request";
import type { ModelTransport } from "../src/adapters/anthropic";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { message, fullRequest, predicate, choice } from "./fixtures";
const signal = new AbortController().signal;
test("preserves evidence boundaries, image inputs and measured cache usage", async () => {
  let sent: MessageCreateParamsNonStreaming | undefined;
  const transport: ModelTransport = {
    async send(body) {
      sent = body;
      return message({ probability: 0.8 });
    },
  };
  const adapter = new AnthropicModel(transport, new BunImageLoader());
  const result = await adapter.evaluate(
    requestSchema.parse(fullRequest),
    predicate,
    signal,
  );
  expect(sent?.model).toBe("claude-haiku-5-5");
  expect(sent?.thinking).toEqual({ type: "disabled" });
  expect(sent?.output_config?.effort).toBe("low");
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
        const result = message({});
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
        predicate,
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
      return Response.json(message({}));
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
      return message({ probability: 1 });
    },
  };
  await new AnthropicModel(transport, new BunImageLoader()).evaluate(
    requestSchema.parse({ input: "x", questions: [predicate] }),
    predicate,
    signal,
  );
});
test.each([
  {
    case: "predicate probability",
    question: predicate,
    output: { probability: 0.4 },
    expected: {
      refusal: false,
      probability: 0.4,
      weights: null,
      confidence: null,
    },
  },
  {
    case: "choice weights in option order",
    question: choice,
    output: {
      weights: { "2:false": 0.5, "0:true": 0.2, "1:true": 0.3 },
      confidence: 0.6,
    },
    expected: {
      refusal: false,
      probability: null,
      weights: [0.2, 0.3, 0.5],
      confidence: 0.6,
    },
  },
  {
    case: "question refusal",
    question: choice,
    output: { refusal: true },
    expected: {
      refusal: true,
      probability: null,
      weights: null,
      confidence: null,
    },
  },
])("maps model output: $case", async ({ question, output, expected }) => {
  const transport: ModelTransport = {
    async send() {
      return message(output);
    },
  };
  const result = await new AnthropicModel(
    transport,
    new BunImageLoader(),
  ).evaluate(
    requestSchema.parse({ input: "x", questions: [question] }),
    question,
    signal,
  );
  expect(result.answer).toEqual({
    ...expected,
    weights: expected.weights && [...expected.weights],
  });
});
test.each([
  {
    case: "missing option",
    output: { weights: { "0:true": 1, "1:true": 0 }, confidence: 1 },
  },
  {
    case: "extra option",
    output: {
      weights: { "0:true": 1, "1:true": 0, "2:false": 0, "3:x": 0 },
      confidence: 1,
    },
  },
  { case: "predicate shape for choice", output: { probability: 0.5 } },
  {
    case: "null weights without refusal",
    output: { weights: null, confidence: 0.3 },
  },
])("rejects choice output with $case", async ({ output }) => {
  const transport: ModelTransport = {
    async send() {
      return message(output);
    },
  };
  await expect(
    new AnthropicModel(transport, new BunImageLoader()).evaluate(
      requestSchema.parse({ input: "x", questions: [choice] }),
      choice,
      signal,
    ),
  ).rejects.toThrow();
});
test("output schema has one key per option and a refusal variant", async () => {
  let format = "";
  const transport: ModelTransport = {
    async send(body) {
      format = JSON.stringify(body.output_config?.format);
      return message({ refusal: true });
    },
  };
  await new AnthropicModel(transport, new BunImageLoader()).evaluate(
    requestSchema.parse({ input: "x", questions: [choice] }),
    choice,
    signal,
  );
  expect(format).toContain('"0:true"');
  expect(format).toContain('"2:false"');
  expect(format).toContain('"refusal"');
});
test.each([
  { case: "default", options: undefined, ttl: "5m" },
  { case: "explicit 30m request", options: { ttl: "30m" }, ttl: "1h" },
])("evidence cache TTL for $case is $ttl", async ({ options, ttl }) => {
  let sent: MessageCreateParamsNonStreaming | undefined;
  const transport: ModelTransport = {
    async send(body) {
      sent = body;
      return message({ probability: 0.5 });
    },
  };
  await new AnthropicModel(transport, new BunImageLoader()).evaluate(
    requestSchema.parse({
      input: "x",
      questions: [predicate],
      prompt_cache_options: options,
    }),
    predicate,
    signal,
  );
  const content = sent?.messages[0]?.content;
  const ttls = Array.isArray(content)
    ? content.flatMap((block) =>
        "cache_control" in block && block.cache_control
          ? [block.cache_control.ttl]
          : [],
      )
    : [];
  expect(ttls).toEqual([ttl]);
});
