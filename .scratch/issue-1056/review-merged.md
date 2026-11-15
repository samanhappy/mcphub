# UltraReview Round 1 — merged judgement table (Step 2)

Object: 6f9b1ca..01bdae9 (PR #1491). Raw: p0=4 p1=21 p2=60 p3=31 (N=p0+p1+p2=85).
Disposition: accepted unless noted. Severity = max(sources).

| # | Issue | sources | sev | fix |
|---|-------|---------|-----|-----|
| R1 | DB_SYNCHRONIZE=false: no checked-in DDL; PR-body SQL names the column `file_staging` but the entity selects `"fileStaging"`; docs point at PR prose | build#1, deps#1, docs#2, code#14, align#3, specs#F12 | P0 | add idempotent SQL file, quote the column, docs link, test |
| R2 | Docs + dispatch fixture declare `remotePath` as a staging output param (inverted direction) | build#8, code#13, docs#1, deps#6, align#22, specs#F16 | P1 | upload = inputParams only; download owns outputParams; fix fixture |
| R3 | Real-SSH acceptance suite covers 5 of ~26 required cases; no owner-only profile, no hub-level E2E | align#1, specs#F3 | P0 | extend harness: owner-only, other-user root, .., symlink, read/write-file, credential-slot, version |
| R4 | Process lock: same-PID takeover (both containers PID 1) + lazy init means "refused at startup" is false | build#2, code#1, docs#6, align#26 | P1 | socket-based lock (bind/connect probe), keep info file; docs wording |
| R5 | Failed init leaves the in-process claim set -> staging permanently "locked" | build#5, code#2 | P1 | release claim + lock on init failure |
| R6 | resolveStagingCwd throws at connect for version/args/owner problems -> whole server down | build#3, code#3 | P1 | return undefined + warn; keep hard fail only for argv injection |
| R7 | Hosted mode not failed closed | align#2 | P1 | gate staging on isHostedModeEnabled |
| R8 | Activity log persists the `mcpfile://` ref (no suppressPayload); hub calls have no activity/metrics row | code#8, code#16, specs#F2, specs#F15, align#5 | P1 | suppressPayload flag + rewritten marker; metadata-only row + observeToolCall |
| R9 | Downloads take no read pin -> cleanup can delete mid-download | code#10, specs#F7, align#6 | P1 | pin at consume, unpin in finally |
| R10 | Download hashes one fd and streams another (same-size swap), no stream error/abort handling | code#11, build#11, align#7 | P1 | stream from the verified handle; error/close handlers; guard headersSent |
| R11 | Finalize skips parent-component symlink checks | code#4, specs#F8, align#8 | P1 | assertNoSymlinkComponents before digest in both finalizers |
| R12 | Reserved namespace: dynamic collision shadows the upstream tool and keeps staging; group aliases not reserved | code#15, specs#F1, align#10 | P1 | reserve prefix in group names; disable staging + reject on collision; tests |
| R13 | No PATCH API for per-tool fileStaging / server staging (design §9.5); owner path blocked | specs#F13, align#4 | P1 | two PATCH routes with owner/admin split, list-changed broadcast, curl docs |
| R14 | settingsSync keeps a legacy id -> staging never enabled for sync-managed servers | build#4, code#12 | P2 | randomUUID on create; upgrade legacy id on sync |
| R15 | Rewrite happens before withoutHiddenArguments; updateToolHiddenParams bypasses overlap check | code#9, align#18 | P2 | reject overlap in updateToolHiddenParams (and keep seam order documented) |
| R16 | `mcphub_file_*` callable on `$smart` routes | code#5 | P2 | reject smart routes in handleHubStagingCall |
| R17 | Virtual tools listed on routes with no eligible principal | code#6 | P2 | resolve principal before injection; skip on failure |
| R18 | Cache hints not forced ttlMs=0 on staging routes | code#7 | P2 | include staging exposure in `generated`/listProjectionInputs |
| R19 | Params not validated for existence/string type | specs#F4, align#9 | P1 | string-type check at dispatch; config-time structural only, documented |
| R20 | No source==='mcp' flag; REST paths rely on name checks | specs#F6, align#13 | P2 | add explicit source where cheap, else document + spoof tests |
| R21 | effectiveOwner not used for owner-only staging | align#17 | P2 | fall back to 'admin' |
| R22 | No save-time ssh profile validation | align#20 | P2 | validate in normalize when staging present (400) |
| R23 | Unleased reserved refs not failed at restart (§4.5 vs §4.3) | align#25 | P2 | keep current rule; record narrowing in ADR |
| R24 | ensureDirectory rejects symlinked ancestors above the root (macOS/tmp) | align#24 | P2 | realpath root once, check below it |
| R25 | List/dispatch version predicate disagree | specs#F11, align#11 | P2 | single eligibility helper |
| R26 | status/download callable with zero targets | align#12 | P2 | reject only `upload` when no target; keep status/download owner-scoped (design §4.3 revocation guarantee) and fix the §3.2 wording |
| R27 | Missing tests: runtime-acquire, seam/$smart, auth/principal matrix, mcpService list+dispatch | specs#F25, align#14, align#16 | P2 | add focused tests |
| R28 | Two-call test file-mode only; no DB variant/negative control | specs#F10, align#15 | P2 | parametrise + negative control |
| R29 | Download endpoint tests narrow; mount differs from production | specs#F9, build#12, align#21 | P2 | mount real path, add HEAD/Host/hash cases |
| R30a | Operator blockers missing from the page: how to enable (admin PUT /api/system-config, no UI), enabling staging moves the child cwd for every tool, legacy file-mode server must be saved once | docs#3, docs#4, docs#5 | P1 | add three paragraphs |
| R30b | Docs completeness: settings table (inline cap/cleanup), hub-tool params/returns, auth requirement, boundary attribution, env vars page, architecture page, replicas page, mcp-settings reference, agent guides, README variants, CONTEXT, template-export + OAuth-scope + quota + reserved-namespace statements, curl/API examples | docs#7, docs#8, docs#9, docs#10, docs#11, docs#12, docs#13, docs#14, docs#15, docs#16, docs#17, docs#18, docs#19, docs#20, specs#F24, align#23 | P2 | update pages + guides |
| R31 | Capability snapshot lacks cwd | specs#F21, align#19 | P2 | include staging cwd in fingerprint |
| R32 | integer columns overflow for >2 GiB settings | code#18 | P3 | clamp byte settings to 2^31-1 |
| R33 | Disabling fileStaging drops declared params | code#19 | P2 | keep params with enabled:false |
| R34 | Vacuous token-version test | code#20, specs#F17 | P3 | rewrite to mutate version/hash |
| R35 | findRefs lock order not deterministic | build#6, code#17 | P2 | ORDER BY ref before FOR UPDATE |
| R36 | Docker: data/ not ignored; compose has no /app/data volume | build#7 | P2 | .dockerignore + volume |
| R37a | No orphan dir/temp sweep at startup | build#10 | P3 | init sweep |
| R37b | No max-concurrent-downloads cap, no identity backfill tests, no revoke path for reserved refs | specs#F22 | P3 | add cap, backfill test, revoke handler |
| R38 | content_base64:"" silently creates a reserved ref | align#29 | P3 | reject empty string |
| R39 | Download uses the MCP connection limiter | align#30 | P2 | dedicated limiter |
| R40 | filename sanitization drift | specs#F18 | P3 | reject NUL/CR/LF, codepoint-safe truncate, download.bin |
| R41 | Ref parsing trims; UUID regex accepts v1-5 | specs#F19 | P3 | exact match, v4-only |
| R42 | Adapter allowlist does not match the pinned CLI; `=` forms rejected | deps#2 | P2 | split on '=', add --try-keyboard, drop bogus flags |
| R43 | O_NOFOLLOW undefined on Windows | deps#3 | P2 | fail closed when unsupported |
| R44a | No integrity record for the pinned package | deps#4 | P2 | record/verify dist integrity (script or devDependency) |
| R44b | No StagingAdapter interface; allowlist includes `--help`/`--version` (a credential slot can terminate the child) | specs#F20 | P3 | export the interface; drop the two flags |
| R45 | Pin not bound to the launcher | deps#5 | P2 | require npx (or documented wrapper) + spec position |
| R46 | Template export strips per-tool fileStaging (silent config loss on export/import) | align#28 | P3 | keep fileStaging in the export (it is not trust) or warn on import |
| R47 | PR body route says /api/staging/download | align#27 | P3 | update PR body |
| R48 | serverId fallbacks diverge (`dispatch.ts` uses name, `mcpService` uses legacyServerId); unreachable today because ServerDao always materialises an id, but a future id-less path would bind two different ids | build#9, specs#F5 | P2 | use one helper and fail closed when no id |
| R49 | utils -> services layering | deps#7 | P3 | move hasStagedTools to utils |
| R50 | Harness not wired to a script | deps#8 | P3 | package script |
| R51 | Config-only fallback gated on tools.length===0 | specs#F23 | P3 | fall back whenever no staged tool |
| R52 | Dispatch leaks internal error text | code#21 | P3 | map through messageFor |
| R53 | Frontend serverFormPayload still omits tools | specs#F14 | P2 | opaque round-trip + test |
| S1 | `Content-Disposition` `filename*` not RFC 5987-escaped (`'`, `*`, `(`, `)` left raw); ASCII fallback is `download`, design says `download.bin` | sup3#1 | P3 | escape attr-chars; use download.bin |
| S2 | Download links accept the default `http://localhost:3000` base URL | sup3#2 | P3 | reject DEFAULT_INSTALL_BASE_URL at mint time |
| S3 | Argv allowlist treats a *value* starting with `--` as an unknown option (false rejection kills the server via R6) and ignores single-dash tokens | sup3#3 | P3 | parse option/value pairs; inspect single-dash tokens |
