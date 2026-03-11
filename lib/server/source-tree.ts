import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/server/errors";
import { getServerDebateEnv } from "@/lib/server/env";
import {
  createSourceId,
  createSourceTree,
  getSourceSizeLimit,
  isIgnoredPath,
  isSupportedSourceFile,
  normalizeSourcePath,
  type SourceTreeFileRecord
} from "@/lib/server/source-common";
import type {
  GitHubRepoRef,
  GitHubSourceTreeResponse,
  GitHubTreeRequestPayload,
  LocalRepoTreeRequestPayload,
  WorkspaceSourceTreeResponse
} from "@/lib/types";

const GITHUB_API_BASE_URL = "https://api.github.com";

type GitHubTreeItem = {
  path?: string;
  type?: "blob" | "tree";
  size?: number;
  sha?: string;
};

type GitHubRepoPayload = {
  default_branch?: string;
};

function buildGitHubHeaders(token: string): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getLocalRepoBaseDir(): string {
  return getServerDebateEnv().localRepoBaseDir;
}

function resolveLocalRepoRootPath(repoPath: string): { basePath: string; rootPath: string } {
  const basePath = getLocalRepoBaseDir();
  const trimmed = repoPath.trim();

  if (!trimmed) {
    throw new AppError("missing_local_repo_path", "Local repo path is required.", 400);
  }

  const rootPath = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(basePath, trimmed);
  const relativeFromBase = path.relative(basePath, rootPath);

  if (relativeFromBase.startsWith("..") || path.isAbsolute(relativeFromBase)) {
    throw new AppError(
      "invalid_local_repo_path",
      `Local repo path must stay inside ${basePath}.`,
      400
    );
  }

  return {
    basePath,
    rootPath
  };
}

function buildGitHubErrorMessage(status: number, message: string): string {
  if (status === 401 || status === 403) {
    return "GitHub rejected the token or its repository access scope.";
  }

  if (status === 404) {
    return message || "GitHub could not find that repository or ref.";
  }

  return message || `GitHub returned HTTP ${status}.`;
}

function parseGitHubRepoUrl(repoUrl: string): Omit<GitHubRepoRef, "ref"> {
  const trimmed = repoUrl.trim();

  if (!trimmed) {
    throw new AppError("missing_repo_url", "GitHub repository URL is required.", 400);
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError("invalid_repo_url", "GitHub repository URL is invalid.", 400);
  }

  if (!/github\.com$/i.test(parsed.hostname)) {
    throw new AppError("invalid_repo_url", "Only github.com repository URLs are supported.", 400);
  }

  const segments = parsed.pathname.replace(/\.git$/i, "").split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new AppError("invalid_repo_url", "GitHub repository URL must include owner and repo.", 400);
  }

  const owner = segments[0] || "";
  const name = segments[1] || "";
  const url = `https://github.com/${owner}/${name}`;

  return { owner, name, url };
}

async function fetchGitHubJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(token),
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as
    | { message?: string; tree?: GitHubTreeItem[]; truncated?: boolean }
    | T
    | null;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message || "").trim()
        : "";

    throw new AppError("github_error", buildGitHubErrorMessage(response.status, message), 502);
  }

  return payload as T;
}

async function readWorkspaceDirectory(input: {
  absolutePath: string;
  relativePath: string;
  files: SourceTreeFileRecord[];
  warnings: string[];
}): Promise<void> {
  const entries = await fs.readdir(input.absolutePath, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }))) {
    const relativePath = normalizeSourcePath(
      input.relativePath ? `${input.relativePath}/${entry.name}` : entry.name
    );

    if (isIgnoredPath(relativePath)) {
      continue;
    }

    const absolutePath = path.join(input.absolutePath, entry.name);

    if (entry.isDirectory()) {
      await readWorkspaceDirectory({
        absolutePath,
        relativePath,
        files: input.files,
        warnings: input.warnings
      });
      continue;
    }

    if (!entry.isFile() || !isSupportedSourceFile(relativePath)) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    const sizeLimit = getSourceSizeLimit(relativePath);

    if (stat.size > sizeLimit) {
      input.warnings.push(`${relativePath} was hidden because it exceeds the supported size limit.`);
      continue;
    }

    input.files.push({
      id: createSourceId("workspace", relativePath),
      origin: "workspace",
      label: relativePath,
      path: relativePath,
      size: stat.size
    });
  }
}

export async function getWorkspaceFileRecords(request: LocalRepoTreeRequestPayload): Promise<{
  basePath: string;
  rootLabel: string;
  rootPath: string;
  files: SourceTreeFileRecord[];
  warnings: string[];
}> {
  const { basePath, rootPath } = resolveLocalRepoRootPath(request.repoPath || "");
  const files: SourceTreeFileRecord[] = [];
  const warnings: string[] = [];
  const stat = await fs.stat(rootPath).catch(() => null);

  if (!stat || !stat.isDirectory()) {
    throw new AppError("invalid_local_repo_path", "Local repo path must point to a directory.", 400);
  }

  await readWorkspaceDirectory({
    absolutePath: rootPath,
    relativePath: "",
    files,
    warnings
  });

  return {
    basePath,
    rootLabel: path.basename(rootPath),
    rootPath,
    files,
    warnings
  };
}

async function resolveGitHubRef(input: {
  repoUrl: string;
  ref?: string;
  token: string;
}): Promise<GitHubRepoRef> {
  const repo = parseGitHubRepoUrl(input.repoUrl);

  if (input.ref?.trim()) {
    return {
      ...repo,
      ref: input.ref.trim()
    };
  }

  const metadata = await fetchGitHubJson<GitHubRepoPayload>(
    `${GITHUB_API_BASE_URL}/repos/${repo.owner}/${repo.name}`,
    input.token
  );

  return {
    ...repo,
    ref: metadata.default_branch || "main"
  };
}

export async function getGitHubFileRecords(
  request: GitHubTreeRequestPayload
): Promise<{
  repo: GitHubRepoRef;
  files: SourceTreeFileRecord[];
  warnings: string[];
}> {
  const token = request.githubToken?.trim() || "";
  const repo = await resolveGitHubRef({
    repoUrl: request.repoUrl || "",
    ref: request.ref,
    token
  });
  const payload = await fetchGitHubJson<{ tree?: GitHubTreeItem[]; truncated?: boolean }>(
    `${GITHUB_API_BASE_URL}/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`,
    token
  );
  const warnings: string[] = [];

  if (payload.truncated) {
    warnings.push("GitHub truncated the repository tree. Narrow the ref or selection if files are missing.");
  }

  const files = (payload.tree || [])
    .filter((item) => item.type === "blob" && typeof item.path === "string")
    .map((item) => ({
      path: normalizeSourcePath(item.path || ""),
      size: typeof item.size === "number" ? item.size : 0,
      sha: item.sha || ""
    }))
    .filter((item) => item.path && !isIgnoredPath(item.path))
    .filter((item) => isSupportedSourceFile(item.path))
    .filter((item) => {
      const sizeLimit = getSourceSizeLimit(item.path);

      if (item.size > sizeLimit) {
        warnings.push(`${item.path} was hidden because it exceeds the supported size limit.`);
        return false;
      }

      return true;
    })
    .map(
      (item): SourceTreeFileRecord => ({
        id: createSourceId("github", item.path, repo.url, repo.ref),
        origin: "github",
        label: item.path,
        path: item.path,
        size: item.size,
        repoUrl: repo.url,
        ref: repo.ref,
        sha: item.sha
      })
    );

  return {
    repo,
    files,
    warnings
  };
}

export async function fetchGitHubFileBuffer(input: {
  repo: GitHubRepoRef;
  sha?: string;
  filepath: string;
  githubToken?: string;
}): Promise<Buffer> {
  const token = input.githubToken?.trim() || "";

  if (input.sha) {
    const payload = await fetchGitHubJson<{ content?: string; encoding?: string }>(
      `${GITHUB_API_BASE_URL}/repos/${input.repo.owner}/${input.repo.name}/git/blobs/${input.sha}`,
      token
    );

    if (payload.encoding === "base64" && payload.content) {
      return Buffer.from(payload.content.replace(/\n/g, ""), "base64");
    }
  }

  const fallback = await fetch(
    `https://raw.githubusercontent.com/${input.repo.owner}/${input.repo.name}/${encodeURIComponent(
      input.repo.ref
    )}/${input.filepath}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: "no-store"
    }
  );

  if (!fallback.ok) {
    throw new AppError(
      "github_error",
      buildGitHubErrorMessage(fallback.status, `GitHub could not load ${input.filepath}.`),
      502
    );
  }

  return Buffer.from(await fallback.arrayBuffer());
}

export async function getWorkspaceSourceTree(
  request: LocalRepoTreeRequestPayload
): Promise<WorkspaceSourceTreeResponse> {
  const workspace = await getWorkspaceFileRecords(request);

  return {
    basePath: workspace.basePath,
    rootLabel: workspace.rootLabel,
    rootPath: workspace.rootPath,
    nodes: createSourceTree(workspace.files),
    warnings: workspace.warnings,
    fetchedAt: new Date().toISOString()
  };
}

export async function getGitHubSourceTree(
  request: GitHubTreeRequestPayload
): Promise<GitHubSourceTreeResponse> {
  const tree = await getGitHubFileRecords(request);

  return {
    repo: tree.repo,
    nodes: createSourceTree(tree.files),
    warnings: tree.warnings,
    fetchedAt: new Date().toISOString()
  };
}
