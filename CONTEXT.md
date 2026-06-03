# MCPHub

Domain glossary for MCPHub — a hub that aggregates multiple MCP servers behind a single HTTP/SSE surface. This file is the canonical source for project-specific vocabulary; use these terms (and avoid the listed synonyms) in code, issues, and UI copy.

## Language

**Definition Cost**:
The number of tokens a single exposed item (a Tool, Prompt, or Resource) adds to a model's context window when its definition is listed to that model. For a tool, measured over its name, description, and complete input schema; for prompts and resources, over their listed definition fields. An estimate, not a billed figure, because the true count depends on the consuming client's model and framing. A tool's Definition Cost is dominated by its input schema.
_Avoid_: token size, tool weight, context usage

**Context Footprint**:
The total Definition Cost a Server or Group imposes on a connecting client, reported as a pair of co-equal numbers: its Exposed Footprint and its Gross Footprint. This is what the cost feature surfaces per Server and per Group.
_Avoid_: total cost, total size, token total

**Exposed Footprint**:
The Context Footprint counting only the items a client actually receives — for a Server, its enabled items; for a Group, the items each member server has selected into that group (and enabled). The number you actually pay.
_Avoid_: effective cost, net cost

**Gross Footprint**:
The Context Footprint counting every item a Server reports, ignoring enabled/selection state — the maximum potential cost. For a Group, the sum of its member servers' Gross Footprints. Shown alongside Exposed Footprint so the savings from curation are visible.
_Avoid_: total cost, raw cost, full cost

**Connection Mode**:
How a client consumes a Group or all-servers scope, which determines what definitions it registers: **Direct** (registers every exposed item's definition — costs the Exposed Footprint) or **Smart Routing** (registers only Meta-tools — costs the Smart Routing Footprint). The cost feature reports a number per applicable mode.
_Avoid_: routing type, access mode

**Meta-tool**:
One of the fixed scaffolding tools Smart Routing registers in place of the underlying tools: `search_tools` and `call_tool` always, plus `describe_tool` under Progressive Disclosure. A Meta-tool's definition is not constant — its description embeds the in-scope server names and group name, so its Definition Cost varies slightly by scope.
_Avoid_: virtual tool, proxy tool, system tool

**Smart Routing Footprint**:
The Context Footprint of a scope under Smart Routing — the summed Definition Cost of its Meta-tool set (two Meta-tools normally, three under Progressive Disclosure) as constructed for that scope. Far smaller than the Direct/Exposed Footprint; this contrast is the feature's headline value.
_Avoid_: smart cost, routing cost

**Progressive Disclosure**:
A global Smart Routing mode that adds the `describe_tool` Meta-tool and keeps tool schemas out of search results, fetching them on demand. It raises the upfront Smart Routing Footprint by one Meta-tool while shrinking each search response — a trade this feature measures only on the upfront (definition) side.
_Avoid_: lazy disclosure, deferred schema, PD (in UI copy)
