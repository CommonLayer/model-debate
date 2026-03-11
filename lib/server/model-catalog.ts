import { getServerDebateEnv, type PublicDebateDefaults } from "@/lib/server/env";
import { summarizeProviderError } from "@/lib/server/errors";
import type {
  ModelCatalogCredentialSource,
  ModelCatalogEntry,
  ModelCatalogResponse,
  ModelCatalogSource,
  ProviderMode
} from "@/lib/types";

type LoadModelCatalogInput = {
  openrouterApiKey?: string;
};

type CatalogCredentials = {
  openrouterApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
};

type OpenRouterModel = {
  id?: string;
  name?: string;
  description?: string;
  architecture?: {
    output_modalities?: string[];
  };
};

type OpenAIModel = {
  id?: string;
};

type AnthropicModel = {
  id?: string;
  display_name?: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOpenAIModelId(value: string): string {
  const model = value.replace(/^openai\//, "");

  return `openai/${model}`;
}

function normalizeAnthropicCandidate(value: string): string {
  const model = value.replace(/^anthropic\//, "");

  if (
    model === "claude-sonnet-4-6" ||
    model === "claude-sonnet-4.6" ||
    model === "claude-4.6-sonnet"
  ) {
    return "claude-sonnet-4-6";
  }

  if (model === "claude-sonnet-4-0" || model === "claude-sonnet-4") {
    return "claude-sonnet-4";
  }

  if (
    model === "claude-3-7-sonnet-latest" ||
    model === "claude-3.7-sonnet" ||
    model === "claude-3-7-sonnet"
  ) {
    return "claude-3.7-sonnet";
  }

  return model;
}

function normalizeAnthropicModelId(value: string): string {
  return `anthropic/${normalizeAnthropicCandidate(value)}`;
}

function canonicalizeCatalogModelId(value: string): string {
  const model = value.trim();

  if (!model) {
    return "";
  }

  if (model.startsWith("openai/")) {
    return normalizeOpenAIModelId(model);
  }

  if (model.startsWith("anthropic/")) {
    return normalizeAnthropicModelId(model);
  }

  if (/^(gpt-|o[1-9]|chatgpt-|codex-|gpt-oss-)/i.test(model)) {
    return normalizeOpenAIModelId(model);
  }

  if (/^claude-/i.test(model)) {
    return normalizeAnthropicModelId(model);
  }

  return model;
}

function shouldIncludeBasicCatalogModel(value: string): boolean {
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

function toEntry(input: {
  id: string;
  label?: string;
  source: ModelCatalogSource;
  description?: string;
}): ModelCatalogEntry | null {
  const id = canonicalizeCatalogModelId(input.id);

  if (!id || !shouldIncludeBasicCatalogModel(id)) {
    return null;
  }

  return {
    id,
    label: normalizeWhitespace(input.label || id),
    source: input.source,
    description: input.description ? normalizeWhitespace(input.description) : undefined
  };
}

function toRecommendedEntries(defaults: PublicDebateDefaults): ModelCatalogEntry[] {
  const entries = [
    toEntry({
      id: defaults.participantAModel,
      label: defaults.participantAModel,
      source: "recommended",
      description: "Default model for participant A."
    }),
    toEntry({
      id: defaults.participantBModel,
      label: defaults.participantBModel,
      source: "recommended",
      description: "Default model for participant B."
    }),
    toEntry({
      id: defaults.synthesisModel,
      label: defaults.synthesisModel,
      source: "recommended",
      description: "Default model for the final synthesis."
    })
  ];

  return entries.filter((entry): entry is ModelCatalogEntry => entry !== null);
}

function isLikelyTextGenerationModelId(value: string): boolean {
  const model = value.toLowerCase();
  const blockedFragments = [
    "embedding",
    "moderation",
    "whisper",
    "dall",
    "image",
    "tts",
    "transcribe",
    "audio",
    "realtime",
    "sora",
    "omni-moderation"
  ];

  if (blockedFragments.some((fragment) => model.includes(fragment))) {
    return false;
  }

  return /^(gpt-|o[1-9]|chatgpt-|codex-|gpt-oss-)/i.test(value);
}

function supportsTextOutput(model: OpenRouterModel): boolean {
  if (Array.isArray(model.architecture?.output_modalities)) {
    return model.architecture.output_modalities.includes("text");
  }

  return model.id ? isLikelyTextGenerationModelId(model.id) || /^anthropic\//i.test(model.id) : false;
}

function sortEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return [...entries].sort((left, right) => {
    if (left.source === "recommended" && right.source !== "recommended") {
      return -1;
    }

    if (left.source !== "recommended" && right.source === "recommended") {
      return 1;
    }

    return left.id.localeCompare(right.id);
  });
}

function mergeEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const byId = new Map<string, ModelCatalogEntry>();

  for (const entry of entries) {
    const existing = byId.get(entry.id);

    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }

    byId.set(entry.id, {
      id: entry.id,
      label: existing.label === existing.id && entry.label ? entry.label : existing.label,
      source: existing.source === "recommended" ? existing.source : entry.source,
      description: existing.description || entry.description
    });
  }

  return sortEntries([...byId.values()]);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function listOpenRouterModels(apiKey: string): Promise<ModelCatalogEntry[]> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${apiKey}`
  };

  const userResponse = await fetch("https://openrouter.ai/api/v1/models/user", {
    headers,
    cache: "no-store"
  });

  const response = userResponse.ok
    ? userResponse
    : await fetch("https://openrouter.ai/api/v1/models", {
        headers,
        cache: "no-store"
      });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");

    throw new Error(
      summarizeProviderError({
        provider: "openrouter",
        status: response.status,
        bodyText
      })
    );
  }

  const payload = await readJsonResponse<{ data?: OpenRouterModel[] }>(response);

  if (!Array.isArray(payload.data)) {
    return [];
  }

  return payload.data
    .filter((model) => typeof model.id === "string" && supportsTextOutput(model))
    .map((model) =>
      toEntry({
        id: model.id as string,
        label: model.name || model.id,
        source: "openrouter",
        description: model.description
      })
    )
    .filter((entry): entry is ModelCatalogEntry => entry !== null);
}

async function listOpenAIModels(apiKey: string): Promise<ModelCatalogEntry[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");

    throw new Error(
      summarizeProviderError({
        provider: "openai",
        status: response.status,
        bodyText
      })
    );
  }

  const payload = await readJsonResponse<{ data?: OpenAIModel[] }>(response);

  if (!Array.isArray(payload.data)) {
    return [];
  }

  return payload.data
    .filter((model) => typeof model.id === "string" && isLikelyTextGenerationModelId(model.id))
    .map((model) =>
      toEntry({
        id: model.id as string,
        label: model.id,
        source: "openai"
      })
    )
    .filter((entry): entry is ModelCatalogEntry => entry !== null);
}

async function listAnthropicModels(apiKey: string): Promise<ModelCatalogEntry[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");

    throw new Error(
      summarizeProviderError({
        provider: "anthropic",
        status: response.status,
        bodyText
      })
    );
  }

  const payload = await readJsonResponse<{ data?: AnthropicModel[] }>(response);

  if (!Array.isArray(payload.data)) {
    return [];
  }

  return payload.data
    .filter((model) => typeof model.id === "string" && /^claude-/i.test(model.id))
    .map((model) =>
      toEntry({
        id: model.id as string,
        label: model.display_name || model.id,
        source: "anthropic"
      })
    )
    .filter((entry): entry is ModelCatalogEntry => entry !== null);
}

function resolveCredentialSource(
  credentials: CatalogCredentials,
  input: LoadModelCatalogInput
): {
  mode: ProviderMode;
  credentialSource: ModelCatalogCredentialSource;
} {
  if (credentials.openrouterApiKey) {
    return {
      mode: "openrouter",
      credentialSource: input.openrouterApiKey?.trim() ? "ui" : "env"
    };
  }

  if (credentials.openaiApiKey || credentials.anthropicApiKey) {
    return {
      mode: "direct",
      credentialSource: "direct"
    };
  }

  return {
    mode: "direct",
    credentialSource: "none"
  };
}

export async function loadModelCatalog(input: LoadModelCatalogInput = {}): Promise<ModelCatalogResponse> {
  const env = getServerDebateEnv();
  const credentials: CatalogCredentials = {
    openrouterApiKey: input.openrouterApiKey?.trim() || env.openrouterApiKey,
    openaiApiKey: env.openaiApiKey,
    anthropicApiKey: env.anthropicApiKey
  };
  const recommended = toRecommendedEntries(env.defaults);
  const { mode, credentialSource } = resolveCredentialSource(credentials, input);
  const warnings: string[] = [];
  const loadedFrom: Exclude<ModelCatalogSource, "recommended">[] = [];
  const available: ModelCatalogEntry[] = [];

  if (mode === "openrouter" && credentials.openrouterApiKey) {
    try {
      available.push(...(await listOpenRouterModels(credentials.openrouterApiKey)));
      loadedFrom.push("openrouter");
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "OpenRouter model discovery failed.");
    }
  } else {
    const tasks: Array<Promise<void>> = [];

    if (credentials.openaiApiKey) {
      tasks.push(
        listOpenAIModels(credentials.openaiApiKey)
          .then((entries) => {
            available.push(...entries);
            loadedFrom.push("openai");
          })
          .catch((error) => {
            warnings.push(error instanceof Error ? error.message : "OpenAI model discovery failed.");
          })
      );
    }

    if (credentials.anthropicApiKey) {
      tasks.push(
        listAnthropicModels(credentials.anthropicApiKey)
          .then((entries) => {
            available.push(...entries);
            loadedFrom.push("anthropic");
          })
          .catch((error) => {
            warnings.push(
              error instanceof Error ? error.message : "Anthropic model discovery failed."
            );
          })
      );
    }

    await Promise.all(tasks);
  }

  if (!loadedFrom.length) {
    warnings.push(
      credentialSource === "none"
        ? "No provider keys are configured, so only the recommended defaults are shown."
        : "Model discovery could not confirm any provider catalog. You can still enter a custom model ID."
    );
  }

  return {
    mode,
    credentialSource,
    loadedFrom,
    models: mergeEntries([...recommended, ...available]),
    warnings,
    fetchedAt: new Date().toISOString()
  };
}
