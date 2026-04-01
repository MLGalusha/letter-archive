#!/usr/bin/env bash
# Bundle size benchmark — measures gzipped JS/CSS from a production build.
# Usage: cd frontend && bash ../scripts/bundle-benchmark.sh

set -euo pipefail

echo "Building frontend…"
npm run build 2>&1 | tail -1

total_js_raw=0; total_js_gzip=0
initial_js_raw=0; initial_js_gzip=0
largest_raw=0; largest_gzip=0; largest_name=""
chunk_count=0

for f in dist/assets/*.js; do
  raw=$(wc -c < "$f" | tr -d ' ')
  gz=$(gzip -c "$f" | wc -c | tr -d ' ')
  name=$(basename "$f")
  total_js_raw=$((total_js_raw + raw))
  total_js_gzip=$((total_js_gzip + gz))
  chunk_count=$((chunk_count + 1))
  if [ "$raw" -gt "$largest_raw" ]; then
    largest_raw=$raw; largest_gzip=$gz; largest_name=$name
  fi
  # Entry chunk is the large index-*.js
  if echo "$name" | grep -q "^index-.*\.js$" && [ "$raw" -gt 100000 ]; then
    initial_js_raw=$raw; initial_js_gzip=$gz
  fi
done

total_css_raw=0; total_css_gzip=0
for f in dist/assets/*.css; do
  raw=$(wc -c < "$f" | tr -d ' ')
  gz=$(gzip -c "$f" | wc -c | tr -d ' ')
  total_css_raw=$((total_css_raw + raw))
  total_css_gzip=$((total_css_gzip + gz))
done

js_kb=$(echo "scale=2; $total_js_gzip/1024" | bc)
css_kb=$(echo "scale=2; $total_css_gzip/1024" | bc)
initial_kb=$(echo "scale=2; $initial_js_gzip/1024" | bc)
largest_kb=$(echo "scale=2; $largest_gzip/1024" | bc)
total_kb=$(echo "scale=2; ($total_js_gzip+$total_css_gzip)/1024" | bc)

echo ""
echo "=== Bundle Size Results ==="
echo "total_gzip_kb: $total_kb"
echo "total_js_gzip_kb: $js_kb"
echo "total_css_gzip_kb: $css_kb"
echo "initial_js_gzip_kb: $initial_kb"
echo "largest_chunk_gzip_kb: $largest_kb ($largest_name)"
echo "chunk_count: $chunk_count"
