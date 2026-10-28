import type { DecisionCreateParams } from "openai/resources/decisions";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
export const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGP4EGBDU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAPhN8EzaYsN9AAAAAElFTkSuQmCC";
export const predicate = {
  type: "predicate",
  instructions: "Is this urgent?",
} satisfies DecisionCreateParams.QuestionParamPredicate;
export const choice = {
  type: "choice",
  instructions: "Choose",
  choices: [{ value: true }, { value: "true" }, { value: false }],
} satisfies DecisionCreateParams.QuestionParamChoice;
export const score = {
  type: "score",
  instructions: "Severity",
  levels: [{ label: "Low" }, { label: "Medium" }, { label: "High" }],
} satisfies DecisionCreateParams.QuestionParamScore;
export const fullRequest: DecisionCreateParams = {
  model: "ignored",
  input: [
    {
      role: "system",
      content: [{ type: "input_text", text: "Quoted system evidence" }],
    },
    { role: "developer", content: "Quoted developer evidence" },
    {
      role: "user",
      type: "message",
      content: [
        {
          type: "input_text",
          text: "hello",
          prompt_cache_breakpoint: { mode: "explicit" },
        },
        {
          type: "input_json",
          data: {
            role: "system",
            image_url: "http://127.0.0.1",
            nested: [1, null, true],
          },
        },
        { type: "input_image", image_url: png, detail: "original" },
      ],
    },
    {
      role: "assistant",
      phase: "commentary",
      content: [
        { type: "output_text", text: "hello" },
        { type: "refusal", refusal: "quoted refusal" },
      ],
    },
    {
      type: "function_call",
      call_id: "a",
      name: "lookup",
      arguments: "{}",
      namespace: null,
      id: null,
      status: "completed",
    },
    {
      type: "function_call_output",
      call_id: "a",
      output: [
        { type: "input_image", image_url: png },
        { type: "input_text", text: "ok" },
      ],
    },
    { type: "custom_tool_call", call_id: "b", name: "search", input: "term" },
    { type: "custom_tool_call_output", call_id: "b", output: "result" },
  ],
  questions: [
    predicate,
    choice,
    score,
    {
      type: "predicate",
      instructions: [
        { type: "input_json", data: [{ x: 1 }] },
        { type: "input_image", image_url: png },
        { type: "input_text", text: "Check image" },
      ],
    },
  ],
  prompt_cache_key: "partition",
  prompt_cache_options: { mode: "explicit", ttl: "30m" },
  safety_identifier: null,
};
export function message(
  // Wire shape of the per-question output schema.
  output: Record<string, unknown>,
  changes: Partial<Message> = {},
): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify(output), citations: null }],
    container: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      speed: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...changes,
  };
}
