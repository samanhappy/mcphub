# Estimate Definition Cost with the cl100k_base tokenizer

For the Context Footprint feature we compute every item's Definition Cost using `gpt-tokenizer` (OpenAI's cl100k_base BPE), even though MCPHub mostly serves non-GPT clients (Claude, etc.) whose true token counts differ by ~10–20%. We chose it because it is synchronous, offline, deterministic, and already a dependency — unlike the embedding tokenizers in `tokenTruncation.ts`, whose HuggingFace backend downloads a model and whose Gemini backend needs an API key and a network round-trip, neither acceptable for rendering a page. The displayed number is therefore explicitly an **estimate**, labelled as such in the UI, and is meant for *relative* comparison (tool vs tool, Direct vs Smart Routing), not as an exact per-client bill.

## Considered Options

- **Per-model selector (GPT/Claude/Gemini)** — rejected for v1: no offline JS tokenizer for Claude/Gemini in the deps, so it means new dependencies or network calls.
- **Reuse the configured embedding tokenizer** — rejected: may force network/API-key use just to render the UI, and embedding tokenizers aren't chat tokenizers, so it's slower without being more honest.
- **Char-based heuristic** — rejected: visibly wrong for JSON-heavy schemas, undermines a feature whose whole point is token precision.
