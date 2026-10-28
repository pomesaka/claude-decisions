import { z } from "zod";
import {
  EnvCredentialStore,
  EnvTokenAuthenticator,
} from "../adapters/credentials";
import { AnthropicModel, AnthropicTransport } from "../adapters/anthropic";
import { DecisionService } from "../application/service";
import { createApp } from "../http/app";
import type { ImageLoader } from "../ports/model";
const configSchema = z
  .object({
    ANTHROPIC_API_KEY: z.string().min(1),
    DECISIONS_API_TOKEN: z.string().min(1),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    TRANSPORT: z.enum(["direct", "gateway"]).default("direct"),
    CF_ACCOUNT_ID: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    CF_GATEWAY_ID: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .optional(),
    CF_AIG_TOKEN: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.TRANSPORT === "gateway" &&
      (!value.CF_ACCOUNT_ID || !value.CF_GATEWAY_ID)
    )
      ctx.addIssue({
        code: "custom",
        message: "Gateway identifiers are required",
      });
  });
export function configure(
  values: Record<string, string | undefined>,
  images: ImageLoader,
) {
  const result = configSchema.safeParse(values);
  if (!result.success)
    throw new Error(
      "Missing or invalid server configuration. Check required environment variables.",
    );
  const config = result.data;
  const store = new EnvCredentialStore(values);
  const gateway = config.TRANSPORT === "gateway";
  const baseURL = gateway
    ? `https://gateway.ai.cloudflare.com/v1/${config.CF_ACCOUNT_ID}/${config.CF_GATEWAY_ID}/anthropic`
    : undefined;
  return {
    port: config.PORT,
    app: createApp(
      new DecisionService(
        new AnthropicModel(
          new AnthropicTransport(store, baseURL, gateway),
          images,
        ),
      ),
      new EnvTokenAuthenticator(store),
    ),
  };
}
