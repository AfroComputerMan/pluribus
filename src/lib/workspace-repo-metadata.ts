import { Command } from "@tauri-apps/plugin-shell";

export interface WorkspaceRepoMeta {
  repoRoot: string;
  repoName: string;
  repoSlug: string | null;
  branch: string;
  remoteUrl: string | null;
  isGithub: boolean;
  lastCommitAt: string | null;
  behindCount: number | null;
  aheadCount: number | null;
}

export interface WorkspaceBranchOptions {
  repoRoot: string;
  currentBranch: string;
  branches: string[];
}

const WORKSPACE_GIT_META_SCRIPT = `
repo_dir="$1"
repo_root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
remote_url="$(git -C "$repo_root" config --get remote.origin.url 2>/dev/null || true)"
last_commit_at="$(git -C "$repo_root" log -1 --format=%cI 2>/dev/null || true)"
counts="$(git -C "$repo_root" rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || true)"
behind=""
ahead=""
if [ -n "$counts" ]; then
  set -- $counts
  behind="$1"
  ahead="$2"
fi
repo_name="$(basename "$repo_root")"
repo_slug=""
is_github=0
if [ -n "$remote_url" ]; then
  case "$remote_url" in
    *github.com*)
      is_github=1
      repo_slug="$(printf '%s' "$remote_url" | sed -E 's#^git@github.com:##; s#^https?://github.com/##; s#\\.git$##')"
      if [ -n "$repo_slug" ]; then
        repo_name="\${repo_slug##*/}"
      fi
      ;;
  esac
fi
printf 'REPO_ROOT=%s\\n' "$repo_root"
printf 'REPO_NAME=%s\\n' "$repo_name"
printf 'REPO_SLUG=%s\\n' "$repo_slug"
printf 'BRANCH=%s\\n' "$branch"
printf 'REMOTE_URL=%s\\n' "$remote_url"
printf 'IS_GITHUB=%s\\n' "$is_github"
printf 'LAST_COMMIT_AT=%s\\n' "$last_commit_at"
printf 'BEHIND=%s\\n' "$behind"
printf 'AHEAD=%s\\n' "$ahead"
`;

function parseMeta(stdout: string): WorkspaceRepoMeta | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const map = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    map.set(key, value);
  }

  const repoRoot = map.get("REPO_ROOT")?.trim() ?? "";
  const repoName = map.get("REPO_NAME")?.trim() ?? "";
  const branch = map.get("BRANCH")?.trim() ?? "";
  if (!repoRoot || !repoName || !branch) return null;

  const repoSlug = map.get("REPO_SLUG")?.trim() || null;
  const remoteUrl = map.get("REMOTE_URL")?.trim() || null;
  const lastCommitAt = map.get("LAST_COMMIT_AT")?.trim() || null;

  const behindRaw = map.get("BEHIND")?.trim();
  const behindCount =
    behindRaw && !Number.isNaN(Number.parseInt(behindRaw, 10))
      ? Number.parseInt(behindRaw, 10)
      : null;

  const aheadRaw = map.get("AHEAD")?.trim();
  const aheadCount =
    aheadRaw && !Number.isNaN(Number.parseInt(aheadRaw, 10))
      ? Number.parseInt(aheadRaw, 10)
      : null;

  return {
    repoRoot,
    repoName,
    repoSlug,
    branch,
    remoteUrl,
    isGithub: map.get("IS_GITHUB")?.trim() === "1",
    lastCommitAt,
    behindCount,
    aheadCount,
  };
}

function parseKeyValueMap(stdout: string): Map<string, string> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    map.set(key, value);
  }
  return map;
}

export async function getWorkspaceRepoMeta(cwd: string): Promise<WorkspaceRepoMeta | null> {
  const command = Command.create("claude-stream-sh", ["-c", WORKSPACE_GIT_META_SCRIPT, "git-meta", cwd]);
  const result = await command.execute();
  if (result.code !== 0) return null;
  return parseMeta(result.stdout);
}

const LIST_BRANCHES_SCRIPT = `
repo_dir="$1"
repo_root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
printf 'REPO_ROOT=%s\\n' "$repo_root"
printf 'CURRENT_BRANCH=%s\\n' "$current_branch"
git -C "$repo_root" for-each-ref --format='BRANCH=%(refname:short)' refs/heads 2>/dev/null || true
`;

export async function listWorkspaceBranches(cwd: string): Promise<WorkspaceBranchOptions | null> {
  const command = Command.create("claude-stream-sh", ["-c", LIST_BRANCHES_SCRIPT, "list-branches", cwd]);
  const result = await command.execute();
  if (result.code !== 0) return null;

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const map = parseKeyValueMap(result.stdout);
  const repoRoot = map.get("REPO_ROOT")?.trim() ?? "";
  const currentBranch = map.get("CURRENT_BRANCH")?.trim() ?? "";
  if (!repoRoot || !currentBranch) return null;

  const branches = lines
    .filter((line) => line.startsWith("BRANCH="))
    .map((line) => line.slice("BRANCH=".length).trim())
    .filter(Boolean);

  return { repoRoot, currentBranch, branches };
}

const SWITCH_BRANCH_SCRIPT = `
repo_dir="$1"
next_branch="$2"
repo_root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 1
git -C "$repo_root" checkout "$next_branch" >/dev/null 2>&1
`;

export async function switchWorkspaceBranch(cwd: string, branch: string): Promise<boolean> {
  const target = branch.trim();
  if (!target) return false;
  const command = Command.create("claude-stream-sh", ["-c", SWITCH_BRANCH_SCRIPT, "switch-branch", cwd, target]);
  const result = await command.execute();
  return result.code === 0;
}

const CREATE_BRANCH_SCRIPT = `
repo_dir="$1"
next_branch="$2"
repo_root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)" || exit 1
git -C "$repo_root" checkout -b "$next_branch" >/dev/null 2>&1
`;

export async function createWorkspaceBranch(cwd: string, branch: string): Promise<boolean> {
  const target = branch.trim();
  if (!target) return false;
  const command = Command.create("claude-stream-sh", ["-c", CREATE_BRANCH_SCRIPT, "create-branch", cwd, target]);
  const result = await command.execute();
  return result.code === 0;
}
