# Kaizen

A continuous-improvement memory layer for GitHub Copilot CLI. It observes tool usage during sessions, accumulates learnings in a database, and injects them as context in future sessions so the agent improves over time.

## Language

**Entry**:
A recorded observation about the project — a mistake, pattern, convention, or memory. Stored in `kaizen_entries`, keyed by `(project_path, category, content)`.
_Avoid_: learning, insight, note, observation

**Category**:
The type of an **Entry**: `mistake`, `pattern`, `convention`, or `memory`.
_Avoid_: type, kind, tag

**Hit Count**:
How many times an **Entry** has been independently observed. Entries with higher hit counts surface more prominently and resist **Decay**.
_Avoid_: frequency, occurrence count

**Crystallization**:
Promotion of an **Entry** to long-term memory after its **Hit Count** crosses a threshold. Crystallized entries are never pruned by **Decay**.
_Avoid_: promotion, locking, pinning

**Decay**:
Automatic pruning of stale **Entries** (low hit count, never applied, older than 60 days) and old **Tool Logs** (older than 7 days). Runs at session shutdown.
_Avoid_: cleanup, garbage collection, expiration

**Applied**:
An **Entry** that the agent has acted on and explicitly marked via `kaizen mark <id>`. Applied entries resist **Decay** and rank higher in future sessions.
_Avoid_: used, consumed, acknowledged

**Synthesis**:
The process of reading top **Entries** from the database and writing them into `<!-- kaizen:auto -->` blocks inside `.kaizen/*.md` files. Runs at session shutdown.
_Avoid_: generation, compilation, rebuild

**Auto-block**:
A region inside a `.kaizen/*.md` file delimited by `<!-- kaizen:auto -->` / `<!-- /kaizen:auto -->` markers. Content inside is overwritten by **Synthesis**. Content outside is human-authored and never touched.
_Avoid_: generated section, managed block

**Injection**:
Inserting assembled `.kaizen/` content into the LLM's context via the SDK's `additionalContext` field. Happens once per tool per session (deduplicated by an in-memory guard).
_Avoid_: context loading, prepending

**Kaizen Directory** (`.kaizen/`):
Per-project directory containing markdown files that hold synthesized learnings. Its presence signals opt-in: **Injection** only happens when `.kaizen/` exists. Database writes happen regardless.
_Avoid_: config directory, memory folder

**Tool Log**:
A timestamped record of a single tool invocation event (`pre`, `post:success`, `post:failure`). Stored in `kaizen_tool_log`, used for failure summaries and session statistics.
_Avoid_: event log, usage record

**Session**:
A Copilot CLI session from start to shutdown. Tracked in `kaizen_sessions` with tool counts, failure counts, and error counts. The session ID comes from the SDK's `StartData`.
_Avoid_: conversation, interaction, run

**Trampoline**:
A one-liner `extension.mjs` at `~/.copilot/extensions/kaizen/` that re-imports the real extension from the globally installed package. Exists to solve native dependency resolution (see ADR-0002).
_Avoid_: shim, proxy, loader

## Relationships

- A **Session** produces zero or more **Tool Logs**
- A **Session** may trigger **Synthesis** and **Decay** at shutdown
- **Synthesis** reads top **Entries** and writes **Auto-blocks** into the **Kaizen Directory**
- **Injection** reads the **Kaizen Directory** and returns `additionalContext` to the SDK
- An **Entry** accumulates **Hit Count** over multiple sessions
- An **Entry** may be **Crystallized** (automatic, by threshold) or **Applied** (explicit, by the agent)
- **Decay** removes **Entries** that are not **Crystallized** and not **Applied**

## Example dialogue

> **Dev:** "The agent keeps forgetting to use `--no-pager` with git. Will kaizen fix that?"
> **Domain expert:** "When the agent makes that mistake, an **Entry** with category `mistake` is recorded. Each recurrence bumps the **Hit Count**. Once it crosses the threshold, it gets **Crystallized** — meaning **Synthesis** writes it into an **Auto-block** in `.kaizen/general.md`. Next session, **Injection** feeds it back to the agent as context."

> **Dev:** "What if I manually teach it a convention?"
> **Domain expert:** "Use `kaizen add convention "always use pino"`. That creates an **Entry** immediately. You can also **Apply** existing entries with `kaizen mark <id>` to boost their ranking."

## Flagged ambiguities

- **"hook"** was used to mean three different things: command hooks (hooks.json — removed per ADR-0001), SDK extension hooks (`joinSession({ hooks })`), and the general concept. In this codebase, "hook" now refers exclusively to SDK extension hooks.
- **"memory"** is both a general concept ("kaizen's memory layer") and a specific **Category** value (`memory`). When referring to the category, always use "memory entry" or the category name in backticks. When referring to the system, say "kaizen memory" or "memory layer".
- **"context"** is overloaded: "kaizen context" means the assembled text for **Injection**; "working directory context" means the `StartData.context` from the SDK. Prefer "injected context" vs "session context" to disambiguate.
