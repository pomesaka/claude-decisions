import { describe, test, expect } from "bun:test";
import { requestSchema, toOfficial } from "../src/contract/request";
import { fullRequest, predicate, choice, score } from "./fixtures";
const valid = { input: "evidence", questions: [predicate] };
describe("public request contract", () => {
  test.each([
    ["minimal", valid],
    ["all SDK input variants", fullRequest],
    [
      "400 questions",
      { ...valid, questions: Array.from({ length: 400 }, () => predicate) },
    ],
    ["typed choices", { ...valid, questions: [choice, score] }],
    [
      "null cache fields",
      { ...valid, prompt_cache_key: null, prompt_cache_options: null },
    ],
    [
      "empty strings",
      {
        ...valid,
        input: "",
        questions: [{ ...predicate, name: "", instructions: "" }],
      },
    ],
  ])("accepts %s", (_name, body) =>
    expect(requestSchema.safeParse(body).success).toBe(true),
  );
  test.each([
    ["zero questions", { ...valid, questions: [] }],
    [
      "401 questions",
      { ...valid, questions: Array.from({ length: 401 }, () => predicate) },
    ],
    ["null name", { ...valid, questions: [{ ...predicate, name: null }] }],
    ["unknown field", { ...valid, extra: true }],
    [
      "duplicate choice",
      {
        ...valid,
        questions: [{ ...choice, choices: [{ value: true }, { value: true }] }],
      },
    ],
    [
      "one choice",
      { ...valid, questions: [{ ...choice, choices: [{ value: "only" }] }] },
    ],
    [
      "eleven score levels",
      {
        ...valid,
        questions: [
          {
            ...score,
            levels: Array.from({ length: 11 }, () => ({ label: "x" })),
          },
        ],
      },
    ],
    [
      "JSON in system role",
      {
        ...valid,
        input: [
          { role: "system", content: [{ type: "input_json", data: { a: 1 } }] },
        ],
      },
    ],
    [
      "assistant input_text",
      {
        ...valid,
        input: [
          { role: "assistant", content: [{ type: "input_text", text: "x" }] },
        ],
      },
    ],
    [
      "orphan output",
      {
        ...valid,
        input: [{ type: "function_call_output", call_id: "a", output: "x" }],
      },
    ],
    [
      "wrong call type",
      {
        ...valid,
        input: [
          { type: "custom_tool_call", call_id: "a", name: "x", input: "x" },
          { type: "function_call_output", call_id: "a", output: "x" },
        ],
      },
    ],
    [
      "duplicate call",
      {
        ...valid,
        input: [
          { type: "custom_tool_call", call_id: "a", name: "x", input: "x" },
          { type: "custom_tool_call", call_id: "a", name: "x", input: "x" },
        ],
      },
    ],
    [
      "JSON primitive",
      {
        ...valid,
        input: [{ role: "user", content: [{ type: "input_json", data: 1 }] }],
      },
    ],
    [
      "JSON array of primitives",
      {
        ...valid,
        input: [
          { role: "user", content: [{ type: "input_json", data: [1, 2] }] },
        ],
      },
    ],
    [
      "JSON size",
      {
        ...valid,
        input: [
          {
            role: "user",
            content: [{ type: "input_json", data: { x: "a".repeat(262144) } }],
          },
        ],
      },
    ],
    [
      "JSON count",
      {
        ...valid,
        input: [
          {
            role: "user",
            content: [
              { type: "input_json", data: { x: Array(10000).fill(0) } },
            ],
          },
        ],
      },
    ],
    ["cache key limit", { ...valid, prompt_cache_key: "x".repeat(65) }],
    ["cache ttl", { ...valid, prompt_cache_options: { ttl: "5m" } }],
    [
      "question cache marker",
      {
        ...valid,
        questions: [
          {
            ...predicate,
            instructions: [
              {
                type: "input_text",
                text: "x",
                prompt_cache_breakpoint: { mode: "explicit" },
              },
            ],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, body) =>
    expect(requestSchema.safeParse(body).success).toBe(false),
  );
  test("JSON depth boundary", () => {
    let data: Record<string, unknown> = { x: 1 };
    for (let i = 1; i < 32; i++) data = { x: data };
    const body = (data: unknown) => ({
      ...valid,
      input: [{ role: "user", content: [{ type: "input_json", data }] }],
    });
    expect(requestSchema.safeParse(body(data)).success).toBe(true);
    expect(requestSchema.safeParse(body({ x: data })).success).toBe(false);
  });
  test("SDK request roundtrip", () =>
    expect(toOfficial(requestSchema.parse(fullRequest))).toEqual(fullRequest));
});
