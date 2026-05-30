# 🤖 GitHub Actions Auto-Deploy (issue → Claude fix → merge → live)

> The Care Plan goldmine: client requests a change → it becomes a GitHub issue → Claude fixes it on a branch →
> you review + merge → Vercel auto-deploys to production. Near-hands-off recurring maintenance.
> Set this up PER client repo (or your starter template, so every new site inherits it).

## What you get
- Comment **`@claude <request>`** on a GitHub issue/PR → Claude opens a PR with the fix.
- You review + merge → **Vercel auto-deploys**. Done from your phone.

## Setup (one-time per repo)

### Step 1 — Easiest path: the installer
In Claude Code (laptop), inside the repo, run:
```
/install-github-app
```
This installs the Claude GitHub App and writes the workflow file for you. Follow the prompts.

### Step 2 — Add your API key as a repo secret
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name: `ANTHROPIC_API_KEY`  → value: your Anthropic API key
- (Or use the OAuth token flow if you prefer your subscription.)

### Step 3 — (Manual alternative) the workflow file
If you set it up by hand instead of the installer, add `.github/workflows/claude.yml`:
```yaml
name: Claude
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```
> Action name/version evolves — prefer `/install-github-app` so it stays current.

### Step 4 — Connect Vercel for auto-deploy
- vercel.com → Add New Project → **import the GitHub repo**.
- Vercel auto-deploys **every push to `main`** (and gives preview URLs for PRs).
- Result: merge a Claude PR → live in ~1 min.

## The Care Plan loop (how you make money on it)
1. Client texts/emails a change.
2. You create a GitHub issue (from your phone) and comment `@claude <the change>`.
3. Claude opens a PR. Vercel posts a **preview link**.
4. You check the preview, merge → **auto-deploys live**.
5. Bill the monthly Care Plan. Minutes of work, recurring revenue.

## ⚠️ Notes
- Always **review the PR + preview** before merging (no blind merges on client sites).
- Watch API costs if using pay-as-you-go; the subscription/OAuth route avoids per-run charges.
