# V0.3 verification — 2026-09-16

- 22/22 Node tests passed. Includes V0.2 regression, standard MCP stdio/HTTP, encrypted/redacted credentials, restart persistence, API-only job ownership, distinct model routing, scoped material read/analysis, capability and route proposals, question/answer/feedback/evidence, explicit retry, cancellation, FIFO and host handoff.
- JavaScript syntax and required assets verified; OpenAPI regenerated with model settings and task routing fields.
- Browser QA used an isolated database on port 4318 and a deterministic mock Chat Completions endpoint on 4319. Added a connection, tested it, selected it for chat, enabled execution, sent a Web message and verified the returned mock model name/text and token usage in the Web records. No real provider credentials or paid model requests were used.
- Production service is V0.3.0 on 127.0.0.1:4317. Model profiles remain empty; API execution remains disabled pending user configuration. Pre-routing database backup created under data/backups. No mock configuration was copied into production.
- AI Teacher personal plugin updated to 0.3.0+codex.20260915171352; manifest and skill validation passed. Existing 15 MCP tools retained; hosts only claim HOST tasks.
- Native non-Chat-Completions protocols, service-specific reasoning extensions and actual teaching/model quality have not been validated. Local fixtures were stopped after verification.
