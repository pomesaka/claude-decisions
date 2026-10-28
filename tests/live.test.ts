import { test, expect } from "bun:test";
import { configure } from "../src/entrypoints/config";
import { BunImageLoader } from "../src/adapters/bun-images";
import { predicate, choice, score, png } from "./fixtures";
import { responseSchema } from "../src/contract/response";
const live = Bun.env.RUN_LIVE_TESTS === "1" ? test : test.skip;
live(
  "Anthropic real API mixed question E2E",
  async () => {
    const token = Bun.env.DECISIONS_API_TOKEN;
    if (!token || !Bun.env.ANTHROPIC_API_KEY)
      throw new Error("Live tests require configured credentials");
    const { app } = configure(Bun.env, new BunImageLoader());
    const response = await app.request("/v1/decisions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "My house is on fire. Need help now.",
              },
              { type: "input_image", image_url: png },
              { type: "input_json", data: { priority: "urgent" } },
            ],
          },
        ],
        questions: [predicate, choice, score],
      }),
    });
    expect(response.status).toBe(200);
    const result = responseSchema.parse(await response.json());
    expect(result.answers).toHaveLength(3);
    expect(result.usage.total_tokens).toBeGreaterThan(0);
  },
  120_000,
);
