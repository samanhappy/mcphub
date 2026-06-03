# Definition Cost measures upfront registered definitions only

The Context Footprint feature counts only the token cost of definitions a client registers **upfront** (tool/prompt/resource definitions, or Smart Routing's Meta-tool definitions). A consequence: enabling **Progressive Disclosure** *raises* the reported Smart Routing Footprint, because it adds a third Meta-tool (`describe_tool`) to the upfront set. This is intentional and correct under our definition. Progressive Disclosure's actual benefit is **dynamic** — it shrinks each `search_tools` response by deferring tool schemas — and that per-search saving is deliberately out of scope, because modelling it would require speculative assumptions (results per search, sessions per task) that would make the headline numbers unfalsifiable.

## Consequences

A reader comparing the three numbers (Direct → Smart Routing → Smart Routing + PD) will see PD as slightly *more* expensive and may assume a bug. The PD row carries a tooltip explaining it adds a meta-tool for smaller per-search responses, and this ADR exists so the decision isn't silently "corrected" later. If a future version wants to show PD's dynamic win, it should add a **separate** modelled metric rather than fold assumptions into Definition Cost.
