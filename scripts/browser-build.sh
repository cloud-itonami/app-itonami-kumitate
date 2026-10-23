#!/bin/sh
# kumitate's browser build (JUN-346, JUN-353 Phase 3). POSIX sh only: no Node,
# Python, JVM or C. Run it on arm64 Linux from the repo root (README
# "ブラウザ"), with Amu's pinned root and Worker host taken from one Amu commit
# by git show (README), and that commit:
#
#   scripts/browser-build.sh ROOT.elf HOST.js AMU_COMMIT
#
# It writes, deterministically from the sources and the root:
#   aiueos/kumitate.wasm                   the module (wasm32-browser-static/v1)
#   aiueos/kumitate.wasm.provenance.edn    compiler, units, output
#   aiueos/kumitate.wasm.publication.edn   :kotoba.output-set/v1 commit marker
#   web/kumitate.wasm.js                   the module as a script (the page has
#                                          connect-src 'none', so no fetch)
#   web/kotoba-host.js                     Amu's Worker host at AMU_COMMIT
# Take ROOT.elf and HOST.js with git show from AMU_COMMIT, never from a working
# tree: the provenance names that commit.
set -eu
ROOT_IN=$1
HOST_IN=$2
COMMIT=$3
ROOT_PATH=seed/bootstrap/aarch64-linux-static-root.elf
HOST_PATH=runtime/wasm32-browser-static-host.js
G=$(mktemp -d)
trap 'rm -rf "$G"' EXIT
sha() { sha256sum "$1" | cut -d' ' -f1; }
size() { wc -c < "$1" | tr -d ' '; }

cp "$ROOT_IN" "$G/root.elf"
chmod +x "$G/root.elf"
grep -v '^#' kotoba/kumitate/MANIFEST | while read -r p; do cat "$p"; echo; done > "$G/MANIFEST.kotoba"
KEXE_CAP_RESOURCES_35=$G "$G/root.elf" compile "$G/MANIFEST.kotoba" --target wasm32-browser --output "$G/kumitate.wasm" > "$G/compile.out"
cp "$G/kumitate.wasm" aiueos/kumitate.wasm
cp "$HOST_IN" web/kotoba-host.js

W=aiueos/kumitate.wasm
P=aiueos/kumitate.wasm.provenance.edn
{
  printf ';; kumitate.wasm provenance (scripts/browser-build.sh). Not the hosted compiler'"'"'s\n'
  printf ';; :kotoba.provenance/v1: the Amu selfhost root has no provenance output, so this\n'
  printf ';; names the root, the unit and the output by their sha256.\n'
  printf '{:format :kumitate.wasm-provenance/v1\n'
  printf ' :target :wasm32-browser-static/v1\n'
  printf ' :compiler {:repo "kotoba-lang/amu" :commit "%s" :path "%s" :sha256 "%s"}\n' "$COMMIT" "$ROOT_PATH" "$(sha "$G/root.elf")"
  printf ' :command "compile MANIFEST.kotoba --target wasm32-browser --output kumitate.wasm"\n'
  printf ' :compile-result "%s"\n' "$(sed 's/"/\\"/g' "$G/compile.out" | tr -d '\n')"
  printf ' :unit {:manifest "kotoba/kumitate/MANIFEST" :manifest-sha256 "%s" :sha256 "%s" :size %s}\n' \
    "$(sha kotoba/kumitate/MANIFEST)" "$(sha "$G/MANIFEST.kotoba")" "$(size "$G/MANIFEST.kotoba")"
  printf ' :host {:repo "kotoba-lang/amu" :commit "%s" :path "%s" :sha256 "%s"}\n' "$COMMIT" "$HOST_PATH" "$(sha web/kotoba-host.js)"
  printf ' :output {:name "kumitate.wasm" :sha256 "%s" :size %s}}\n' "$(sha "$W")" "$(size "$W")"
} > "$P"

# the marker's own sha256 is over its payload printed without it (amu ADR 0254)
PAYLOAD=$(printf '{:format :kotoba.output-set/v1, :files [{:role :artifact, :name "kumitate.wasm", :sha256 "%s", :size %s} {:role :provenance, :name "kumitate.wasm.provenance.edn", :sha256 "%s", :size %s}]' \
  "$(sha "$W")" "$(size "$W")" "$(sha "$P")" "$(size "$P")")
printf '%s}' "$PAYLOAD" > "$G/payload"
printf '%s, :sha256 "%s"}' "$PAYLOAD" "$(sha "$G/payload")" > aiueos/kumitate.wasm.publication.edn

{
  printf '// generated from aiueos/kumitate.wasm by scripts/browser-build.sh; do not edit\n'
  printf 'window.KUMITATE_WASM = {"sha256": "%s", "compiler": "the Amu selfhost root %s", "base64": "' "$(sha "$W")" "$(sha "$G/root.elf" | cut -c1-16)"
  base64 -w 0 < "$W"
  printf '"};\n'
} > web/kumitate.wasm.js
cat "$G/compile.out"
sha256sum aiueos/kumitate.wasm aiueos/kumitate.wasm.provenance.edn aiueos/kumitate.wasm.publication.edn web/kumitate.wasm.js web/kotoba-host.js
