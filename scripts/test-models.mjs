import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

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

function canonicalizeModelId(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("openai/")) {
    return value;
  }

  if (value.startsWith("anthropic/")) {
    const model = value.replace(/^anthropic\//, "");

    if (
      model === "claude-sonnet-4-6" ||
      model === "claude-sonnet-4.6" ||
      model === "claude-4.6-sonnet"
    ) {
      return "anthropic/claude-sonnet-4-6";
    }

    return `anthropic/${model}`;
  }

  if (/^(gpt-|o[1-9]|chatgpt-|codex-|gpt-oss-)/i.test(value)) {
    return `openai/${value.replace(/^openai\//, "")}`;
  }

  if (/^claude-/i.test(value)) {
    if (
      value === "claude-sonnet-4-6" ||
      value === "claude-sonnet-4.6" ||
      value === "claude-4.6-sonnet"
    ) {
      return "anthropic/claude-sonnet-4-6";
    }

    return `anthropic/${value}`;
  }

  return value;
}

function shouldIncludeBasicCatalogModel(value) {
  const model = value.replace(/^[^/]+\//, "");

  if (/latest/i.test(model)) {
    return false;
  }

  if (/(preview|beta)$/i.test(model)) {
    return false;
  }

  if (/\d{4}-\d{2}-\d{2}$/i.test(model)) {
    return false;
  }

  if (/-\d{8}$/i.test(model)) {
    return false;
  }

  if (/-\d{4}$/i.test(model)) {
    return false;
  }

  return true;
}

function isLikelyOpenAITextModel(value) {
  const model = value.toLowerCase();
  const blocked = [
    "embedding",
    "moderation",
    "whisper",
    "image",
    "audio",
    "realtime",
    "tts",
    "transcribe",
    "sora"
  ];

  if (blocked.some((fragment) => model.includes(fragment))) {
    return false;
  }

  return /^(gpt-|o[1-9]|chatgpt-|codex-|gpt-oss-)/i.test(value);
}

function formatList(items) {
  if (!items.length) {
    return "none";
  }

  return items.join(", ");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function checkOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      provider: "openrouter",
      enabled: false
    };
  }

  const payload = await fetchJson("https://openrouter.ai/api/v1/models/user", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const models = Array.isArray(payload?.data)
    ? payload.data
        .map((item) => canonicalizeModelId(item?.id || ""))
        .filter((id) => shouldIncludeBasicCatalogModel(id))
        .filter(Boolean)
        .sort()
    : [];

  return {
    provider: "openrouter",
    enabled: true,
    count: models.length,
    allModels: models,
    sample: models.slice(0, 12)
  };
}

async function checkOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      provider: "openai",
      enabled: false
    };
  }

  const payload = await fetchJson("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const models = Array.isArray(payload?.data)
    ? payload.data
        .map((item) => item?.id || "")
        .filter((id) => isLikelyOpenAITextModel(id))
        .map((id) => canonicalizeModelId(id))
        .filter((id) => shouldIncludeBasicCatalogModel(id))
        .sort()
    : [];

  return {
    provider: "openai",
    enabled: true,
    count: models.length,
    allModels: models,
    sample: models.slice(0, 12)
  };
}

async function checkAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      provider: "anthropic",
      enabled: false
    };
  }

  const payload = await fetchJson("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });
  const models = Array.isArray(payload?.data)
    ? payload.data
        .map((item) => canonicalizeModelId(item?.id || ""))
        .filter((id) => id.startsWith("anthropic/"))
        .filter((id) => shouldIncludeBasicCatalogModel(id))
        .sort()
    : [];

  return {
    provider: "anthropic",
    enabled: true,
    count: models.length,
    allModels: models,
    sample: models.slice(0, 12)
  };
}

function printResult(result) {
  if (!result.enabled) {
    console.log(`${result.provider}: skipped (no key configured)`);
    return;
  }

  console.log(`${result.provider}: ok`);
  console.log(`  models: ${result.count}`);
  console.log(`  sample: ${formatList(result.sample)}`);
}

function printDefaultCheck(results) {
  const available = new Set();

  for (const result of results) {
    if (result.enabled && Array.isArray(result.allModels)) {
      for (const item of result.allModels) {
        available.add(item);
      }
    }
  }

  const defaults = [
    canonicalizeModelId(process.env.DEFAULT_PARTICIPANT_A_MODEL || ""),
    canonicalizeModelId(process.env.DEFAULT_PARTICIPANT_B_MODEL || ""),
    canonicalizeModelId(process.env.DEFAULT_SYNTHESIS_MODEL || "")
  ].filter(Boolean);

  console.log("defaults:");

  for (const model of defaults) {
    const status = available.has(model) ? "sampled" : "not-in-sample";
    console.log(`  ${model} -> ${status}`);
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const checks = [checkOpenRouter(), checkOpenAI(), checkAnthropic()];
const results = await Promise.allSettled(checks);

for (const result of results) {
  if (result.status === "fulfilled") {
    printResult(result.value);
    continue;
  }

  console.error(`check failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  process.exitCode = 1;
}

const fulfilled = results
  .filter((result) => result.status === "fulfilled")
  .map((result) => result.value);

if (fulfilled.length > 0) {
  printDefaultCheck(fulfilled);
}
