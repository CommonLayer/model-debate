import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/server/errors";
import {
  SOURCE_LIMITS,
  buildExcerptCandidates,
  createSourceId,
  finalizeResolvedExcerpts,
  normalizeSourcePath,
  parseSourceDocument,
  type ExcerptCandidate,
  type ParsedSourceDocument
} from "@/lib/server/source-common";
import {
  fetchGitHubFileBuffer,
  getGitHubFileRecords,
  getWorkspaceFileRecords
} from "@/lib/server/source-tree";
import type {
  SourceFileRef,
  SourcePack,
  SourceResolveManifest
} from "@/lib/types";

type ResolveSourcePackInput = {
  manifest: SourceResolveManifest;
  uploadFiles: File[];
  githubToken: string;
};

function dedupePaths(paths: string[] | undefined): string[] {
  return [...new Set((paths || []).map((item) => normalizeSourcePath(item)).filter(Boolean))];
}

function buildWorkspaceAbsolutePath(rootPath: string, relativePath: string): string {
  const absolutePath = path.resolve(rootPath, relativePath);
  const relativeFromRoot = path.relative(rootPath, absolutePath);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot) ||
    normalizeSourcePath(relativeFromRoot) !== normalizeSourcePath(relativePath)
  ) {
    throw new AppError(
      "invalid_workspace_path",
      `Workspace path '${relativePath}' is outside the current workspace root.`,
      400
    );
  }

  return absolutePath;
}

function createUploadFileRef(file: File, index: number, labelOverride?: string): SourceFileRef {
  const filepath = normalizeSourcePath(labelOverride || file.name || `upload-${index + 1}`);

  return {
    id: createSourceId("upload", `${index + 1}-${filepath}`),
    origin: "upload",
    label: filepath,
    path: filepath,
    size: file.size
  };
}

function selectCandidates(candidates: ExcerptCandidate[]): ExcerptCandidate[] {
  const bySource = new Map<string, ExcerptCandidate[]>();

  for (const candidate of candidates) {
    const existing = bySource.get(candidate.sourceId) || [];
    existing.push(candidate);
    bySource.set(candidate.sourceId, existing);
  }

  for (const items of bySource.values()) {
    items.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.text.length !== left.text.length) {
        return right.text.length - left.text.length;
      }

      return left.locator.localeCompare(right.locator, "en", { sensitivity: "base" });
    });
  }

  const selected: ExcerptCandidate[] = [];
  const sourceCounts = new Map<string, number>();
  const sourceEntries = [...bySource.entries()];
  let rank = 0;

  while (selected.length < SOURCE_LIMITS.maxTotalExcerpts) {
    let added = false;

    for (const [sourceId, items] of sourceEntries) {
      const count = sourceCounts.get(sourceId) || 0;

      if (count >= SOURCE_LIMITS.maxExcerptsPerSource) {
        continue;
      }

      const candidate = items[rank];

      if (!candidate) {
        continue;
      }

      selected.push(candidate);
      sourceCounts.set(sourceId, count + 1);
      added = true;

      if (selected.length >= SOURCE_LIMITS.maxTotalExcerpts) {
        break;
      }
    }

    if (!added) {
      break;
    }

    rank += 1;
  }

  return selected;
}

async function parseFileRecord(
  file: SourceFileRef,
  loadBuffer: () => Promise<Buffer>,
  warnings: string[]
): Promise<ParsedSourceDocument | null> {
  try {
    const buffer = await loadBuffer();
    return await parseSourceDocument(file, buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${file.label}: ${message}`);
    return null;
  }
}

async function resolveWorkspaceDocuments(
  localRepoPath: string,
  paths: string[],
  warnings: string[]
): Promise<ParsedSourceDocument[]> {
  if (paths.length === 0) {
    return [];
  }

  const workspace = await getWorkspaceFileRecords({
    repoPath: localRepoPath
  });
  const recordByPath = new Map(workspace.files.map((record) => [record.path, record]));
  const documents: ParsedSourceDocument[] = [];

  for (const filepath of paths) {
    const record = recordByPath.get(filepath);

    if (!record) {
      warnings.push(`${filepath}: the file is not available in the current workspace tree.`);
      continue;
    }

    const file: SourceFileRef = {
      id: record.id,
      origin: "workspace",
      label: record.label,
      path: record.path,
      size: record.size
    };
    const absolutePath = buildWorkspaceAbsolutePath(workspace.rootPath, record.path);
    const document = await parseFileRecord(file, () => fs.readFile(absolutePath), warnings);

    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

async function resolveGitHubDocuments(
  manifest: SourceResolveManifest,
  githubToken: string,
  warnings: string[]
): Promise<ParsedSourceDocument[]> {
  const selection = manifest.githubSelection;
  const paths = dedupePaths(selection?.paths);

  if (!selection || paths.length === 0) {
    return [];
  }

  if (!selection.repoUrl?.trim()) {
    throw new AppError(
      "missing_repo_url",
      "GitHub sources were selected without a repository URL.",
      400
    );
  }

  const tree = await getGitHubFileRecords({
    repoUrl: selection.repoUrl,
    ref: selection.ref,
    githubToken
  });
  warnings.push(...tree.warnings);

  const recordByPath = new Map(tree.files.map((record) => [record.path, record]));
  const documents: ParsedSourceDocument[] = [];

  for (const filepath of paths) {
    const record = recordByPath.get(filepath);

    if (!record) {
      warnings.push(`${filepath}: the GitHub file could not be found under the selected repo/ref.`);
      continue;
    }

    const file: SourceFileRef = {
      id: record.id,
      origin: "github",
      label: record.label,
      path: record.path,
      repoUrl: record.repoUrl,
      ref: record.ref,
      size: record.size
    };
    const document = await parseFileRecord(
      file,
      () =>
        fetchGitHubFileBuffer({
          repo: tree.repo,
          sha: record.sha,
          filepath: record.path,
          githubToken
        }),
      warnings
    );

    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

async function resolveUploadDocuments(
  uploadFiles: File[],
  uploadLabels: string[] | undefined,
  warnings: string[]
): Promise<ParsedSourceDocument[]> {
  const documents: ParsedSourceDocument[] = [];

  for (const [index, uploadFile] of uploadFiles.entries()) {
    const file = createUploadFileRef(uploadFile, index, uploadLabels?.[index]);
    const document = await parseFileRecord(
      file,
      async () => Buffer.from(await uploadFile.arrayBuffer()),
      warnings
    );

    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

export async function resolveSourcePack(input: ResolveSourcePackInput): Promise<SourcePack> {
  const workspacePaths = dedupePaths(input.manifest.workspacePaths);
  const githubPaths = dedupePaths(input.manifest.githubSelection?.paths);
  const totalSelectedFiles = workspacePaths.length + githubPaths.length + input.uploadFiles.length;

  if (totalSelectedFiles > SOURCE_LIMITS.maxFilesPerRun) {
    throw new AppError(
      "too_many_sources",
      `Select at most ${SOURCE_LIMITS.maxFilesPerRun} files per run.`,
      400
    );
  }

  const warnings: string[] = [];
  const workspaceDocuments = await resolveWorkspaceDocuments(
    input.manifest.localRepoPath || "",
    workspacePaths,
    warnings
  );
  const githubDocuments = await resolveGitHubDocuments(input.manifest, input.githubToken, warnings);
  const uploadDocuments = await resolveUploadDocuments(
    input.uploadFiles,
    input.manifest.uploadLabels,
    warnings
  );
  const documents = [...uploadDocuments, ...workspaceDocuments, ...githubDocuments];

  if (totalSelectedFiles > 0 && documents.length === 0) {
    throw new AppError(
      "no_source_text",
      "The selected sources did not produce any usable text excerpts.",
      400
    );
  }

  const allCandidates = documents.flatMap((document) =>
    buildExcerptCandidates({
      document,
      topic: input.manifest.topic || "",
      objective: input.manifest.objective || ""
    })
  );
  const selectedCandidates = selectCandidates(allCandidates);

  if (totalSelectedFiles > 0 && selectedCandidates.length === 0) {
    throw new AppError(
      "no_source_excerpts",
      "The selected sources could not be resolved into usable excerpts.",
      400
    );
  }

  return {
    files: documents.map((document) => document.file),
    excerpts: finalizeResolvedExcerpts(selectedCandidates),
    warnings
  };
}
