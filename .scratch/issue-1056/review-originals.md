# UltraReview Round 1 — original findings (condensed, one line per finding)
Object: 6f9b1ca..01bdae9 (PR #1491). Agents: build, code, specs, docs, deps, align.

## build (RAW p0=1 p1=2 p2=5 p3=4)
build#1 P0 DDL: PR-body SQL names system_config column `file_staging`, entity selects `"fileStaging"`; no SQL in repo.
build#2 P1 process lock same-PID takeover (both containers PID 1); init lazy so not refused at startup.
build#3 P1 resolveStagingCwd throws at connect for bad adapter/principal -> whole server down.
build#4 P2 settingsSync keeps legacy id; DB update never writes id -> staging never enabled.
build#5 P2 failed store init leaves acquiredStateDirs set -> permanent "locked".
build#6 P2 findRefs sorts after FOR UPDATE -> lock order not deterministic.
build#7 P2 .dockerignore lacks data/; compose mounts no /app/data volume.
build#8 P2 docs example outputParams ["remotePath"] on upload.
build#9 P3 dispatch serverId falls back to server name.
build#10 P3 no orphan dir/temp sweep at startup.
build#11 P3 download stream has no error handler; catch may write 404 after headers.
build#12 P3 controller test mounts /api path, not the production route.

## code (RAW p0=0 p1=3 p2=11 p3=7)
code#1 P1 lock takeover by same-PID peer (file-mode double writer).
code#2 P1 transient DB error during init -> permanent locked.
code#3 P1 resolveStagingCwd throws -> server dead on version bump/args/owner deletion.
code#4 P2 finalize does not check parent components (symlink swap).
code#5 P2 mcphub_file_* callable on $smart routes (targets undefined -> all).
code#6 P2 virtual tools listed without an eligible principal.
code#7 P2 cache hints not forced ttlMs=0 on staging routes.
code#8 P2 activity log stores mcpfile ref; no suppressPayload.
code#9 P2 rewrite happens before withoutHiddenArguments.
code#10 P2 downloads take no read pin.
code#11 P2 stream from second fd (same-size swap), no error handling/abort destroy.
code#12 P2 settingsSync legacy id.
code#13 P2 docs remotePath output param.
code#14 P2 no DB_SYNCHRONIZE=false schema path; docs point at absent SQL.
code#15 P3 groupToolNames does not reserve mcphub_file_*.
code#16 P3 hub calls bypass observeToolCall (no metrics/activity row).
code#17 P3 findRefs lock-order comment overstates guarantee.
code#18 P3 size/reservedBytes integer vs settings clamp MAX_SAFE_INTEGER.
code#19 P3 disabling fileStaging drops input/output params.
code#20 P3 vacuous token-version test (only tests single use).
code#21 P3 errorText leaks internal StagingError text vs tools' messageFor.

## specs (RAW p0=0 p1=3 p2=13 p3=9)
specs#F1 P1 reserved namespace shadowed instead of rejected/disabled; group names unreserved.
specs#F2 P1 no suppressPayload; activity log records ref.
specs#F3 P1 real-SSH suite 5 cases vs 26 required; no owner-only.
specs#F4 P2 params not validated at config time for existence/string type.
specs#F5 P2 ref server binding fails open when server has no id.
specs#F6 P2 no source==='mcp' flag; no spoof tests.
specs#F7 P2 downloads take no read pin.
specs#F8 P2 finalize skips parent symlink checks.
specs#F9 P2 download limiter/tests incomplete (Host/XFH/HEAD/Range/hash).
specs#F10 P2 two-call test file-mode only; no DB variant/negative control.
specs#F11 P2 list and dispatch version predicate disagree.
specs#F12 P2 no DB_SYNCHRONIZE=false migration artifact/test.
specs#F13 P2 no PATCH file-staging/staging API; owner cannot configure.
specs#F14 P2 frontend serverFormPayload still omits tools.
specs#F15 P2 hub virtual calls produce no activity/metrics record.
specs#F16 P2 docs + test fixture use remotePath as output param.
specs#F17 P3 vacuous version-change test.
specs#F18 P3 filename sanitization drift (strip vs reject, UTF-8 split, download.bin).
specs#F19 P3 ref parsing trims; UUID regex accepts v1-5.
specs#F20 P3 no StagingAdapter interface; no integrity pin; allowlist extra --help/--version.
specs#F21 P3 capability snapshot fingerprint lacks cwd.
specs#F22 P3 no max concurrent downloads, no identity backfill, no revoke, no orphan sweep.
specs#F23 P3 config-only fallback gated on tools.length===0.
specs#F24 P3 docs omit template-export rule, OAuth-scope residual, reserved-namespace rule.
specs#F25 P3 no tests for no-runtime-acquire, seam coverage of $smart call_tool, relative-path regression.

## docs (RAW p0=2 p1=3 p2=11 p3=4)
docs#1 P0 docs config example declares outputParams ["remotePath"] on upload.
docs#2 P0 DDL pointer: wrong column name, "in the pull request", ordering, no objects named.
docs#3 P1 page never says how to enable (admin PUT /api/system-config; no dashboard UI).
docs#4 P1 missing: enabling staging moves child cwd for every tool on that server.
docs#5 P1 missing: legacy file-mode server must be saved once before staging activates.
docs#6 P2 "second process refused at startup" is wrong (lazy init).
docs#7 P2 settings table: inline cap is body-limit-derived; cleanupIntervalMinutes missing.
docs#8 P2 hub tools section incomplete (server, allow_zero_byte, sha256, ref, route scoping).
docs#9 P2 no statement that staging requires an authenticated user.
docs#10 P2 boundary attribution wrong (adapter root, not hub checks).
docs#11 P2 environment-variables page missing MCPHUB_STAGING_ROOT/STATE_DIR.
docs#12 P2 architecture page says all state lives in mcp_settings.json.
docs#13 P2 replicas page never says staging disabled in replica mode.
docs#14 P2 mcp-settings reference lacks staging/fileStaging rows.
docs#15 P2 docs/agents/architecture.md lacks staging invariant.
docs#16 P2 docs/agents/testing.md lacks the real-SSH harness.
docs#17 P3 install.baseUrl also from INSTALL_BASE_URL; UI path.
docs#18 P3 deferred list omits filesystem adapter/UI/request_upload.
docs#19 P3 README variants do not link the feature page.
docs#20 P3 CONTEXT.md vocabulary lacks file staging/staged reference.

## deps (RAW p0=0 p1=1 p2=5 p3=2)
deps#1 P1 DDL column name mismatch (file_staging vs "fileStaging").
deps#2 P2 allowlist does not match 1.11.0 CLI: missing --try-keyboard/--ssh-config-file; --private-key/--socks-proxy wrong; `=` forms rejected.
deps#3 P2 O_NOFOLLOW undefined on Windows -> silently no-op.
deps#4 P2 no integrity/lockfile record for the pinned package.
deps#5 P2 pin not bound to the launcher (any command with the spec in argv passes).
deps#6 P2 docs example remotePath.
deps#7 P3 utils/connectionRelevantConfig imports services/fileStaging/adapter (layering).
deps#8 P3 harness not wired to a package script or workflow.

## align (RAW p0=1 p1=9 p2=15 p3=5)
align#1 P0 real-SSH suite 5 checks; no owner-only, other-user root, .., symlink, read/write-file, credential-slot, version; no hub E2E.
align#2 P1 hosted mode not failed closed (only replica).
align#3 P1 no additive migration path for DB_SYNCHRONIZE=false.
align#4 P1 no per-tool/server staging API; owner path blocked by privileged-config rule.
align#5 P1 no suppressPayload; hub calls have no activity row.
align#6 P1 downloads take no read pin.
align#7 P1 download hashes one fd, streams another (same-size swap).
align#8 P1 finalize skips parent component checks.
align#9 P1 params not validated for existence/string type at config time.
align#10 P1 collision shadowed, group names unreserved.
align#11 P2 list/dispatch version predicate disagree.
align#12 P2 status/download callable with zero targets.
align#13 P2 no source==='mcp' flag.
align#14 P2 no auth/principal tests.
align#15 P2 two-call test file-mode only, no negative control.
align#16 P2 no mcpService-level tests (reserved path/list/$smart/collision).
align#17 P2 effectiveOwner not used for owner-only staging.
align#18 P2 updateToolHiddenParams bypasses overlap validation.
align#19 P2 capability snapshot lacks cwd.
align#20 P2 no save-time ssh profile validation.
align#21 P2 download endpoint tests narrow; wrong mount.
align#22 P2 docs remotePath.
align#23 P2 docs omit API/curl, OAuth-scope and quota residuals.
align#24 P2 ensureDirectory rejects symlinked ancestors above the root (macOS).
align#25 P2 unleased reserved refs not failed at restart (§4.5 vs §4.3 ambiguity).
align#26 P3 docs "refused at startup" wording.
align#27 P3 PR body route says /api/staging/download.
align#28 P3 template export strips per-tool fileStaging too.
align#29 P3 content_base64:"" silently creates a reserved ref.
align#30 P3 download uses the MCP connection limiter.
