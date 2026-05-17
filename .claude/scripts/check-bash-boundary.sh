#!/usr/bin/env bash
# Blocks Bash commands that navigate via cd to absolute paths outside the project.
# File write protection is handled by check-file-boundary.sh on the Write/Edit tools.
# PreToolUse hook for Bash. Exit 2 = block. Exit 0 = allow.

set -uo pipefail

PROJECT_DIR="/home/brianserver/Anime"

emit_deny() {
  local reason="${1//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 2
}

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
[ -z "$COMMAND" ] && exit 0

# ── Block cd to absolute paths outside the project ───────────────────────
# Only matches `cd /absolute/path` — relative cd is fine.
if printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])cd[[:space:]]+/'; then
  CD_PATH=$(printf '%s' "$COMMAND" \
    | grep -oE '(^|[;&|[:space:]])cd[[:space:]]+/[^[:space:];&|]+' \
    | sed 's/^[[:space:]]*//;s/cd[[:space:]]*//' \
    | head -1)
  if [ -n "$CD_PATH" ]; then
    RESOLVED=$(realpath -m "$CD_PATH" 2>/dev/null || printf '%s' "$CD_PATH")
    case "$RESOLVED" in
      "$PROJECT_DIR"|"$PROJECT_DIR"/*)
        : ;;
      *)
        emit_deny "Blocked: 'cd ${CD_PATH}' navigates outside the project directory (${PROJECT_DIR})."
        ;;
    esac
  fi
fi

exit 0
