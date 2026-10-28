import { test, expect } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { message, predicate, png } from "./fixtures";
import { responseSchema } from "../src/contract/response";
test("Workers runtime evaluates a request through the real Anthropic SDK", async () => {
  const build = await Bun.build({
    entrypoints: ["src/entrypoints/worker.ts"],
    target: "browser",
    minify: true,
  });
  expect(build.success).toBe(true);
  const artifact = build.outputs[0];
  if (!artifact) throw new Error("Worker bundle missing");
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await artifact.text(),
      compatibilityDate: "2026-10-28",
      bindings: {
        ANTHROPIC_API_KEY: "mock-provider-key",
        DECISIONS_API_TOKEN: "mock-client-token",
      },
      outboundService: async () =>
        Response.json(
          message([
            {
              id: 0,
              refusal: false,
              probability: 0.9,
              weights: null,
              confidence: null,
            },
          ]),
        ),
    }),
  );
  try {
    const headers = {
      authorization: "Bearer mock-client-token",
      "content-type": "application/json",
    };
    const response = await fetch(
      new URL("/v1/decisions", await runtime.ready),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: [{ type: "input_image", image_url: png }],
            },
          ],
          questions: [predicate],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(
      responseSchema.parse(await response.json()).answers[0],
    ).toMatchObject({ type: "predicate", probability: 0.9 });
    const noAuth = await fetch(new URL("/v1/decisions", await runtime.ready), {
      method: "POST",
      body: "{}",
    });
    expect(noAuth.status).toBe(401);
  } finally {
    await runtime.dispose();
  }
}, 30_000);
