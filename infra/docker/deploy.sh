#!/usr/bin/env bash
# Deploy the yumaoqiu app tier (Docker).
#
#   ./deploy.sh              pull, build if needed, roll out, verify, auto-rollback
#   ./deploy.sh --no-pull    skip git pull
#   ./deploy.sh --check      dry run: report what would happen, change nothing
#   ./deploy.sh --tag <sha>  deploy a specific commit (must have images built)
#
# Rollback is automatic: if health checks fail, the previously running image tag
# is restored via `TAG=<prev> docker compose up -d`.
#
# Lessons baked in (each one bit us during the initial migration):
#   * builds run SEQUENTIALLY - parallel builds overflow the 20G /data volume
#   * the build cache is pruned between images for the same reason
#   * a disk guard aborts before production data is at risk
#   * DB migrations are MANUAL: this database has no _prisma_migrations table,
#     so `prisma migrate deploy` would replay all 61 migrations. Never run it.
set -uo pipefail

REPO=/opt/yumaoqiu
DOCKER_DIR="$REPO/infra/docker"
COMPOSE=(docker compose -f "$DOCKER_DIR/compose.yaml")
LOG=/root/deploy.log
say() { echo "[$(date -u +%H:%M:%SZ)] $*" | tee -a "$LOG"; }
code() { curl -s -o /dev/null -w '%{http_code}' -m 10 "$1" 2>/dev/null || echo 000; }

PULL=1; CHECK=0; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull) PULL=0 ;;
    --check)   CHECK=1 ;;
    --tag)     shift; TAG="${1:-}" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
  shift
done

cd "$REPO" || { echo "no repo at $REPO"; exit 1; }
mkdir -p "$(dirname "$LOG")"

say "=== deploy start ==="

# ---------------------------------------------------------------- 1. source
if [ "$PULL" = "1" ]; then
  say "--- git pull --ff-only"
  if [ "$CHECK" = "1" ]; then
    git fetch -q origin 2>&1 | tail -2
    say "  behind origin/main by $(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?') commits"
  else
    if ! git pull --ff-only 2>&1 | tail -4 | sed 's/^/  /'; then
      say "ABORT: pull failed (dirty tree or divergence). Resolve manually."
      exit 1
    fi
  fi
fi

TAG="${TAG:-$(git rev-parse --short HEAD)}"
say "  target tag: $TAG"

# ---------------------------------------------------------------- 2. migrations
PREV_TAG=$(docker inspect -f '{{.Config.Image}}' yumaoqiu-backend-1 2>/dev/null | sed 's/.*://')
say "  currently running: ${PREV_TAG:-<none>}"
if [ -n "${PREV_TAG:-}" ] && git rev-parse --verify -q "$PREV_TAG" >/dev/null; then
  NEWMIG=$(git diff --name-only "$PREV_TAG" "$TAG" -- apps/backend/prisma/migrations 2>/dev/null | sed 's#apps/backend/prisma/migrations/##; s#/.*##' | sort -u)
  if [ -n "$NEWMIG" ]; then
    say "  !! NEW MIGRATIONS detected (apply these MANUALLY before rollout):"
    echo "$NEWMIG" | sed 's/^/     - /' | tee -a "$LOG"
    say "     reminder: this DB has no _prisma_migrations table - do NOT run prisma migrate deploy"
  else
    say "  no new migrations between $PREV_TAG and $TAG"
  fi
fi

# ---------------------------------------------------------------- 3. images
need_build=0
for img in "yumaoqiu/backend:$TAG" "yumaoqiu/frontend:$TAG"; do
  docker image inspect "$img" >/dev/null 2>&1 || { say "  missing image: $img"; need_build=1; }
done

if [ "$need_build" = "1" ]; then
  FREE=$(df -m /data | tail -1 | awk '{print $4}')
  say "  build needed; /data free = ${FREE}MB"
  if [ "$FREE" -lt 9000 ]; then
    say "ABORT: needs >=9000MB on /data to build safely. Free space first:"
    say "       docker builder prune -af"
    exit 1
  fi
  if [ "$CHECK" = "1" ]; then
    say "  [check] would build backend + frontend sequentially"
  else
    say "--- build backend"
    docker build -f "$DOCKER_DIR/Dockerfile" --target backend -t "yumaoqiu/backend:$TAG" \
      --progress=plain "$REPO" >> "$LOG" 2>&1 || { say "ABORT: backend build failed (see $LOG)"; exit 1; }
    say "--- prune cache before the second image"
    docker builder prune -af >> "$LOG" 2>&1
    say "--- build frontend"
    docker build -f "$DOCKER_DIR/Dockerfile" --target frontend -t "yumaoqiu/frontend:$TAG" \
      --build-arg NEXT_PUBLIC_API_URL=https://ydysyumao.cn/api \
      --progress=plain "$REPO" >> "$LOG" 2>&1 || { say "ABORT: frontend build failed (see $LOG)"; exit 1; }
    say "--- prune cache after build"
    docker builder prune -af >> "$LOG" 2>&1
  fi
else
  say "  images already present, no build needed"
fi

if [ "$CHECK" = "1" ]; then
  say "=== [check] would: compose up -d TAG=$TAG, verify, auto-rollback on failure ==="
  say "=== check done ==="
  exit 0
fi

# ---------------------------------------------------------------- 4. roll out
say "--- rolling out"
rm -rf /tmp/deploy-before.txt
"${COMPOSE[@]}" ps --format '{{.Name}} {{.Status}}' > /tmp/deploy-before.txt 2>&1
TAG="$TAG" "${COMPOSE[@]}" up -d --force-recreate >> "$LOG" 2>&1 || {
  say "compose up failed, rolling back"; ROLLBACK=1
}

# ---------------------------------------------------------------- 5. verify
OK=0
for i in $(seq 1 12); do
  b=$(code http://127.0.0.1:4000/api/health)
  f=$(code http://127.0.0.1:3000/)
  p=$(code https://ydysyumao.cn/api/health)
  w=$(code https://ydysyumao.cn/)
  say "  verify $i: local_b=$b local_f=$f public_api=$p public_web=$w"
  if [ "$b" = "200" ] && [ "$f" = "200" ] && [ "$p" = "200" ] && [ "$w" = "200" ]; then OK=1; break; fi
  sleep 5
done

if [ "$OK" != "1" ] && [ -n "${PREV_TAG:-}" ]; then
  say "!!! verification failed - rolling back to $PREV_TAG"
  TAG="$PREV_TAG" "${COMPOSE[@]}" up -d --force-recreate >> "$LOG" 2>&1
  sleep 10
  say "  after rollback: api=$(code https://ydysyumao.cn/api/health) web=$(code https://ydysyumao.cn/)"
  say "=== deploy FAILED (rolled back) ==="
  exit 1
fi
[ "$OK" != "1" ] && { say "=== deploy FAILED (no previous tag to roll back to) ==="; exit 1; }

say "--- containers"
"${COMPOSE[@]}" ps --format '  {{.Name}} {{.Status}}' | tee -a "$LOG"
say "  memory: $(docker stats --no-stream --format '{{.Name}}={{.MemUsage}}' | tr '\n' ' ')"
say "=== deploy OK (tag $TAG) ==="
