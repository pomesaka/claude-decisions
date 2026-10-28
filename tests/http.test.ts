import { test, expect } from "bun:test";
import OpenAI from "openai";
import { createApp } from "../src/http/app";
import { DecisionService, emptyUsage } from "../src/application/service";
import {
  EnvCredentialStore,
  EnvTokenAuthenticator,
} from "../src/adapters/credentials";
import { DecisionError } from "../src/application/errors";
import type { DecisionModel } from "../src/ports/model";
import { predicate, choice, score } from "./fixtures";
const auth = new EnvTokenAuthenticator(
  new EnvCredentialStore({ DECISIONS_API_TOKEN: "local-test-token" }),
);
const model: DecisionModel = {
  async evaluate(_request, question) {
    return {
      answer: {
        refusal: false,
        probability: question.type === "predicate" ? 0.8 : null,
        weights: question.type === "predicate" ? null : [0.2, 0.3, 0.5],
        confidence: question.type === "predicate" ? null : 0.7,
      },
      usage: emptyUsage(),
    };
  },
};
const app = createApp(new DecisionService(model), auth);
const headers = {
  authorization: "Bearer local-test-token",
  "content-type": "application/json",
};
test("official SDK calls HTTP endpoint with all three questions", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
  });
  try {
    const client = new OpenAI({
      apiKey: "local-test-token",
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      maxRetries: 0,
    });
    const result = await client.decisions.create({
      model: "ignored-model",
      input: "x",
      questions: [predicate, choice, score],
    });
    expect(result.model).toBe("claude-haiku-5-5");
    expect(result.answers.map((a) => a.type)).toEqual([
      "predicate",
      "choice",
      "score",
    ]);
  } finally {
    server.stop(true);
  }
});
test.each([
  [
    "missing token",
    {},
    JSON.stringify({ input: "x", questions: [predicate] }),
    401,
  ],
  ["wrong token", { ...headers, authorization: "Bearer wrong" }, "{}", 401],
  ["invalid JSON", headers, "{broken", 400],
  ["schema invalid", headers, "{}", 400],
  [
    "wrong content type",
    { ...headers, "content-type": "text/plain" },
    "{}",
    400,
  ],
  ["body limit", { ...headers, "content-length": "33554433" }, "{}", 413],
])("HTTP %s", async (_label, requestHeaders, body, status) => {
  const response = await app.request("/v1/decisions", {
    method: "POST",
    headers: requestHeaders,
    body,
  });
  expect(response.status).toBe(status);
  expect(await response.json()).toHaveProperty("error.code");
});
test("model omission is supported", async () =>
  expect(
    (
      await app.request("/v1/decisions", {
        method: "POST",
        headers,
        body: JSON.stringify({ input: "x", questions: [predicate] }),
      })
    ).status,
  ).toBe(200));
test.each([
  new Error("secret-api-key"),
  new DecisionError(502, "upstream_error", "Provider failed."),
])("sanitizes failures", async (error) => {
  const failing = createApp(
    new DecisionService({
      async evaluate() {
        throw error;
      },
    }),
    auth,
  );
  const response = await failing.request("/v1/decisions", {
    method: "POST",
    headers,
    body: JSON.stringify({ input: "x", questions: [predicate] }),
  });
  expect(response.status).toBe(error instanceof DecisionError ? 502 : 500);
  expect(await response.text()).not.toContain("secret-api-key");
});

test("local capacity limit returns 429 and recovers", async () => {
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const busy = createApp(
    new DecisionService({
      async evaluate(request, question, signal) {
        entered++;
        await blocked;
        return model.evaluate(request, question, signal);
      },
    }),
    auth,
  );
  const send = () =>
    busy.request("/v1/decisions", {
      method: "POST",
      headers,
      body: JSON.stringify({ input: "x", questions: [predicate] }),
    });
  const pending = Array.from({ length: 8 }, send);
  while (entered < 8) await Bun.sleep(1);
  try {
    expect((await send()).status).toBe(429);
  } finally {
    release();
    await Promise.all(pending);
  }
  expect((await send()).status).toBe(200);
});
