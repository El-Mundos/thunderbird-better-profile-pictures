#!/usr/bin/env bash
# Package the add-on as an installable .xpi in dist/.
#
# The output is reproducible: the file list is sorted, every entry gets a fixed
# timestamp, and zip's extra attributes are stripped. Two builds of the same
# tree are therefore byte-identical, which is what let the 2.5.1 tree be
# verified against the previously installed xpi.
set -euo pipefail

cd "$(dirname "$0")"

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
name=better_profile_pictures-${version}
dist=dist
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# Everything git tracks is shipped, minus the repo's own tooling. Using
# git ls-files means an untracked scratch file can never leak into a release.
git ls-files -z \
  | grep -zv '^\(build\.sh\|\.gitignore\|README\.md\)$\|\.xpi$' \
  | while IFS= read -r -d '' f; do
      mkdir -p "$stage/$(dirname "$f")"
      cp "$f" "$stage/$f"
    done

find "$stage" -exec touch -t 200001010000 {} +

mkdir -p "$dist"
rm -f "$dist/$name.xpi"
( cd "$stage" && find . -type f -printf '%P\n' | LC_ALL=C sort \
    | zip -q -X -9 -@ "$OLDPWD/$dist/$name.xpi" )

printf '%s  (%s)\n' "$dist/$name.xpi" "$(du -h "$dist/$name.xpi" | cut -f1)"
printf 'sha256  %s\n' "$(sha256sum "$dist/$name.xpi" | cut -d' ' -f1)"
