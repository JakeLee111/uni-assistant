#!/bin/sh
# After `node login.js`: encrypt the new session and upload it to the `session` branch.
set -e
cd "$(dirname "$0")"
REPO="$(git -C .. remote get-url origin)"
TMP="$(mktemp -d)"
git clone -q --depth 1 -b session "$REPO" "$TMP"
STATE_KEY="$(cat auth/key)" openssl enc -aes-256-cbc -pbkdf2 -salt -in auth/state.json -out "$TMP/state.enc" -pass env:STATE_KEY
echo "{\"checkedAt\":\"$(date -u +%FT%TZ)\",\"blackboard\":\"ok\"}" > "$TMP/status.json"
cd "$TMP"
git checkout -q --orphan fresh
git add -A
git commit -q -m "session login $(date -u +%FT%TZ)"
git push -q -f origin fresh:session
rm -rf "$TMP"
echo "Session uploaded."
