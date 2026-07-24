#!/bin/sh
#
# Stratum forbidden action guards.
#
# Mechanical enforcement of the rules in "Forbidden actions" in CLAUDE.md. The
# hooks in this directory are thin; the logic lives here so it can be tested
# directly:
#
#   printf '%s\n' "refs/tags/v9.9.9 <sha> refs/tags/v9.9.9 0000000" \
#     | .githooks/forbidden-actions.sh pre-push
#
# Guards
#
#   pre-push    no tag ref may reach a remote
#               no push to main
#               no force-push or deletion of main
#   pre-commit  no commit while HEAD is on main
#
# Escape hatches are documented in CONTRIBUTING.md, "Forbidden actions".

set -u

PROTECTED_BRANCH=main

blocked=0

fail() {
	blocked=1
	printf '\n' >&2
	while [ "$#" -gt 0 ]; do
		printf '%s\n' "$1" >&2
		shift
	done
}

# A ref update sha is all zeros when the ref is being created (remote side) or
# deleted (local side). Width varies between sha1 and sha256 repositories.
is_zero() {
	case "$1" in
	*[!0]*) return 1 ;;
	*) return 0 ;;
	esac
}

# ---------------------------------------------------------------------------
# pre-push
# ---------------------------------------------------------------------------
#
# git feeds one line per ref being pushed on stdin:
#
#   <local ref> <local sha> <remote ref> <remote sha>
#
# This covers every route a ref can take to a remote, so `git push --tags`,
# `git push --follow-tags`, `git push origin v1.2.3` and
# `git push origin refs/tags/v1.2.3` all arrive here identically.

# Tags are collected rather than reported one by one: `git push --tags` can
# carry dozens of them and the explanation only needs saying once.
blocked_tags=""

guard_tag_push() {
	remote_ref="$1"
	tag=${remote_ref#refs/tags/}

	if [ "${STRATUM_RELEASE_TAG:-}" = "$tag" ]; then
		printf 'pre-push: STRATUM_RELEASE_TAG=%s set, allowing this tag.\n' "$tag" >&2
		return 0
	fi

	blocked=1
	blocked_tags="$blocked_tags $tag"
}

report_blocked_tags() {
	[ -n "$blocked_tags" ] || return 0

	count=0
	for t in $blocked_tags; do
		count=$((count + 1))
		example=${example:-$t}
	done

	if [ "$count" -eq 1 ]; then
		fail "pre-push: BLOCKED, refusing to push tag '$example'." ""
	else
		fail "pre-push: BLOCKED, refusing to push $count tags:" ""
		for t in $blocked_tags; do
			printf '    %s\n' "$t" >&2
		done
		printf '\n' >&2
	fi

	cat >&2 <<EOF
  .github/workflows/publish.yml triggers on 'push: tags: [v*]' and publishes
  every non-private package under packages/ to npm using OIDC trusted
  publishing. There is no token to be missing. An npm release cannot be
  cleanly unpublished.

  If this is a real release, name the exact tag you intend to ship:

    STRATUM_RELEASE_TAG=$example git push origin refs/tags/$example

  That unlocks that one tag and nothing else, so a --tags push carrying
  other stale tags still stops here.
EOF
}

guard_main_push() {
	local_sha="$1"
	remote_sha="$2"

	if is_zero "$local_sha"; then
		fail \
			"pre-push: BLOCKED, refusing to delete origin/$PROTECTED_BRANCH."
		return 0
	fi

	# A fast-forward leaves the old remote tip as an ancestor of the new one.
	# Anything else rewrites published history. Treat an unresolvable remote
	# sha as a rewrite: it usually means the remote has commits this clone has
	# never seen.
	if is_zero "$remote_sha" ||
		git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
		if [ "${STRATUM_ALLOW_MAIN_PUSH:-}" = "1" ]; then
			printf 'pre-push: STRATUM_ALLOW_MAIN_PUSH=1 set, allowing push to %s.\n' \
				"$PROTECTED_BRANCH" >&2
			return 0
		fi
		fail \
			"pre-push: BLOCKED, refusing to push directly to $PROTECTED_BRANCH." \
			"" \
			"  Work on a branch and open a pull request. main is the changesets base" \
			"  branch and the branch CI and the npm README point at." \
			"" \
			"  To override, deliberately:" \
			"" \
			"    STRATUM_ALLOW_MAIN_PUSH=1 git push origin $PROTECTED_BRANCH"
		return 0
	fi

	if [ "${STRATUM_ALLOW_MAIN_FORCE_PUSH:-}" = "1" ]; then
		printf 'pre-push: STRATUM_ALLOW_MAIN_FORCE_PUSH=1 set, allowing rewrite of %s.\n' \
			"$PROTECTED_BRANCH" >&2
		return 0
	fi

	fail \
		"pre-push: BLOCKED, refusing to rewrite the history of $PROTECTED_BRANCH." \
		"" \
		"  The published tip is not an ancestor of what you are pushing, so this" \
		"  drops commits that are already on the remote:" \
		"" \
		"    remote  $remote_sha" \
		"    local   $local_sha" \
		"" \
		"  This repository's history was deliberately cleaned in July 2026 and the" \
		"  current history is the intended history." \
		"" \
		"  To override, deliberately:" \
		"" \
		"    STRATUM_ALLOW_MAIN_FORCE_PUSH=1 git push --force-with-lease origin $PROTECTED_BRANCH"
}

pre_push() {
	while read -r local_ref local_sha remote_ref remote_sha; do
		[ -n "$remote_ref" ] || continue

		case "$remote_ref" in
		refs/tags/*)
			guard_tag_push "$remote_ref"
			;;
		"refs/heads/$PROTECTED_BRANCH")
			guard_main_push "$local_sha" "$remote_sha"
			;;
		esac
	done

	report_blocked_tags

	if [ "$blocked" -eq 1 ]; then
		printf '\npre-push: push blocked by .githooks/forbidden-actions.sh.\n' >&2
		printf 'See CONTRIBUTING.md, "Forbidden actions".\n\n' >&2
		return 1
	fi

	return 0
}

# ---------------------------------------------------------------------------
# pre-commit
# ---------------------------------------------------------------------------

pre_commit() {
	branch=$(git symbolic-ref --quiet --short HEAD) || return 0
	[ "$branch" = "$PROTECTED_BRANCH" ] || return 0

	if [ "${STRATUM_ALLOW_MAIN_COMMIT:-}" = "1" ]; then
		printf 'pre-commit: STRATUM_ALLOW_MAIN_COMMIT=1 set, allowing commit on %s.\n' \
			"$PROTECTED_BRANCH" >&2
		return 0
	fi

	fail \
		"pre-commit: BLOCKED, refusing to commit directly to $PROTECTED_BRANCH." \
		"" \
		"  Move the work to a branch and open a pull request:" \
		"" \
		"    git checkout -b feat/my-change" \
		"" \
		"  Your staged changes survive the branch switch." \
		"" \
		"  To override, deliberately:" \
		"" \
		"    STRATUM_ALLOW_MAIN_COMMIT=1 git commit"

	printf '\nSee CONTRIBUTING.md, "Forbidden actions".\n\n' >&2
	return 1
}

case "${1:-}" in
pre-push) pre_push ;;
pre-commit) pre_commit ;;
*)
	printf 'usage: forbidden-actions.sh pre-push|pre-commit\n' >&2
	exit 2
	;;
esac
