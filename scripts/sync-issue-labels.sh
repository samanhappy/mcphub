#!/usr/bin/env bash
# Run manually as a repository maintainer. No issue labels are changed.
set -euo pipefail

repo=samanhappy/mcphub
sync_label() {
  gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force
}

# Preserve the existing GitHub default label colors/descriptions.
ensure_label() {
  if ! gh label list --repo "$repo" --limit 1000 --json name --jq '.[].name' | grep -Fx "$1" >/dev/null; then
    gh label create "$1" --repo "$repo" --color "$2" --description "$3"
  fi
}
ensure_label bug d73a4a "Something isn't working"
ensure_label enhancement a2eeef "New feature or request"
ensure_label documentation 0075ca "Improvements or additions to documentation"
ensure_label question d876e3 "Further information is requested"

sync_label refactor c5def5 "Technical debt or internal improvement"
sync_label exploration d4c5f9 "Research or feasibility study"

sync_label area:skills 1d76db "Skills, built-in prompts/resources and MCP Apps"
sync_label area:auth 1d76db "Identity, OAuth, permissions and credentials"
sync_label area:core 1d76db "MCP protocol, connections, sessions and runtime"
sync_label area:governance 1d76db "Audit, activity and governance"
sync_label area:registry 1d76db "Catalog, discovery and server metadata"
sync_label area:search 1d76db "Embedding and vector search"
sync_label area:deployment 1d76db "Deployment, build and supply chain"

sync_label priority:p0 b60205 "Critical: immediate maintainer attention"
sync_label priority:p1 d93f0b "High priority"
sync_label priority:p2 fbca04 "Normal priority"
sync_label priority:p3 e4e669 "Low priority or long-term work"

sync_label agent:investigate c5def5 "Evaluate, investigate or reproduce before approval"
sync_label agent:needs-owner d4c5f9 "Documented blocking decision requires the maintainer"
sync_label agent:waiting-feedback fef2c0 "Waiting for reporter or user feedback"
sync_label agent:ready 0e8a16 "Maintainer-approved, ready to implement"
sync_label agent:in-progress 0052cc "Claimed or implementation PR exists"
sync_label agent:deferred ededed "Intentionally postponed"
ensure_label ready-for-human c5def5 "Human-only implementation; exclude from agent queue"
