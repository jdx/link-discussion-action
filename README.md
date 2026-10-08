# link-discussion-action

A GitHub Action that bridges pull requests and GitHub Discussions.

GitHub natively links PRs to **issues** via `closes #123` keywords, but **Discussions have no such mechanism** — there is no "Linked pull requests" sidebar on discussions, and `closes #N` will not close a discussion. This Action fills that gap.

When a pull request is merged, it scans the PR body for discussion references and:

- Posts a comment on each referenced discussion with a link back to the PR.
- Closes the discussion (reason: `RESOLVED`) if a closing keyword (`closes`, `fixes`, `resolves`, ...) was used.

## Usage

```yaml
# .github/workflows/link-discussion.yml
name: Link Discussions

on:
  pull_request:
    types: [closed]

permissions:
  discussions: write
  pull-requests: read

jobs:
  link:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gaojunran/link-discussion-action@v0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Supported syntax

All GitHub-native linking keywords work. If the referenced number is a **discussion**, this Action handles it; if it is an **issue**, GitHub's native linking takes over and the Action skips it.

| Keyword | Example | Behavior |
|---------|---------|----------|
| `closes` / `close` / `closed` | `Closes #42` | Comment + close discussion |
| `fixes` / `fix` / `fixed` | `Fixes discussion #42` | Comment + close discussion |
| `resolves` / `resolve` / `resolved` | `Resolves #42` | Comment + close discussion |
| `refs` / `ref` / `reference` / `references` | `Refs #42` | Comment only |
| `Discussion: #N` | `Discussion: #42` | Comment only |

The optional `discussion` prefix (`closes discussion #42`) is accepted but not required — the Action checks whether the number refers to a discussion at runtime via the GraphQL API.

### Example PR body

```markdown
This implements the design from discussion #42.

Closes #42
Refs #17
Discussion: #8
```

On merge:

- Discussion #42 gets a comment and is closed (`RESOLVED`).
- Discussion #17 and #8 get a comment only.

## Why?

GitHub issues, pull requests, and discussions share a single number space within a repository, but only issues support the `closes #N` auto-close mechanism. Discussions lack a "Linked pull requests" sidebar entirely (confirmed via the [GraphQL `Discussion` type](https://docs.github.com/en/graphql/reference/discussions), which has no `linkedPullRequests` field). This Action provides the missing link for teams that use Discussions for design/Q&A and PRs for implementation.

## Inputs

| Name | Description | Default |
|------|-------------|---------|
| `github-token` | Token with `discussions:write` permission | `${{ github.token }}` |
| `mode` | `link` for merged PRs, or `release` for shipped-fix comments | `link` |
| `tag` | Published release tag (required in `release` mode) | — |
| `tag-pattern` | Regex guard for this repository's release family | `^v[0-9][0-9A-Za-z._+-]*$` |
| `marker-prefix` | Repository-specific idempotency marker | `fixed-in` |
| `upgrade-text` | Optional upgrade guidance appended to comments | — |
| `dry-run` | Print intended release comments without posting | `false` |

## Release notification mode

Run this after a release is actually published (or invoke it from the publishing
workflow when that release used `GITHUB_TOKEN`, because that token does not
trigger a downstream `release` workflow). It finds merged squash PRs between the
nearest contained stable release and `tag`, then comments only on same-repository
closed issues and discussions explicitly named by a closing keyword. It never
closes, reopens, or comments on an open discussion.

```yaml
- uses: jdx/link-discussion-action@<reviewed-sha>
  with:
    mode: release
    github-token: ${{ secrets.GITHUB_TOKEN }}
    tag: ${{ github.ref_name }}
    marker-prefix: hk-fixed-in
    upgrade-text: Update with `mise use hk@latest`.
```

Use a repository-specific `tag-pattern` for workspace or multi-package releases.
The marker makes retries safe. A run fails with an itemized summary if any
individual read or comment fails, so a manual rerun can recover safely.

## Permissions

The workflow must declare `discussions: write` (and `pull-requests: read`). The default `GITHUB_TOKEN` works if the workflow sets the permission explicitly, as shown in the usage example above.

## Limitations

- Only references within the same repository are supported (`#42`, not `owner/repo#42`).
- A discussion is only closed if it is still open; already-closed discussions get the comment but no duplicate close.
- If a referenced number is an issue or PR (not a discussion), it is skipped — GitHub's native `closes #N` handles issues.

## License

MIT
