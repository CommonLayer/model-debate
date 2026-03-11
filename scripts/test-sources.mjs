import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
const githubRepoUrl = process.env.TEST_GITHUB_REPO_URL || "https://github.com/vercel/next.js";
const githubRef = process.env.TEST_GITHUB_REF || "canary";
const localRepoPath = process.env.TEST_LOCAL_REPO_PATH || cwd;

function loadEnvFile(filename) {
  const filepath = path.join(cwd, filename);

  if (!fs.existsSync(filepath)) {
    return;
  }

  const content = fs.readFileSync(filepath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.details || payload?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function flattenFirstFilePath(nodes) {
  for (const node of nodes) {
    if (node.kind === "file") {
      return node.path;
    }

    if (node.children?.length) {
      const child = flattenFirstFilePath(node.children);

      if (child) {
        return child;
      }
    }
  }

  return "";
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  console.log(`Base URL: ${baseUrl}`);

  const workspaceTree = await fetchJson(`${baseUrl}/api/sources/workspace`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      repoPath: localRepoPath
    })
  });
  const workspacePath = flattenFirstFilePath(workspaceTree.nodes || []);

  console.log(`local repo: ok (${workspaceTree.rootLabel})`);
  console.log(`  visible files: ${workspaceTree.nodes?.length || 0}+ top-level entries`);
  console.log(`  sample file: ${workspacePath || "none"}`);

  const githubTree = await fetchJson(`${baseUrl}/api/sources/github/tree`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      repoUrl: githubRepoUrl,
      ref: githubRef,
      githubToken: process.env.GITHUB_TOKEN || undefined
    })
  });

  console.log(`github: ok (${githubTree.repo.owner}/${githubTree.repo.name}@${githubTree.repo.ref})`);

  const formData = new FormData();

  formData.append(
    "manifest",
    JSON.stringify({
      topic: "Smoke test for document-backed debate",
      objective: "Confirm that sources resolve into a usable evidence pack.",
      localRepoPath,
      workspacePaths: workspacePath ? [workspacePath] : [],
      githubSelection: null
    })
  );
  formData.append(
    "files",
    new File(
      [
        "# Source smoke test\n\nThis uploaded file exists to verify that the resolve endpoint produces excerpts and preserves source metadata."
      ],
      "smoke-test.md",
      { type: "text/markdown" }
    )
  );

  const sourcePack = await fetchJson(`${baseUrl}/api/sources/resolve`, {
    method: "POST",
    body: formData
  });

  console.log("resolve: ok");
  console.log(`  files: ${sourcePack.files.length}`);
  console.log(`  excerpts: ${sourcePack.excerpts.length}`);
  console.log(`  warnings: ${sourcePack.warnings.length}`);
}

main().catch((error) => {
  console.error(`source smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
