#!/usr/bin/env bash
# Generates Hollowvale's item icons (godot/game/ui/icons/<id>.png) and HUD stat icons
# (godot/game/ui/hud/<id>.png) with an OpenRouter image model, one call per icon, each set styled after
# its first icon. Existing files are kept (FORCE=1 regenerates). No commas in descriptions: the
# icon command treats commas as separate icons. Usage: bash tools/openrouter/make_item_icons.sh [--model x]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=godot/game/ui/icons
TMP=build/icons
mkdir -p "$OUT" "$TMP"
STYLE="Painterly realistic survival-game inventory icon, single object centred with a little padding, three-quarter view, warm soft rim light, rich detail, no background, no text."
ITEMS=(
  "stick|a small bundle of three straight dry wooden sticks tied together"
  "stone|a sharp grey flint stone with a chipped edge"
  "fiber|a twisted bundle of green and straw-coloured plant fiber"
  "wood|a small stack of split firewood logs"
  "hide|a folded grey wolf pelt with thick fur"
  "bone|a pale curved bone shard with faintly glowing orange ember cracks"
  "berries|a handful of ripe glossy red brambleberries with two green leaves"
  "raw_meat|a raw red meat steak on a bone"
  "cooked_meat|a roasted golden-brown meat steak on a bone with grill marks"
  "bandage|a rolled linen cloth bandage"
  "waterskin|a full round leather waterskin with a cork stopper"
  "waterskin_empty|an empty - flat - crumpled leather waterskin"
  "stone_axe|a primitive stone axe - sharpened flint head lashed to a wooden handle with plant fiber"
  "pickaxe|a primitive pickaxe - two pointed stone heads lashed to a wooden handle with plant fiber"
  "spear|a primitive wooden spear with a flint spearhead lashed with fiber - diagonal"
  "bone_spear|a primitive wooden spear tipped with a pale bone blade that glows faintly orange - diagonal"
  "bow|a curved wooden hunting bow with a taut string - diagonal"
  "arrow|a single wooden arrow with a flint tip and white feather fletching - diagonal"
  "torch|a burning wooden torch with a bright warm flame"
  "campfire|a small campfire - logs in a ring of stones with bright flames"
)
# HUD stat icons: bold and readable at 24 px; shown in rows of ten like Minecraft's hearts and shanks.
HUD_STYLE="Bold, clean video-game HUD status icon. One simple, instantly readable symbol filling the frame, thick dark brown outline, rich saturated colour with a soft glossy highlight, front view, flat background-free cut-out, no text, no shadow."
HUD=(
  "heart|a plump red heart"
  "shank|a roasted meat shank - a drumstick with a pale bone handle and golden-brown meat - diagonal"
  "droplet|a single clear blue water droplet"
  "flame|a single warm orange and yellow flame"
  "bolt|a single bright amber lightning bolt"
)
# make <out dir> <size> <style> <entries...>
make() {
  local out="$1" size="$2" style="$3" ref=""
  shift 3
  mkdir -p "$out"
  for entry in "$@"; do
    local id="${entry%%|*}" desc="${entry#*|}"
    if [ -f "$out/$id.png" ] && [ -z "${FORCE:-}" ]; then echo "exists $id"; ref="${ref:-$out/$id.png}"; continue; fi
    rm -f "$TMP"/*.png
    node tools/openrouter/assets.mjs icon "$desc" --dir "$TMP" --size "$size" --style "$style" ${ref:+--ref "$ref"} ${MODEL_ARGS:-} 2>&1 | grep -v -i "warning\|trace-warn" || true
    local f
    f=$(ls -t "$TMP"/*.png 2>/dev/null | head -1)
    [ -n "$f" ] || { echo "failed: $id"; continue; }
    mv "$f" "$out/$id.png"
    echo "  -> $out/$id.png"
    ref="${ref:-$out/$id.png}"
  done
}
make godot/game/ui/hud 96 "$HUD_STYLE" "${HUD[@]}"
make "$OUT" 128 "$STYLE" "${ITEMS[@]}"
