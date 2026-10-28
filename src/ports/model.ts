import type { DecisionRequest, Question } from "../contract/request";
import type { DecisionResponse } from "../contract/response";
export interface CredentialStore {
  get(name: string): Promise<string | null>;
}
export interface TokenAuthenticator {
  authenticate(token: string): Promise<boolean>;
}
export interface ModelAnswer {
  refusal: boolean;
  probability: number | null;
  weights: number[] | null;
  confidence: number | null;
}
export interface ModelResult {
  answer: ModelAnswer;
  usage: DecisionResponse["usage"];
}
export interface DecisionModel {
  // One question per call: measured on Haiku 5.5 without thinking, batching questions let
  // neighboring questions leak into answers (feed answered as sleep, injected text obeyed).
  evaluate(
    request: DecisionRequest,
    question: Question,
    signal: AbortSignal,
  ): Promise<ModelResult>;
}
export type ImageData = {
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};
export interface ImageLoader {
  load(url: string, signal: AbortSignal): Promise<ImageData>;
}
