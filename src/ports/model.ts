import type { DecisionRequest, Question } from "../contract/request";
import type { DecisionResponse } from "../contract/response";
export interface CredentialStore {
  get(name: string): Promise<string | null>;
}
export interface TokenAuthenticator {
  authenticate(token: string): Promise<boolean>;
}
export interface ModelAnswer {
  id: number;
  refusal: boolean;
  probability: number | null;
  weights: number[] | null;
  confidence: number | null;
}
export interface ModelResult {
  answers: ModelAnswer[];
  usage: DecisionResponse["usage"];
}
export interface DecisionModel {
  evaluate(
    request: DecisionRequest,
    questions: { id: number; question: Question }[],
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
