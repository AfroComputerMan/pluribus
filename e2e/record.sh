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
# Prereqs: ffmpeg (+ ffprobe), a built debug app (bun run e2e:build), and
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

# Finalize the mp4 even if the test run fails (the video is the artifact). ffmpeg
# should still be alive when we get here — if it isn't, it died on its own during
# the run (X reset, codec error) and the recording is truncated, so record that.
FFMPEG_DIED=0
cleanup() {
  if kill -0 "$FFMPEG_PID" 2>/dev/null; then
    kill -INT "$FFMPEG_PID" 2>/dev/null || true
  else
    FFMPEG_DIED=1
  fi
  wait "$FFMPEG_PID" 2>/dev/null || true
}
trap cleanup EXIT

STATUS=0
npx wdio run "$HERE/wdio.conf.js" || STATUS=$?

cleanup
trap - EXIT

# A valid-but-truncated mp4 still parses, so don't trust the container alone:
# fail if ffmpeg exited before we stopped it.
if [ "$FFMPEG_DIED" -eq 1 ]; then
  echo "ffmpeg exited before recording finished — capture is incomplete/truncated" >&2
  exit 1
fi

# Defence in depth: validate the container has a real video stream with a
# positive duration, so a 0-frame/corrupt file never counts as success either.
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe not found — cannot validate $OUT" >&2
  exit 1
fi
VIDEO_CODEC=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_type -of csv=p=0 "$OUT" 2>/dev/null | head -n1)
DURATION=$(ffprobe -v error \
  -show_entries format=duration -of csv=p=0 "$OUT" 2>/dev/null || echo "")
if [ "$VIDEO_CODEC" != "video" ] || [ -z "$DURATION" ] \
   || ! awk "BEGIN{exit !(${DURATION:-0}+0 > 0)}"; then
  echo "No playable video at $OUT (stream='$VIDEO_CODEC' duration='$DURATION') — ffmpeg capture failed" >&2
  exit 1
fi

echo "Video written to $OUT (duration=${DURATION}s, wdio exit=$STATUS)"
exit "$STATUS"
