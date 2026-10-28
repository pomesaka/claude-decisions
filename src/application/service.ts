import type { DecisionModel, ModelAnswer } from "../ports/model";
import type { DecisionRequest, Question } from "../contract/request";
import { responseSchema, type DecisionResponse } from "../contract/response";
import { invalidOutput } from "./errors";
export const emptyUsage = (): DecisionResponse["usage"] => ({
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
});
function probability(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1)
    throw invalidOutput();
  return value;
}
export function normalize(
  question: Question,
  result: ModelAnswer,
): DecisionResponse["answers"][number] {
  const name = question.name ?? null;
  if (result.refusal) {
    if (
      result.probability !== null ||
      result.weights !== null ||
      result.confidence !== null
    )
      throw invalidOutput();
    return { type: "refusal", name };
  }
  if (question.type === "predicate") {
    if (result.weights !== null || result.confidence !== null)
      throw invalidOutput();
    return {
      type: "predicate",
      name,
      probability: probability(result.probability),
    };
  }
  if (result.probability !== null) throw invalidOutput();
  const options =
    question.type === "choice" ? question.choices : question.levels;
  if (!result.weights || result.weights.length !== options.length)
    throw invalidOutput();
  const weights = result.weights.map(probability);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw invalidOutput();
  const distribution = weights.map((weight) => weight / sum);
  const confidence = probability(result.confidence);
  if (question.type === "score")
    return {
      type: "score",
      name,
      confidence,
      score: distribution.reduce((sum, p, index) => sum + index * p, 0),
      probabilities: question.levels.map((level, index) => ({
        label: level.label,
        value: index,
        probability: distribution[index] ?? 0,
      })),
    };
  // Stable first maximum preserves caller ordering when probabilities tie.
  let selected = 0;
  for (let index = 1; index < distribution.length; index++)
    if ((distribution[index] ?? 0) > (distribution[selected] ?? 0))
      selected = index;
  const choice = question.choices[selected];
  if (!choice) throw invalidOutput();
  return {
    type: "choice",
    name,
    choice: choice.value,
    confidence,
    probabilities: question.choices.map((choice, index) => ({
      value: choice.value,
      probability: distribution[index] ?? 0,
    })),
  };
}
export class DecisionService {
  constructor(
    private model: DecisionModel,
    private chunkSize = 20,
    private concurrency = 3,
  ) {
    if (
      !Number.isInteger(chunkSize) ||
      chunkSize < 1 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1
    )
      throw new Error("Invalid batch configuration");
  }
  async create(
    request: DecisionRequest,
    signal: AbortSignal,
  ): Promise<DecisionResponse> {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const chunks: { id: number; question: Question }[][] = [];
    // Bound estimated output size as well as question count (255-way choices are large).
    let current: { id: number; question: Question }[] = [],
      budget = 0;
    for (const [id, question] of request.questions.entries()) {
      const cost =
        question.type === "choice"
          ? question.choices.length
          : question.type === "score"
            ? question.levels.length
            : 1;
      if (
        current.length &&
        (current.length >= this.chunkSize || budget + cost > 600)
      ) {
        chunks.push(current);
        current = [];
        budget = 0;
      }
      current.push({ id, question });
      budget += cost;
    }
    if (current.length) chunks.push(current);
    const answers: DecisionResponse["answers"] = new Array(
      request.questions.length,
    );
    const usage = emptyUsage();
    let next = 0;
    const run = async () => {
      while (next < chunks.length) {
        combined.throwIfAborted();
        const chunk = chunks[next++];
        if (!chunk) return;
        const result = await this.model.evaluate(request, chunk, combined);
        if (result.answers.length !== chunk.length) throw invalidOutput();
        const byId = new Map(
          result.answers.map((answer) => [answer.id, answer]),
        );
        if (byId.size !== chunk.length) throw invalidOutput();
        for (const { id, question } of chunk) {
          const answer = byId.get(id);
          if (!answer) throw invalidOutput();
          answers[id] = normalize(question, answer);
        }
        usage.input_tokens += result.usage.input_tokens;
        usage.output_tokens += result.usage.output_tokens;
        usage.total_tokens += result.usage.total_tokens;
        usage.input_tokens_details.cached_tokens +=
          result.usage.input_tokens_details.cached_tokens;
        usage.input_tokens_details.cache_write_tokens +=
          result.usage.input_tokens_details.cache_write_tokens;
        usage.output_tokens_details.reasoning_tokens +=
          result.usage.output_tokens_details.reasoning_tokens;
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(this.concurrency, chunks.length) }, run),
      );
    } catch (error) {
      controller.abort();
      throw error;
    }
    return responseSchema.parse({ model: "claude-haiku-5-5", answers, usage });
  }
}
