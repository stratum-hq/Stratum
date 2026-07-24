#!/usr/bin/env bash
#
# Server side release guard.
#
# Runs as the first job of .github/workflows/publish.yml and decides whether a
# pushed tag is a deliberate release. Everything downstream of it publishes to
# npm, and an npm release cannot be cleanly unpublished.
#
# This exists because the local pre-push guard cannot be the only line of
# defence: `git push --no-verify` makes git skip every pre-push hook, and a
# fork or the GitHub UI never runs one at all. This guard runs no matter how the
# tag got here.
#
# A tag has to satisfy all three checks:
#
#   1. Named vMAJOR.MINOR.PATCH, optionally with a prerelease suffix. Rejects
#      scratch tags such as v-wip, vtest, v2-backup.
#   2. Annotated, not lightweight. `git tag v1.2.3` makes a lightweight tag and
#      is what an accident looks like. `git tag -a v1.2.3 -m ...` is a choice.
#   3. Pointing at a commit that is already on main. Rejects a tag cut from a
#      feature branch or from local work that was never reviewed.
#
# Usage: scripts/release-guard.sh <tag-name>

set -euo pipefail

tag=${1:-}

if [ -z "$tag" ]; then
	echo "release-guard: no tag name given" >&2
	exit 2
fi

fail() {
	echo >&2
	echo "release-guard: REFUSING to publish from tag '$tag'." >&2
	echo >&2
	for line in "$@"; do
		if [ -n "$line" ]; then printf '  %s\n' "$line" >&2; else echo >&2; fi
	done
	echo >&2
	echo "  See CONTRIBUTING.md, \"Forbidden actions\", for how a release is cut." >&2
	echo >&2
	exit 1
}

# 1. Name shape.
if ! [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
	fail "'$tag' is not a release version." \
		"Release tags are vMAJOR.MINOR.PATCH, optionally with a prerelease" \
		"suffix, for example v1.2.3 or v1.2.3-rc.1."
fi

ref="refs/tags/$tag"

if ! git rev-parse --verify --quiet "$ref" >/dev/null; then
	fail "$ref is not present in this checkout." \
		"The publish workflow needs the tag itself, so checkout must fetch tags."
fi

# 2. Annotated, not lightweight.
object_type=$(git cat-file -t "$ref")
if [ "$object_type" != "tag" ]; then
	fail "$ref is a lightweight tag." \
		"A release tag has to be annotated, which is the difference between" \
		"'git tag $tag' and a deliberate release:" \
		"" \
		"    git tag -a $tag -m 'Release $tag'"
fi

# 3. Already on main.
commit=$(git rev-parse "$ref^{commit}")

main_ref=origin/main
if ! git rev-parse --verify --quiet "$main_ref" >/dev/null; then
	git fetch --no-tags --quiet origin main
	main_ref=FETCH_HEAD
fi

if ! git merge-base --is-ancestor "$commit" "$main_ref"; then
	fail "$commit is not on main." \
		"A release ships reviewed code. Land the release commit on main through" \
		"a pull request, then tag the commit on main."
fi

echo "release-guard: '$tag' is annotated, well formed, and on main. Publishing."
