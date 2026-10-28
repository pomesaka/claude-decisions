import { z } from "zod";
import type { DecisionCreateParams } from "openai/resources/decisions";

const short = z.string().max(1_048_576);
const text = z.string().max(10_485_760);
const breakpoint = z
  .object({ mode: z.literal("explicit") })
  .strict()
  .nullish();
const inputText = z
  .object({
    type: z.literal("input_text"),
    text,
    prompt_cache_breakpoint: breakpoint,
  })
  .strict();
const questionText = inputText.omit({ prompt_cache_breakpoint: true });
const image = z
  .object({
    type: z.literal("input_image"),
    image_url: z.string().max(1_073_741_824),
    detail: z.enum(["low", "high", "auto", "original"]).nullish(),
    prompt_cache_breakpoint: breakpoint,
  })
  .strict();
const jsonObject = z.record(z.string(), z.unknown());
const jsonPart = z
  .object({
    type: z.literal("input_json"),
    data: z.union([jsonObject, z.array(jsonObject)]),
  })
  .strict()
  .superRefine(({ data }, ctx) => {
    let count = 0;
    const visit = (value: unknown, depth: number): boolean => {
      if (++count > 10_000) return false;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        return true;
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value !== "object") return false;
      if (depth > 32) return false;
      return Object.values(value).every((child) => visit(child, depth + 1));
    };
    if (
      !visit(data, 1) ||
      new TextEncoder().encode(JSON.stringify(data)).length > 262_144
    )
      ctx.addIssue({
        code: "custom",
        message: "JSON exceeds the depth, value count, or UTF-8 size limit",
      });
  });
const userParts = z.array(z.union([inputText, image, jsonPart]));
const plainContent = z.union([text, z.array(inputText)]);
const messageType = z.literal("message").optional();
const toolBase = {
  call_id: z.string().min(1).max(64),
  id: short.nullish(),
  status: z.enum(["in_progress", "completed", "incomplete"]).nullish(),
};
const callBase = {
  ...toolBase,
  namespace: z.string().min(1).max(64).nullish(),
};
const toolOutput = z.union([text, z.array(z.union([inputText, image]))]);
const inputItem = z.union([
  z
    .object({
      role: z.literal("user"),
      type: messageType,
      content: z.union([text, userParts]),
    })
    .strict(),
  z
    .object({
      role: z.literal("developer"),
      type: messageType,
      content: plainContent,
    })
    .strict(),
  z
    .object({
      role: z.literal("system"),
      type: messageType,
      content: plainContent,
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      type: messageType,
      phase: z.enum(["commentary", "final_answer"]).nullish(),
      content: z.union([
        text,
        z.array(
          z.union([
            z.object({ type: z.literal("output_text"), text }).strict(),
            z.object({ type: z.literal("refusal"), refusal: text }).strict(),
          ]),
        ),
      ]),
    })
    .strict(),
  z
    .object({
      ...callBase,
      type: z.literal("function_call"),
      name: z.string().min(1).max(128),
      arguments: short,
    })
    .strict(),
  z
    .object({
      ...callBase,
      type: z.literal("custom_tool_call"),
      name: z.string().min(1).max(64),
      input: short,
    })
    .strict(),
  z
    .object({
      ...toolBase,
      type: z.literal("function_call_output"),
      output: toolOutput,
    })
    .strict(),
  z
    .object({
      ...toolBase,
      type: z.literal("custom_tool_call_output"),
      output: toolOutput,
    })
    .strict(),
]);
const instructions = z.union([
  text,
  z.array(
    z.union([
      questionText,
      image.omit({ prompt_cache_breakpoint: true }),
      jsonPart,
    ]),
  ),
]);
const base = { name: short.optional(), instructions };
export const questionSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("predicate") }).strict(),
  z
    .object({
      ...base,
      type: z.literal("choice"),
      choices: z
        .array(
          z
            .object({
              value: z.union([z.string(), z.boolean()]),
              description: short.optional(),
            })
            .strict(),
        )
        .min(2)
        .max(255)
        .refine(
          (items) =>
            new Set(items.map((item) => JSON.stringify(item.value))).size ===
            items.length,
          "Choices must be unique",
        ),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("score"),
      levels: z
        .array(
          z.object({ label: short, description: short.optional() }).strict(),
        )
        .min(2)
        .max(10),
    })
    .strict(),
]);
export const requestSchema = z
  .object({
    input: z.union([text, z.array(inputItem)]),
    model: short.optional(),
    questions: z.array(questionSchema).min(1).max(400),
    prompt_cache_key: z.string().max(64).nullish(),
    prompt_cache_options: z
      .object({
        mode: z.enum(["implicit", "explicit"]).nullish(),
        ttl: z.literal("30m").optional(),
      })
      .strict()
      .nullish(),
    safety_identifier: z.string().max(128).nullish(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (typeof request.input === "string") return;
    const calls = new Map<string, string>();
    for (const [index, item] of request.input.entries()) {
      if (item.type === "function_call" || item.type === "custom_tool_call") {
        if (calls.has(item.call_id))
          ctx.addIssue({
            code: "custom",
            path: ["input", index, "call_id"],
            message: "Duplicate call ID",
          });
        calls.set(item.call_id, item.type);
      } else if (
        item.type === "function_call_output" ||
        item.type === "custom_tool_call_output"
      ) {
        if (calls.get(item.call_id) !== item.type.replace("_output", ""))
          ctx.addIssue({
            code: "custom",
            path: ["input", index, "call_id"],
            message: "Output must follow a matching tool call",
          });
      }
    }
  });
export type DecisionRequest = z.infer<typeof requestSchema>;
export type Question = z.infer<typeof questionSchema>;
// SDK JSON values are typed unknown; validate these at the public boundary.
export const fromOfficial = (request: DecisionCreateParams): DecisionRequest =>
  requestSchema.parse(request);
export const toOfficial = (request: DecisionRequest): DecisionCreateParams => ({
  ...request,
  model: request.model ?? "claude-haiku-5-5",
});
