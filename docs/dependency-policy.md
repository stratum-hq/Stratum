# Dependency policy

```bash
npm run lint:deps          # check, exit 1 on any drift
npm run lint:deps:write    # regenerate the baseline from `npm audit`
```

`npm audit` reports real findings in this tree today, across every severity. Gating at zero
would block every push, so this is a **ratchet**: it records the count at each severity,
fails when any count goes up, and fails when one goes down until the baseline is
regenerated and committed.

Failing on improvement is the part people argue with, so: a gate that only notices
regressions lets a stale baseline drift upward forever, because nobody has any reason to
regenerate it. Failing on the way down is what makes the number actually fall.

The check fixes nothing. Remediating the existing findings is separate work with real
breaking-change risk, and it does not belong in a gate.

## Two scopes

| Scope | Command | What it measures |
|-------|---------|------------------|
| `runtime` | `npm audit --omit=dev` | What reaches anyone who installs a published `@stratum-hq` package. |
| `all` | `npm audit` | The above plus the build and test toolchain. |

Both are ratcheted independently, per severity. Tracking only a total would hide the
escalation that matters most: a finding moving from dev-only into the runtime tree does not
change the total at all, but it changes who is exposed. When a `runtime` count rises, the
failure output says so explicitly and tells you to treat it as the higher priority.

Most of the `all` number is the toolchain. `runtime` is the number worth arguing about.

## Counts only, on purpose

The baseline records severity counts and nothing else. No package names, no advisory ids,
no versions.

This repository is public. Severity counts are already public to anyone who can run
`npm audit`, but a committed file that names vulnerable packages and the paths that reach
them is a convenience for somebody scanning for targets, and it stays accurate long after
the finding is fixed. The same rule applies to commit messages, PR bodies and code comments
in this repo.

**The cost is real and you should know it:** a like-for-like swap passes. If one high
severity finding is fixed in the same change that introduces another, the count is
unchanged and the check says nothing. Recording advisory identity would close that gap. It
is not worth the disclosure, and `npm audit` is one command away for anyone who needs the
detail.

## Reading a failure

Counts went up:

```
The dependency vulnerability surface grew.

  runtime  high: 2 -> 3
  all  critical: 0 -> 1
  all  high: 5 -> 6

Either something you added pulled in a vulnerable package, or an advisory
was published upstream against something already here. `npm audit` tells you
which; it is not repeated in this output or in the baseline, because this
repository is public.
```

Both causes are common, and the check cannot tell them apart, because telling them apart
requires the identity it deliberately does not store. Run `npm audit` yourself.

- **Something you added.** Remove or upgrade it. That is the fix.
- **A new upstream advisory** against a package that was already here. Nothing you did, but
  it is now your build that is failing. Upgrade if there is a fix; otherwise regenerating
  the baseline is the escape hatch, and it needs a reviewer to agree in the pull request.
  Regenerating after a rise is not remediation, it is raising the ceiling.

Counts went down:

```
The dependency vulnerability surface shrank. Lock the improvement in:

  runtime  high: 4 -> 3

Run `npm run lint:deps:write` and commit the baseline.
```

Do exactly that. The failure is the mechanism, not an obstacle.

## Offline and registry failures

`npm audit` exits non-zero whenever it finds anything, which is the normal case here, so a
non-zero exit is not treated as an error and stdout still holds the report. A genuine
failure shows up as output that will not parse, and the check fails loudly on it:

```
`npm audit --json --omit=dev` did not return a report.
That usually means the registry is unreachable or the lockfile is out of
date. This check fails rather than assuming zero, because assuming zero
would silently reset the ratchet. Run `npm ci` and try again.
```

Failing closed matters here. Treating an unreachable registry as "no vulnerabilities" would
let one offline run regenerate the baseline to all zeros, and every run after it would pass.

This is the one part of the gate that needs the network. Both audits together take a couple
of seconds.

## Baseline format

`scripts/dependency-baseline.json` is generated. Do not hand-edit it.

```json
{
  "generated": "2026-07-24",
  "scopes": {
    "runtime": { "critical": 0, "high": 3, "moderate": 1, "low": 1, "info": 0 },
    "all": { "critical": 1, "high": 6, "moderate": 11, "low": 1, "info": 0 }
  }
}
```

The `generated` date is there so a reviewer can see how stale a baseline is without reading
the git log.
