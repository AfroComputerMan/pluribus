#!/usr/bin/env bash
# Record an e2e run to e2e/artifacts/pluribus-e2e.mp4 by screen-capturing the X
# display with ffmpeg while WebdriverIO drives the built Tauri app.
#
# WHY OS-level capture: WebKitWebDriver (the native driver tauri-driver wraps on
# Linux) has no reliable screenshot endpoint, so frame-stitching WDIO reporters
# produce blank video. Grabbing the X display directly is robust and shows the
# real app exactly as a user sees it.
#
# Local use:  bun run e2e:record           (uses your existing $DISPLAY)
# Headless:   xvfb-run -a -s "-screen 0 1280x800x24" bun run e2e:record
#             (CI does this; see .github/workflows/e2e.yml)
#
# Prereqs: ffmpeg, a built debug app (bun run e2e:build), and
#          `cargo install tauri-driver --locked` + WebKitWebDriver on PATH.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$HERE/artifacts"
OUT="$OUT_DIR/pluribus-e2e.mp4"
mkdir -p "$OUT_DIR"

DISPLAY_TARGET="${DISPLAY:-:0}"
SIZE="${E2E_VIDEO_SIZE:-1280x800}"

echo "Recording display $DISPLAY_TARGET ($SIZE) -> $OUT"
ffmpeg -y -loglevel warning \
  -f x11grab -video_size "$SIZE" -framerate 25 -i "$DISPLAY_TARGET" \
  -codec:v libx264 -pix_fmt yuv420p "$OUT" &
FFMPEG_PID=$!

# ffmpeg can exit immediately when the capture display is unavailable or the
# requested size is invalid. Give it a moment, then confirm it is actually
# running — otherwise we'd drive the app and "succeed" with no/blank video.
sleep 1
if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then
  echo "ffmpeg failed to start capturing $DISPLAY_TARGET ($SIZE)" >&2
  wait "$FFMPEG_PID" 2>/dev/null || true
  exit 1
fi

# Always finalize the mp4, even if the test run fails (the video is the artifact).
cleanup() {
  kill -INT "$FFMPEG_PID" 2>/dev/null || true
  wait "$FFMPEG_PID" 2>/dev/null || true
}
trap cleanup EXIT

STATUS=0
npx wdio run "$HERE/wdio.conf.js" || STATUS=$?

cleanup
trap - EXIT

# The recording is the whole point of this job. ffmpeg can die mid-run (display
# lost, disk full, codec error) while `cleanup` deliberately ignores its exit
# code so a failing test still finalizes whatever was captured. Validate here
# that we produced a non-trivial video and fail loudly otherwise — even when
# wdio passed — so CI never "succeeds" with an empty/corrupt artifact.
OUT_BYTES=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ ! -s "$OUT" ] || [ "$OUT_BYTES" -lt 10000 ]; then
  echo "No usable video at $OUT (${OUT_BYTES} bytes) — ffmpeg capture failed" >&2
  exit 1
fi

echo "Video written to $OUT (${OUT_BYTES} bytes, wdio exit=$STATUS)"
exit "$STATUS"
