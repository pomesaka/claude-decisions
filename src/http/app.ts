import { Hono } from "hono";
import { requestSchema } from "../contract/request";
import { DecisionError } from "../application/errors";
import type { DecisionService } from "../application/service";
import type { TokenAuthenticator } from "../ports/model";
const MAX_BODY = 32 * 1024 * 1024;
async function readJSON(request: Request): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new DecisionError(
      400,
      "invalid_content_type",
      "Content-Type must be application/json.",
    );
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new DecisionError(
      413,
      "request_too_large",
      "Request exceeds the 32 MiB server limit.",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new DecisionError(400, "invalid_json", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw new DecisionError(
          413,
          "request_too_large",
          "Request exceeds the 32 MiB server limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DecisionError(
      400,
      "invalid_json",
      "Request body must contain valid JSON.",
    );
  }
}
export function createApp(service: DecisionService, auth: TokenAuthenticator) {
  const app = new Hono();
  let inFlight = 0;
  app.onError((error, c) => {
    const known =
      error instanceof DecisionError
        ? error
        : new DecisionError(
            500,
            "internal_error",
            "An internal error occurred.",
          );
    const type =
      known.status === 401
        ? "authentication_error"
        : known.status === 429
          ? "rate_limit_error"
          : known.status < 500
            ? "invalid_request_error"
            : "server_error";
    return c.json(
      {
        error: {
          message: known.message,
          type,
          param: known.param,
          code: known.code,
        },
      },
      known.status,
    );
  });
  app.notFound((c) =>
    c.json(
      {
        error: {
          message: "Unknown endpoint.",
          type: "invalid_request_error",
          param: null,
          code: "not_found",
        },
      },
      404,
    ),
  );
  app.post("/v1/decisions", async (c) => {
    const authorization = c.req.header("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1] || !(await auth.authenticate(match[1])))
      throw new DecisionError(401, "invalid_api_key", "Invalid API token.");
    if (inFlight >= 8)
      throw new DecisionError(
        429,
        "server_busy",
        "The server is handling too many simultaneous requests.",
      );
    inFlight++;
    try {
      const parsed = requestSchema.safeParse(await readJSON(c.req.raw));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        // Zod diagnostics may contain caller data; return only a field path.
        throw new DecisionError(
          400,
          "invalid_request",
          "Request does not match the Decisions schema.",
          issue?.path.map(String).join(".") || null,
        );
      }
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(120_000),
      ]);
      try {
        return c.json(await service.create(parsed.data, signal));
      } catch (error) {
        if (signal.aborted)
          throw new DecisionError(
            504,
            "request_timeout",
            "The decision request timed out.",
          );
        throw error;
      }
    } finally {
      inFlight--;
    }
  });
  return app;
}
