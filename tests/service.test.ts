import { test, expect } from "bun:test";
import {
  normalize,
  DecisionService,
  emptyUsage,
} from "../src/application/service";
import { requestSchema } from "../src/contract/request";
import type { DecisionModel, ModelAnswer } from "../src/ports/model";
import { predicate, choice, score } from "./fixtures";
const output: ModelAnswer = {
  id: 0,
  refusal: false,
  probability: null,
  weights: [0.2, 0.3, 0.5],
  confidence: 0.6,
};
test("typed choice and independent confidence", () =>
  expect(normalize(choice, output)).toEqual({
    type: "choice",
    name: null,
    choice: false,
    confidence: 0.6,
    probabilities: [
      { value: true, probability: 0.2 },
      { value: "true", probability: 0.3 },
      { value: false, probability: 0.5 },
    ],
  }));
test("score is unrounded expected index", () => {
  const result = normalize(score, output);
  expect(result.type).toBe("score");
  if (result.type === "score") expect(result.score).toBeCloseTo(1.3);
});
test("normalizes positive weights and stable ties", () => {
  const result = normalize(choice, { ...output, weights: [1, 1, 1] });
  expect(result.type).toBe("choice");
  if (result.type === "choice") {
    expect(result.choice).toBe(true);
    expect(
      result.probabilities.reduce((s, p) => s + p.probability, 0),
    ).toBeCloseTo(1);
  }
});
test.each([NaN, Infinity, -0.1, 1.1])(
  "rejects invalid probability %s",
  (value) =>
    expect(() =>
      normalize(predicate, {
        ...output,
        probability: value,
        weights: null,
        confidence: null,
      }),
    ).toThrow(),
);
test.each([
  { weights: [0, 0, 0] },
  { weights: [1, 0] },
  { weights: [-1, 1, 1] },
  { weights: [Infinity, 1, 1] },
])("rejects invalid weights %j", ({ weights }) =>
  expect(() =>
    normalize(choice, { ...output, weights: [...weights] }),
  ).toThrow(),
);
test("refusal is question local", () =>
  expect(
    normalize(predicate, {
      id: 0,
      refusal: true,
      probability: null,
      weights: null,
      confidence: null,
    }),
  ).toEqual({ type: "refusal", name: null }));
test("rejects contradictory refusal", () =>
  expect(() => normalize(predicate, { ...output, refusal: true })).toThrow());
test("400 questions retain order, aggregate usage, and cap concurrency", async () => {
  let active = 0,
    maxActive = 0,
    calls = 0;
  const model: DecisionModel = {
    async evaluate(_request, questions) {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep((questions[0]?.id ?? 0) % 3);
      active--;
      return {
        answers: questions.toReversed().map(({ id }) => ({
          id,
          refusal: id === 17,
          probability: id === 17 ? null : id / 400,
          weights: null,
          confidence: null,
        })),
        usage: { ...emptyUsage(), input_tokens: 10, total_tokens: 10 },
      };
    },
  };
  const request = requestSchema.parse({
    input: "evidence",
    questions: Array.from({ length: 400 }, (_, i) => ({
      ...predicate,
      name: String(i),
    })),
  });
  const result = await new DecisionService(model).create(
    request,
    new AbortController().signal,
  );
  expect(result.answers).toHaveLength(400);
  expect(result.answers.map((a) => a.name)).toEqual(
    request.questions.map((q) => q.name ?? null),
  );
  expect(result.answers[17]?.type).toBe("refusal");
  expect(maxActive).toBeLessThanOrEqual(3);
  expect(calls).toBe(20);
  expect(result.usage.total_tokens).toBe(200);
});
test.each(["duplicate", "missing", "wrong"])(
  "rejects %s model ids",
  async (kind) => {
    const model: DecisionModel = {
      async evaluate() {
        return {
          answers:
            kind === "missing"
              ? []
              : [
                  {
                    id: kind === "wrong" ? 42 : 0,
                    refusal: true,
                    probability: null,
                    weights: null,
                    confidence: null,
                  },
                  ...(kind === "duplicate"
                    ? [
                        {
                          id: 0,
                          refusal: true,
                          probability: null,
                          weights: null,
                          confidence: null,
                        },
                      ]
                    : []),
                ],
          usage: emptyUsage(),
        };
      },
    };
    await expect(
      new DecisionService(model).create(
        requestSchema.parse({ input: "x", questions: [predicate] }),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  },
);
