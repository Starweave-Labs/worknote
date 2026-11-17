/** Opt-in versioning of private data only; never discover a parent source repository. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { sourceRoot } from "./environment.js";

// Runtime secrets and source files are intentionally not eligible for snapshots or rollback.
const DATA_PATHS = ["projects", "projects.json", "todo.md", "index.md", "inbox.md", "inbox"];

export type SnapshotResult = { ok: boolean; sha: string; committed: boolean; error?: string };

function git(root: string, args: string[]): string {
  // Explicit repositories must not be redirected by inherited Git environment variables or hooks.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root, ...args], {
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Default-off check; no Git subprocess is executed unless opt-in and a local .git directory exist. */
export function snapshotAvailability(root: string): { ok: boolean; error?: string } {
  if (process.env.WORKNOTE_GIT_SNAPSHOT !== "1") {
    return { ok: false, error: "未启用私有数据快照；L2 需先在数据根初始化 git，并设置 WORKNOTE_GIT_SNAPSHOT=1" };
  }
  try {
    const canonical = realpathSync(root);
    const source = realpathSync(sourceRoot);
    if (canonical === source || source.startsWith(canonical + sep)) {
      return { ok: false, error: "快照数据根必须独立于源码仓库，不能是源码目录或其祖先" };
    }
    const localGit = join(canonical, ".git");
    if (!existsSync(localGit) || !lstatSync(localGit).isDirectory()) {
      return { ok: false, error: "数据根自身需有独立 .git 目录；不支持借用祖先仓库、worktree 或符号链接" };
    }
    if (realpathSync(git(canonical, ["rev-parse", "--show-toplevel"])) !== canonical ||
        realpathSync(git(canonical, ["rev-parse", "--absolute-git-dir"])) !== localGit) {
      return { ok: false, error: "Git 仓库不属于此数据根，拒绝快照与回滚" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `数据快照不可用：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Snapshot only approved data paths; --only prevents unrelated pre-staged files from being committed. */
export function snapshotData(root: string, message: string, identity = "WorkNote Agent"): SnapshotResult {
  const availability = snapshotAvailability(root);
  if (!availability.ok) return { ok: false, sha: "", committed: false, error: availability.error };
  try {
    const paths = DATA_PATHS.filter((path) => existsSync(join(root, path)) || git(root, ["ls-files", "--", path]));
    if (!paths.length) return { ok: false, sha: "", committed: false, error: "数据根没有可快照的数据文件" };
    // Capture ignored data too: rollback must not silently omit original attachments/inbox contents.
    git(root, ["add", "-A", "-f", "--", ...paths]);
    let sha = "";
    try { sha = git(root, ["rev-parse", "--verify", "HEAD"]); } catch { /* initial snapshot */ }
    const changed = git(root, ["diff", "--cached", "--name-only", "--", ...paths]);
    let committed = false;
    if (!sha || changed) {
      git(root, ["-c", `user.name=${identity}`, "-c", "user.email=local@worknote.invalid", "commit", "--only", "-m", message, "-q", "--", ...paths]);
      sha = git(root, ["rev-parse", "--verify", "HEAD"]);
      committed = true;
    }
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error("无法取得有效快照提交");
    return { ok: true, sha, committed };
  } catch (error) {
    return { ok: false, sha: "", committed: false, error: `数据快照失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Restore only approved data paths, including removal of files created after the baseline. */
export function restoreDataSnapshot(root: string, sha: string): { ok: boolean; error?: string } {
  const availability = snapshotAvailability(root);
  if (!availability.ok) return availability;
  if (!/^[a-f0-9]{40,64}$/.test(sha)) return { ok: false, error: "快照提交不合法" };
  try {
    // Restore pathspecs tracked either at the baseline or in the current index. restore also removes
    // newly tracked files absent at the baseline; clean handles untracked files created by tools.
    const paths = DATA_PATHS.filter((path) => git(root, ["ls-tree", "-r", "--name-only", sha, "--", path]) || git(root, ["ls-files", "--", path]));
    if (paths.length) git(root, ["restore", `--source=${sha}`, "--staged", "--worktree", "--", ...paths]);
    git(root, ["clean", "-fdx", "--", ...DATA_PATHS]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `数据回滚失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
