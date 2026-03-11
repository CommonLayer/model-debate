import path from "node:path";

import { extractText, getDocumentProxy } from "unpdf";

import { AppError } from "@/lib/server/errors";
import type { ResolvedExcerpt, SourceFileRef, SourceOrigin, SourceTreeNode } from "@/lib/types";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out"
]);

const BLOCKED_FILE_PATTERNS = [
  /^\.env(\.|$)/i,
  /^\.npmrc$/i,
  /^\.yarnrc/i,
  /^pnpm-lock\.yaml$/i,
  /^package-lock\.json$/i,
  /\.pem$/i,
  /\.key$/i
];

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".lua",
  ".m",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".m",
  ".mjs",
  ".php",
  ".pl",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".xml"
]);

const SPECIAL_TEXT_FILENAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "Dockerfile",
  "Gemfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "README",
  "README.md",
  "README.mdx"
]);

const PDF_EXTENSION = ".pdf";

export const SOURCE_LIMITS = {
  maxFilesPerRun: 20,
  maxExcerptsPerSource: 3,
  maxTotalExcerpts: 18,
  maxTextBytes: 2 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  chunkTargetChars: 1200,
  chunkOverlapChars: 180,
  codeWindowLines: 42,
  codeWindowOverlapLines: 8
} as const;

export type SourceContentKind = "text" | "code" | "pdf";

export type SourceTreeFileRecord = {
  id: string;
  origin: SourceOrigin;
  label: string;
  path: string;
  size: number;
  repoUrl?: string;
  ref?: string;
  sha?: string;
};

export type ParsedSourceDocument = {
  file: SourceFileRef;
  kind: SourceContentKind;
  text: string;
  pages?: Array<{
    pageNumber: number;
    text: string;
  }>;
};

export type ExcerptCandidate = {
  sourceId: string;
  title: string;
  text: string;
  locator: string;
  score: number;
};

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function sortNodes(nodes: SourceTreeNode[]): SourceTreeNode[] {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  });

  for (const node of nodes) {
    if (node.kind === "directory" && node.children) {
      sortNodes(node.children);
    }
  }

  return nodes;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").replace(/\t/g, "  ");
}

function isBlockedFilename(filename: string): boolean {
  return BLOCKED_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

function getExtension(filepath: string): string {
  return path.extname(filepath).toLowerCase();
}

function getBasename(filepath: string): string {
  return path.basename(filepath);
}

function decodeText(buffer: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));

  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

function chunkPlainText(
  text: string,
  locatorPrefix: string
): Array<{ title: string; text: string; locator: string }> {
  const lines = normalizeWhitespace(text).split("\n");
  const sections: Array<{ title: string; text: string }> = [];
  let activeTitle = "Excerpt";
  let activeLines: string[] = [];

  function flushSection(): void {
    const sectionText = activeLines.join("\n").trim();

    if (!sectionText) {
      activeLines = [];
      return;
    }

    sections.push({
      title: activeTitle,
      text: sectionText
    });
    activeLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 /-]{3,}:\s*)$/);

    if (headingMatch) {
      flushSection();
      activeTitle = trimmed.replace(/^#+\s*/, "").replace(/:\s*$/, "");
      continue;
    }

    activeLines.push(line);
  }

  flushSection();

  const output: Array<{ title: string; text: string; locator: string }> = [];
  let chunkIndex = 1;

  for (const section of sections.length > 0 ? sections : [{ title: "Excerpt", text }]) {
    const sectionText = section.text.trim();

    if (!sectionText) {
      continue;
    }

    let offset = 0;

    while (offset < sectionText.length) {
      let end = Math.min(offset + SOURCE_LIMITS.chunkTargetChars, sectionText.length);

      if (end < sectionText.length) {
        const nextBoundary = sectionText.lastIndexOf("\n\n", end);

        if (nextBoundary > offset + 320) {
          end = nextBoundary;
        }
      }

      const chunkText = sectionText.slice(offset, end).trim();

      if (chunkText) {
        output.push({
          title: section.title,
          text: chunkText,
          locator: `${locatorPrefix} · ${section.title} · chunk ${chunkIndex}`
        });
        chunkIndex += 1;
      }

      if (end >= sectionText.length) {
        break;
      }

      offset = Math.max(end - SOURCE_LIMITS.chunkOverlapChars, offset + 1);
    }
  }

  return output;
}

function chunkCodeText(
  text: string,
  locatorPrefix: string
): Array<{ title: string; text: string; locator: string }> {
  const lines = normalizeWhitespace(text).split("\n");
  const chunks: Array<{ title: string; text: string; locator: string }> = [];

  for (
    let startIndex = 0;
    startIndex < lines.length;
    startIndex += SOURCE_LIMITS.codeWindowLines - SOURCE_LIMITS.codeWindowOverlapLines
  ) {
    const endIndex = Math.min(startIndex + SOURCE_LIMITS.codeWindowLines, lines.length);
    const chunkText = lines.slice(startIndex, endIndex).join("\n").trim();

    if (!chunkText) {
      continue;
    }

    chunks.push({
      title: "Code window",
      text: chunkText,
      locator: `${locatorPrefix} · lines ${startIndex + 1}-${endIndex}`
    });
  }

  return chunks;
}

function chunkPdfPages(
  pages: Array<{ pageNumber: number; text: string }>,
  locatorPrefix: string
): Array<{ title: string; text: string; locator: string }> {
  const chunks: Array<{ title: string; text: string; locator: string }> = [];

  for (const page of pages) {
    const pageText = normalizeWhitespace(page.text).trim();

    if (!pageText) {
      continue;
    }

    let offset = 0;
    let chunkIndex = 1;

    while (offset < pageText.length) {
      let end = Math.min(offset + SOURCE_LIMITS.chunkTargetChars, pageText.length);

      if (end < pageText.length) {
        const nextBoundary = pageText.lastIndexOf("\n\n", end);

        if (nextBoundary > offset + 320) {
          end = nextBoundary;
        }
      }

      const chunkText = pageText.slice(offset, end).trim();

      if (chunkText) {
        chunks.push({
          title: `PDF page ${page.pageNumber}`,
          text: chunkText,
          locator: `${locatorPrefix} · page ${page.pageNumber} · chunk ${chunkIndex}`
        });
        chunkIndex += 1;
      }

      if (end >= pageText.length) {
        break;
      }

      offset = Math.max(end - SOURCE_LIMITS.chunkOverlapChars, offset + 1);
    }
  }

  return chunks;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function scoreChunk(text: string, queryTokens: string[], labelTokens: string[]): number {
  const haystack = ` ${text.toLowerCase()} `;
  const tokens = [...queryTokens, ...labelTokens];
  let score = 0;

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (haystack.includes(` ${token} `)) {
      score += queryTokens.includes(token) ? 4 : 2;
      continue;
    }

    if (haystack.includes(token)) {
      score += 1;
    }
  }

  score += Math.min(text.length, SOURCE_LIMITS.chunkTargetChars) / 200;

  return score;
}

export function normalizeSourcePath(filepath: string): string {
  return toPosixPath(filepath).replace(/^\/+|\/+$/g, "");
}

export function isIgnoredPath(filepath: string): boolean {
  const normalized = normalizeSourcePath(filepath);

  if (!normalized) {
    return false;
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  return isBlockedFilename(segments[segments.length - 1] || "");
}

export function isPdfFile(filepath: string): boolean {
  return getExtension(filepath) === PDF_EXTENSION;
}

export function isCodeFile(filepath: string): boolean {
  const extension = getExtension(filepath);
  const basename = getBasename(filepath);

  if (SPECIAL_TEXT_FILENAMES.has(basename)) {
    return false;
  }

  return CODE_EXTENSIONS.has(extension);
}

export function isSupportedSourceFile(filepath: string): boolean {
  const normalized = normalizeSourcePath(filepath);

  if (!normalized || isIgnoredPath(normalized)) {
    return false;
  }

  if (/\.min\.(js|css)$/i.test(normalized)) {
    return false;
  }

  if (isPdfFile(normalized)) {
    return true;
  }

  const extension = getExtension(normalized);
  const basename = getBasename(normalized);

  return TEXT_EXTENSIONS.has(extension) || SPECIAL_TEXT_FILENAMES.has(basename);
}

export function getSourceSizeLimit(filepath: string): number {
  return isPdfFile(filepath) ? SOURCE_LIMITS.maxPdfBytes : SOURCE_LIMITS.maxTextBytes;
}

export function createSourceId(origin: SourceOrigin, filepath: string, repoUrl?: string, ref?: string): string {
  const normalized = normalizeSourcePath(filepath);

  if (origin === "github" && repoUrl) {
    return `github:${repoUrl}#${ref || "default"}:${normalized}`;
  }

  return `${origin}:${normalized}`;
}

export function createSourceTree(records: SourceTreeFileRecord[]): SourceTreeNode[] {
  const root: SourceTreeNode[] = [];

  for (const record of records) {
    const segments = normalizeSourcePath(record.path).split("/");
    let currentLevel = root;
    let currentPath = "";

    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        currentLevel.push({
          id: record.id,
          name: segment,
          path: normalizeSourcePath(record.path),
          kind: "file",
          size: record.size
        });
        continue;
      }

      let directory = currentLevel.find(
        (node) => node.kind === "directory" && node.path === currentPath
      );

      if (!directory) {
        directory = {
          id: `${record.origin}:dir:${currentPath}`,
          name: segment,
          path: currentPath,
          kind: "directory",
          children: []
        };
        currentLevel.push(directory);
      }

      currentLevel = directory.children || [];
      directory.children = currentLevel;
    }
  }

  return sortNodes(root);
}

export async function parseSourceDocument(
  file: SourceFileRef,
  buffer: Buffer
): Promise<ParsedSourceDocument> {
  const sizeLimit = getSourceSizeLimit(file.path || file.label);

  if (buffer.byteLength > sizeLimit) {
    throw new AppError(
      "source_too_large",
      `${file.label} exceeds the supported size limit for this source type.`,
      400
    );
  }

  if (isPdfFile(file.path || file.label)) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = extracted.text
      .map((pageText, index) => ({
        pageNumber: index + 1,
        text: normalizeWhitespace(pageText)
      }))
      .filter((page) => page.text.trim());

    return {
      file,
      kind: "pdf",
      text: pages.map((page) => page.text).join("\n\n"),
      pages
    };
  }

  if (isLikelyBinary(buffer)) {
    throw new AppError(
      "unsupported_source",
      `${file.label} looks like a binary file and cannot be used as a text source.`,
      400
    );
  }

  const text = normalizeWhitespace(decodeText(buffer)).trim();

  if (!text) {
    throw new AppError("empty_source", `${file.label} did not produce usable text.`, 400);
  }

  return {
    file,
    kind: isCodeFile(file.path || file.label) ? "code" : "text",
    text
  };
}

export function buildExcerptCandidates(input: {
  document: ParsedSourceDocument;
  topic: string;
  objective: string;
}): ExcerptCandidate[] {
  const queryTokens = [...tokenize(input.topic), ...tokenize(input.objective)];
  const labelTokens = tokenize(input.document.file.label);
  const locatorPrefix = input.document.file.label;
  const rawChunks =
    input.document.kind === "pdf"
      ? chunkPdfPages(input.document.pages || [], locatorPrefix)
      : input.document.kind === "code"
        ? chunkCodeText(input.document.text, locatorPrefix)
        : chunkPlainText(input.document.text, locatorPrefix);

  return rawChunks
    .map((chunk) => ({
      sourceId: input.document.file.id,
      title: chunk.title,
      text: chunk.text,
      locator: chunk.locator,
      score: scoreChunk(chunk.text, queryTokens, labelTokens)
    }))
    .filter((chunk) => chunk.text.trim());
}

export function finalizeResolvedExcerpts(candidates: ExcerptCandidate[]): ResolvedExcerpt[] {
  return candidates.map((candidate, index) => ({
    id: `[SRC-${index + 1}]`,
    sourceId: candidate.sourceId,
    title: candidate.title,
    text: candidate.text,
    locator: candidate.locator
  }));
}
