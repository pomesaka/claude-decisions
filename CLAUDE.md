# Claude Decisions

- Use Bun for runtime, package management, scripts, and tests. Run `bun test`, `bun run typecheck`, `bun run format:check`, and `bun run worker:check` after relevant changes.
- Inference is fixed to `claude-haiku-5-5`. Public `model` is optional and ignored; the response identifies the actual model.
- Compare public contracts with the pinned OpenAI SDK types and official Decisions documentation. Preserve optional versus nullable fields and typed choice values.
- Keep application logic independent of Hono, environment variables, Anthropic SDK clients, Bun, and Workers APIs. Infrastructure belongs in adapters and entrypoints.
- Never log credentials, raw upstream failures, input content, or request headers. Do not enable SDK debug logs or telemetry.
- Preserve IP pinning, TLS hostname verification, per-redirect validation, byte limits, and deadlines for image fetches. Workers remote images currently fail closed; see README.
- Use table-driven tests for boundaries. Live provider tests require explicit `RUN_LIVE_TESTS=1` and credentials. Do not substitute mocks and report a live E2E pass.
- Generate OpenAPI with `bun run contract:generate` when contracts change. Runtime cross-field constraints also need tests.
