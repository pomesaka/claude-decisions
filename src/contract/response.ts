import { z } from "zod";
import type { Decision } from "openai/resources/decisions";
const probability = z.number().min(0).max(1);
const name = z.string().nullable();
export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("predicate"), name, probability }).strict(),
  z.object({ type: z.literal("refusal"), name }).strict(),
  z
    .object({
      type: z.literal("choice"),
      name,
      choice: z.union([z.string(), z.boolean()]),
      confidence: probability,
      probabilities: z.array(
        z
          .object({ value: z.union([z.string(), z.boolean()]), probability })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      type: z.literal("score"),
      name,
      score: z.number().finite(),
      confidence: probability,
      probabilities: z.array(
        z
          .object({
            label: z.string(),
            value: z.number().int().min(0),
            probability,
          })
          .strict(),
      ),
    })
    .strict(),
]);
const tokens = z.number().int().nonnegative();
export const responseSchema = z.object({
  model: z.string(),
  answers: z.array(answerSchema),
  usage: z.object({
    input_tokens: tokens,
    output_tokens: tokens,
    total_tokens: tokens,
    input_tokens_details: z.object({
      cached_tokens: tokens,
      cache_write_tokens: tokens,
    }),
    output_tokens_details: z.object({ reasoning_tokens: tokens }),
  }),
});
export type DecisionResponse = z.infer<typeof responseSchema>;
export const officialResponse = (response: DecisionResponse): Decision =>
  response;
export const localResponse = (response: Decision): DecisionResponse => response;
