# Bound positive modern list TTLs by discovery age and gateway projection

Status: design agreed with the operator; implementation submitted for review (#1271).

## Decision

A positive list TTL is a bounded permission to reuse a private projection, not
an authorization lease. MCPHub may advertise at most **5,000 ms**, and only when
all upstream dependencies have independently established freshness. The operator
accepted this maximum list-staleness window. Calls and resource access continue
to authorize each request; a cached list must never authorize execution.

A configuration or permission change can take effect immediately on subsequent
requests, but cannot retract lists already stored by clients. Clients must keep
caches separate by endpoint, authenticated identity and per-request capabilities.
A credential, route, user or capability change requires a new projection. Do not
claim that server-side invalidation clears an external client's cached list.

Do not add a gateway response cache to implement freshness hints.

## Upstream freshness provenance

For each discovery result retain its normalized list and a monotonic expiry:

`expiry = requestStartedAt + validUpstreamTtlMs`

Capture time before the upstream request, bypass the SDK response cache, and
retain only finite, nonnegative safe-integer TTLs. TTL zero, a missing/invalid TTL,
a failed/incomplete discovery, or unknown SDK cache provenance cannot establish
positive freshness. Do not restart the deadline when projecting a list, applying
filters, or receiving an array-only list-change callback. A callback without the
original envelope invalidates that list's freshness until a fresh envelope is
obtained. Empty upstream lists are dependencies too: their absence of entries is
not evidence that the upstream will stay empty.

Associate provenance with the actual snapshot/runtime, not a reusable server
name. Reconnect, replacement, principal runtime creation, refresh, on-demand wake
and shutdown must discard old provenance. Every discovery path needs coverage;
uninstrumented paths remain zero rather than inventing timestamps.

## Projection rules

For a response finished at monotonic time `now`, advertise:

`max(0, floor(min(5000 - projectionElapsed, ...dependencyExpiries - now)))`

The projection's 5-second budget starts before reading gateway configuration and
authorization inputs. A slow projection consumes that budget. Use the earliest
expiry of every participating upstream, including empty or selected-but-filtered
lists. An unknown participant makes the result zero. Never substitute the longest
upstream TTL, average TTL, or the number of returned entries.

Rebuild gateway filtering on every request. Check the relevant configuration and
runtime inputs are unchanged across asynchronous projection; a change during the
build forces zero. Later requests project the latest configuration and permissions
rather than reusing old projected results. Upstream discovery need not be renewed
merely because a local description or selection changes, but its original expiry
must remain unchanged. Caller-dependent results always use `cacheScope: "private"`.

| Method                     | Upstream dependency                                                                          | Gateway dependency / conservative fallback                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/list`               | Each participating runtime's tool discovery snapshot                                         | Live server/group selections, aliases/descriptions, enabled flags, permissions and Apps capability projection. Smart Routing Meta-tools and other gateway-generated entries use zero until their own dependency provenance is tracked. |
| `prompts/list`             | Each participating runtime's prompt discovery snapshot                                       | Live selections and descriptions, permissions, built-in prompts. Any included built-in prompt without established freshness forces zero.                                                                                               |
| `resources/list`           | Each participating runtime's resource discovery snapshot                                     | Live selections, permissions, Apps metadata and built-in resources. Any included built-in resource without established freshness forces zero.                                                                                          |
| `resources/templates/list` | The exact upstream template-list responses used by this request, fetched without SDK caching | Live route selections, permissions and Apps metadata. Partial failures force zero rather than treating failed upstreams as absent.                                                                                                     |

If no upstream dependency can establish freshness (for example a gateway-only or
empty global projection), return zero. This is an explicit conservative fallback,
not a fabricated positive TTL for an empty result. Resource-read TTL handling is
unchanged. Legacy list shapes and discovery behavior remain unchanged.

## Implementation and verification slices

1. Add snapshot expiry arithmetic and focused tests for valid/invalid TTL,
   elapsed request time, repeated projections without renewal, empty dependencies,
   mixed fresh/unknown upstreams, exact expiry, and the 5-second ceiling.
2. Capture envelopes at initial connect, reconnect, wake and principal runtime
   discovery. Invalidate on list changes/errors and runtime replacement. Tests
   must verify these real callers, not just set expiry metadata directly.
3. Integrate all four modern list projections, checking configuration/runtime
   stability and gateway-generated fallbacks. Cover two principals, capability
   changes, filtering/aliases and invalidation during an awaited projection.
4. Verify real HTTP hints and legacy response compatibility, then publish matching
   English/Chinese cache guidance. Run focused suites, full lint/tests/build and
   review the final diff before submitting the implementation PR.

The implementation retains zero/private whenever any dependency is unknown.
The design does not upgrade legacy upstream negotiation or promise optional client
conformance. An upstream that supplies no valid TTL continues to yield zero.

Upstream list calls use the legacy client’s raw `request` path, which bypasses
the SDK list response cache while preserving single-page behavior. Provenance is
recorded before those calls and shared by normalized snapshots. Hosted permission
freshness remains unknown and therefore uses zero.
