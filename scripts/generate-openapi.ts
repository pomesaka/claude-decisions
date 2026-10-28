import { z } from "zod";
import { requestSchema } from "../src/contract/request";
import { responseSchema } from "../src/contract/response";
const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
});
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Claude Decisions",
    version: "0.1.0",
    description:
      "OpenAI Decisions wire format with optional ignored model and fixed Claude Haiku 5.5 inference. See README for semantic and runtime limits.",
  },
  paths: {
    "/v1/decisions": {
      post: {
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(requestSchema, { unrepresentable: "any" }),
            },
          },
        },
        responses: {
          "200": {
            description: "Decision answers",
            content: {
              "application/json": { schema: z.toJSONSchema(responseSchema) },
            },
          },
          "400": errorResponse("Invalid request"),
          "401": errorResponse("Invalid token"),
          "413": errorResponse("Body too large"),
          "429": errorResponse("Provider rate limit"),
          "500": errorResponse("Internal error"),
          "502": errorResponse("Provider failure"),
          "503": errorResponse("Configuration unavailable"),
          "504": errorResponse("Timeout"),
        },
      },
    },
  },
  components: {
    schemas: {
      Error: z.toJSONSchema(
        z.object({
          error: z.object({
            message: z.string(),
            type: z.string(),
            param: z.string().nullable(),
            code: z.string().nullable(),
          }),
        }),
      ),
    },
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
  },
};
await Bun.write(
  new URL("../openapi/decisions.openapi.json", import.meta.url),
  JSON.stringify(spec, null, 2) + "\n",
);
