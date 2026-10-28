export class DecisionError extends Error {
  constructor(
    public readonly status: 400 | 401 | 413 | 429 | 500 | 502 | 503 | 504,
    public readonly code: string,
    message: string,
    public readonly param: string | null = null,
  ) {
    super(message);
  }
}
export const invalidOutput = () =>
  new DecisionError(
    502,
    "invalid_model_response",
    "The inference provider returned an invalid result.",
  );
