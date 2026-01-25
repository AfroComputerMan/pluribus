#!/bin/bash

# Test script for SSE endpoint
# Usage: ./test-sse.sh <run-id>

if [ -z "$1" ]; then
  echo "Usage: $0 <run-id>"
  echo "Example: $0 550e8400-e29b-41d4-a716-446655440000"
  exit 1
fi

RUN_ID=$1
API_URL=${API_URL:-http://localhost:3000}

echo "Connecting to SSE stream for run: $RUN_ID"
echo "URL: $API_URL/api/runs/$RUN_ID/events"
echo "---"
echo ""

# Use curl with -N to disable buffering for SSE
curl -N "$API_URL/api/runs/$RUN_ID/events"
