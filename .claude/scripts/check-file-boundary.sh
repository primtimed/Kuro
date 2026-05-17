#!/usr/bin/env bash
# Blocks Write/Edit operations on paths outside the project directory.
# PreToolUse hook for Edit|Write. Exit 2 = block. Exit 0 = allow.

set -uo pipefail

PROJECT_DIR="/home/brianserver/Anime"

emit_deny() {
  local reason="${1//\"/\\\"}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 2
}

if ! command -v jq >/dev/null 2>&1; then
  exit 0  # fail open so jq absence doesn't block all writes
fi

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)
[ -z "$FILE_PATH" ] && exit 0

RESOLVED=$(realpath -m "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")

case "$RESOLVED" in
  "$PROJECT_DIR"|"$PROJECT_DIR"/*)
    exit 0 ;;
  *)
    emit_deny "Cannot write to '${FILE_PATH}': path is outside the project directory. All file changes must stay within ${PROJECT_DIR}."
    ;;
esac
