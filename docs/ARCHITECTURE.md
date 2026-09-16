# AI Teacher V0.2 Architecture

The platform owns deterministic persistence and UI; model inference belongs to an external Codex/DSH host. The canonical document is a product reference, not runtime authority.

## Flow

Web writes messages and jobs to SQLite atomically. A host claims a job through stdio or authenticated Streamable HTTP MCP, receiving the relevant goal, prompt, active notes, evidence and V0.2 learning context. Leases last three minutes and can be renewed. Generic replies use teacher_reply; structured assessment questions use teacher_assessment_question and finish uses teacher_finish_assessment. Web refetches on SSE changes. Only explicit writeback is visible, not arbitrary host chat or internal reasoning.

Assessment state: WAITING_HOST → WAITING_ANSWER → WAITING_HOST, then COMPLETED or ENDED_EARLY. Each question binds requirements; answers and feedback are retained. Finish requires answered rounds with feedback and atomically saves evidence, profile changes, gaps and readiness judgments. Early ending never produces mastery evidence. Formal round feedback stays hidden in the Web results endpoint until ending, except QUICK_CHECK.

## Learning model

Capability sets are versioned proposals. User acceptance creates readiness items (Core/Supporting) and node-linked requirements. Replacing a set retains history and invalidates pending old routes. Node identity is minimal, not a full cross-goal knowledge tree.

Material bodies are immutable text versions with scope/hash and separate host analysis records. Selected assessment resources bind exact content versions. Primary materials must have an analyzed body before route generation. This is scoped text ingestion, not automatic file parsing or retrieval.

Roadmap proposals store phases, topics, requirements, resources, dependency keys and sessions. Coverage and dependency cycles are validated. Confirmation creates sessions and retires only unstarted prior sessions. Dependencies currently guide the plan rather than locking execution order.

Gaps link requirements and evidence, can be routed/ignored, and need new supporting evidence to resolve. Reviews have explicit dates; no automatic interval algorithm or daemon. Final completion is conservative: current-set FINAL evidence, every Core requirement supported, no unresolved Core gap and no later evidence or running assessment. User completion/abandonment writes a frozen snapshot. Completed goals allow reviews; abandoned goals stop learning. Neither reopens.

## Persistence and boundaries

SQLite WAL with foreign keys. Schema v2 migrates in a transaction after VACUUM INTO creates a consistent backup. Old rows are retained. The server never seeds demonstration records into the production database. Full backup means the database with its current WAL state, or stopping the service then copying data; the UI export is not a full backup.

HTTP binds 127.0.0.1. Host/Origin checks, HttpOnly SameSite Web session cookie and separate Agent Bearer credential enforce local API roles. User-only actions include proposal confirmation, starting/ending assessments, choosing resources, editing notes/prompts and ending goals. Archived notes are excluded from Teacher context. This is a trusted local single-user application, not a sandbox against a malicious local process.

The server validates structure and provenance, not pedagogical truth. A host can still make a poor judgment. Specialized assessment kinds use a shared state machine. No PDF/OCR parser, full knowledge restructuring, complex cross-goal conflict handling, auto-triggered note verification, rolling review engine, token streaming or unattended host lifecycle is claimed.

## Compatibility

V0.1 conversations remain supported by legacy tools. Structured assessment chats cannot use generic reply or legacy evidence tools to bypass their state machine. The stdio adapter loads the current workspace tools. Installed skill changes require a fresh host task after plugin reinstall. DSH configuration is supplied; real DSH inference has not been validated on this machine.

# V0.3 extension: model routing

The user subsequently authorized direct API execution with different models per task. model-config.mjs stores profiles/routes and encrypted keys; model-executor.mjs is an optional execution layer next to the deterministic service. It calls OpenAI-compatible Chat Completions with scoped function tools and commits through the existing validated business methods. No user-confirmation tool is exposed to a model.

Routing is explicit: Web assigns a module to messages, assessment types infer a module, and each job freezes its HOST/API choice plus profile ID when first queued. Route edits affect new jobs only. Profile edits affect the next attempt; a running attempt holds its configuration snapshot. HOST claim skips API jobs, and one conversation keeps FIFO order, including failed waiting work. API failures block automatic repetition until the user retries, cancels or hands the task back to a host.

The worker performs at most 12 requests per attempt, with a configurable 5–180 second request timeout. It renews leases and rechecks cancellation/pause before every write. The trace is checkpointed around tool execution, with stable per-run request IDs for recovery of partial work. On process restart, interrupted API runs require explicit retry; completed jobs are not rerun. Raw provider error bodies and reasoning extensions are not retained. Plain chat completion is saved as a Web reply; structured assessment requires validated question/feedback/finish tools.

Connection profiles include Base URL, model ID and optional output parameters. HTTP is allowed only on loopback; remote endpoints require HTTPS. Credential-bearing URLs and redirects are rejected. AES-256-GCM encrypts keys in SQLite using data/model-vault.key. This prevents plaintext database/export leakage; it is not protection against a local actor who can read both the database and master key. Full backups must protect both files. API settings, encrypted keys and internal traces are excluded from learning exports and host context.

The first adapter uses Chat Completions/function tools only. Native Anthropic Messages, OpenAI Responses, provider reasoning extensions, model-list discovery, cost conversion, automatic fallback and token streaming are not included. Actual service compatibility and pedagogical quality still require a real configured model.
