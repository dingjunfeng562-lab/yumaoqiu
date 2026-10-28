#!/usr/bin/env bash
# check-bundle-text.sh <image> <text>
#
# Counts occurrences of a FIXED STRING inside a built image's Next.js output.
# Exits 1 if the string is found (so it can gate a deploy), 0 if absent.
#
# Why fixed-string and not a regex:
#   `grep -E 'A.{1,12}B'` matches `.` against BYTES in the C locale, so a span of
#   five Chinese characters is 15 bytes and a {1,12} quantifier silently never
#   matches. That produced a check which returned 0 for both the old and the new
#   bundle - worthless as evidence. -F compares characters and cannot lie.
#
# Usage:
#   infra/docker/check-bundle-text.sh yumaoqiu/frontend:2116d6b "some ui copy"
set -uo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,16p' "$0"
  exit 2
fi

IMAGE="$1"
shift
TEXT="$*"

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "no such image: $IMAGE" >&2
  exit 2
fi

# LC_ALL=C.UTF-8 keeps grep on a multibyte-aware path for the -F comparison.
# `sh -c ... _ "$TEXT"` -> $0="_", $1="$TEXT" (the first arg after -c is $0).
HITS=$(docker run --rm --entrypoint /bin/sh "$IMAGE" \
  -c "LC_ALL=C.UTF-8 grep -raF -- \"\$1\" .next 2>/dev/null | wc -l" _ "$TEXT" | tr -d '[:space:]')

case "$HITS" in
  ''|*[!0-9]*) echo "grep failed" >&2; exit 2 ;;
esac

if [ "$HITS" -gt 0 ]; then
  echo "FOUND $HITS occurrence(s) of the string in $IMAGE"
  exit 1
fi

echo "absent from $IMAGE (0 occurrences)"
exit 0
