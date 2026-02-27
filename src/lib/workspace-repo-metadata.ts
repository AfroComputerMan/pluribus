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

async function runGit(
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const result = await Command.create("git", args, opts).execute();
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), code: result.code };
}

function parseRepoSlug(remoteUrl: string): {
  repoSlug: string | null;
  repoName: string | null;
  isGithub: boolean;
} {
  const githubSsh = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  const githubHttps = remoteUrl.match(/^https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
  const slug = githubSsh?.[1] ?? githubHttps?.[1] ?? null;
  if (!slug) return { repoSlug: null, repoName: null, isGithub: false };
  const repoName = slug.split("/").pop() ?? null;
  return { repoSlug: slug, repoName, isGithub: true };
}

export async function getWorkspaceRepoMeta(cwd: string): Promise<WorkspaceRepoMeta | null> {
  const rootResult = await runGit(["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0 || !rootResult.stdout) return null;
  const repoRoot = rootResult.stdout;

  const [branchResult, remoteResult, logResult, countsResult] = await Promise.all([
    runGit(["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(["-C", repoRoot, "config", "--get", "remote.origin.url"]),
    runGit(["-C", repoRoot, "log", "-1", "--format=%cI"]),
    runGit(["-C", repoRoot, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
  ]);

  const branch = branchResult.stdout || "";
  if (!branch) return null;

  const remoteUrl = remoteResult.code === 0 ? remoteResult.stdout || null : null;
  const lastCommitAt = logResult.code === 0 ? logResult.stdout || null : null;

  let behindCount: number | null = null;
  let aheadCount: number | null = null;
  if (countsResult.code === 0 && countsResult.stdout) {
    const parts = countsResult.stdout.split(/\s+/);
    const behind = Number.parseInt(parts[0] ?? "", 10);
    const ahead = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isNaN(behind)) behindCount = behind;
    if (!Number.isNaN(ahead)) aheadCount = ahead;
  }

  const repoNameFallback = repoRoot.split("/").pop() ?? repoRoot;
  const { repoSlug, repoName: parsedName, isGithub } = remoteUrl
    ? parseRepoSlug(remoteUrl)
    : { repoSlug: null, repoName: null, isGithub: false };

  return {
    repoRoot,
    repoName: parsedName ?? repoNameFallback,
    repoSlug,
    branch,
    remoteUrl,
    isGithub,
    lastCommitAt,
    behindCount,
    aheadCount,
  };
}

export async function listWorkspaceBranches(cwd: string): Promise<WorkspaceBranchOptions | null> {
  const rootResult = await runGit(["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0 || !rootResult.stdout) return null;
  const repoRoot = rootResult.stdout;

  const [branchResult, refsResult] = await Promise.all([
    runGit(["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads"]),
  ]);

  const currentBranch = branchResult.stdout || "";
  if (!currentBranch) return null;

  const branches = refsResult.stdout
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  return { repoRoot, currentBranch, branches };
}

export async function switchWorkspaceBranch(cwd: string, branch: string): Promise<boolean> {
  const target = branch.trim();
  if (!target) return false;
  const rootResult = await runGit(["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0 || !rootResult.stdout) return false;
  const result = await runGit(["-C", rootResult.stdout, "checkout", target]);
  return result.code === 0;
}

export async function createWorkspaceBranch(cwd: string, branch: string): Promise<boolean> {
  const target = branch.trim();
  if (!target) return false;
  const rootResult = await runGit(["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0 || !rootResult.stdout) return false;
  const result = await runGit(["-C", rootResult.stdout, "checkout", "-b", target]);
  return result.code === 0;
}
