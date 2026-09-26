# Security advisory workflow

Repository security advisories (`repos/samanhappy/mcphub/security-advisories`) are
operated with `gh api`. Use this guide when triaging, accepting, fixing, releasing,
or publishing an advisory, and when a linked GHSA appears to be missing.

## Reading advisories

An unpublished advisory is invisible publicly: the web page and the global
`api.github.com/advisories/GHSA-...` endpoint both return 404 — a 404 does not mean
the advisory does not exist. Look it up with the repo-scoped API instead, which
includes draft and triage states:

```bash
gh api --paginate 'repos/samanhappy/mcphub/security-advisories?per_page=100' \
  --jq '.[] | {ghsa_id, state, severity, summary, vulnerable: .vulnerabilities[0].vulnerable_version_range, patched: .vulnerabilities[0].patched_versions}'
gh api repos/samanhappy/mcphub/security-advisories/<ghsa_id>
```

Reading draft/triage advisories requires repository access as a maintainer or
security manager (authenticate with the maintainer account, e.g. `samanhappy`).

## Lifecycle

States: `triage` → `draft` → `published` (or `closed`). `triage` is an
un-accepted private vulnerability report; `draft` is the maintainer's accepted
advisory.

### Accept a reporter's submission (triage → draft)

PATCHing `state: "draft"` is the "accept" action and flips
`submission.accepted` to `true`. Until then the report is not fully under your
control (for example, comments and publication are restricted).

```bash
gh api --method PATCH repos/samanhappy/mcphub/security-advisories/<ghsa_id> \
  -f state="draft"
```

`state` only accepts `draft | published | closed`.

### Request a CVE

```bash
gh api --method POST repos/samanhappy/mcphub/security-advisories/<ghsa_id>/cve
```

Returns 202; GitHub assigns the CVE when the advisory is published. Public
repositories only; requires admin or security-manager role.

### Update fields, preserving existing content

PATCH replaces only the fields you send. Keep the reporter's `description`,
`credits`, and `cwe_ids` intact; set `severity` or `cvss_vector_string` (mutually
exclusive). Set the patched range on the existing `vulnerabilities` entry,
including the `package` object:

```json
{
  "vulnerabilities": [
    {
      "package": { "ecosystem": "npm", "name": "@samanhappy/mcphub" },
      "vulnerable_version_range": ">= 0.12.15",
      "patched_versions": ">= 1.0.41"
    }
  ]
}
```

## Disclosure order

Never publish before a patched release exists — publishing discloses the
vulnerability publicly while it is still exploitable.

1. Land the fix (security commits go directly to `main` with
   `fix(security): ... (GHSA-...)` messages).
2. Release: pushing a `v*.*.*` tag triggers the npm publish and GitHub Release
   workflows automatically (see [git-and-contribution.md](git-and-contribution.md)).
3. After the release is live, PATCH the advisory with `patched_versions` and
   `state: "published"`; the CVE is assigned and the reporter is notified.

## Commenting is not available via the API

The repository advisory comment endpoints were removed from the GitHub REST API:
`POST /comments` returns 404 in every advisory state (GET still returns an empty
list). Communicate with the reporter through the advisory web UI or rely on the
publication notification. Do not spend time retrying the endpoint.

## Verifying REST endpoint availability

To check whether an endpoint exists or what it requires, read the current OpenAPI
description. Use the jsDelivr mirror — raw.githubusercontent.com is slow from the
agent sandbox:

```bash
curl -sL -o /tmp/rest-spec.json \
  https://cdn.jsdelivr.net/gh/github/rest-api-description@main/descriptions/api.github.com/api.github.com.json
```

## Permissions

Updating advisories and requesting CVEs needs a classic token with `repo` (or
fine-grained `repository_advisories:write`) scope plus admin or security-manager
role on the repository.
