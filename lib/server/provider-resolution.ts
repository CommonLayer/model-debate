import { AnthropicAdapter } from "@/lib/providers/anthropic";
import type { ProviderAdapter } from "@/lib/providers/adapter";
import { OpenAIAdapter } from "@/lib/providers/openai";
import { OpenRouterAdapter } from "@/lib/providers/openrouter";
import { AppError } from "@/lib/server/errors";
import type { ProviderId, ProviderMode } from "@/lib/types";

export type DebateCredentials = {
  openrouterApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
};

export type ResolvedModelTarget = {
  adapter: ProviderAdapter;
  apiKey: string;
  provider: ProviderId;
  providerModel: string;
  displayModel: string;
};

type ResolverContext = {
  mode: ProviderMode;
  credentials: DebateCredentials;
};

function normalizeWhitespace(value: string): string {
  return value.trim();
}

function inferModelProvider(model: string): ProviderId | null {
  if (model.startsWith("openai/")) {
    return "openai";
  }

  if (model.startsWith("anthropic/")) {
    return "anthropic";
  }

  if (/^(gpt-|o[1-9]|chatgpt-)/i.test(model)) {
    return "openai";
  }

  if (/^claude-/i.test(model)) {
    return "anthropic";
  }

  return null;
}

function inferDirectProvider(model: string): ProviderId | null {
  return inferModelProvider(model);
}

function normalizeOpenRouterModel(model: string): string {
  const provider = inferModelProvider(model);

  if (!provider) {
    return model;
  }

  const candidate =
    provider === "openai" ? model.replace(/^openai\//, "") : model.replace(/^anthropic\//, "");

  if (provider === "openai") {
    return `openai/${candidate}`;
  }

  if (
    candidate === "claude-sonnet-4-6" ||
    candidate === "claude-sonnet-4.6" ||
    candidate === "claude-4.6-sonnet"
  ) {
    return "anthropic/claude-4.6-sonnet";
  }

  return `anthropic/${candidate}`;
}

function normalizeDirectModel(provider: ProviderId, model: string): string {
  if (provider === "openai") {
    return model.replace(/^openai\//, "");
  }

  if (provider === "anthropic") {
    const candidate = model.replace(/^anthropic\//, "");

    if (candidate === "claude-sonnet-4") {
      return "claude-sonnet-4-0";
    }

    if (candidate === "claude-3.7-sonnet") {
      return "claude-3-7-sonnet-latest";
    }

    if (candidate === "claude-3-7-sonnet") {
      return "claude-3-7-sonnet-latest";
    }

    if (
      candidate === "claude-sonnet-4-6" ||
      candidate === "claude-sonnet-4.6" ||
      candidate === "claude-4.6-sonnet"
    ) {
      return "claude-sonnet-4-6";
    }

    return candidate;
  }

  return model;
}

export function resolveProviderMode(credentials: DebateCredentials): ProviderMode {
  if (credentials.openrouterApiKey) {
    return "openrouter";
  }

  return "direct";
}

export function resolveModelTarget(
  model: string,
  context: ResolverContext
): ResolvedModelTarget {
  const displayModel = normalizeWhitespace(model);

  if (!displayModel) {
    throw new AppError("invalid_model", "Each participant model must be non-empty.", 400);
  }

  if (context.mode === "openrouter") {
    if (!context.credentials.openrouterApiKey) {
      throw new AppError("missing_openrouter_key", "OpenRouter mode requires an OpenRouter API key.", 400);
    }

    return {
      adapter: new OpenRouterAdapter(),
      apiKey: context.credentials.openrouterApiKey,
      provider: "openrouter",
      providerModel: normalizeOpenRouterModel(displayModel),
      displayModel
    };
  }

  const provider = inferDirectProvider(displayModel);

  if (!provider || provider === "openrouter") {
    throw new AppError(
      "unsupported_direct_model",
      `Model '${displayModel}' cannot be routed directly. Use an OpenAI or Anthropic model id.`,
      400
    );
  }

  if (provider === "openai") {
    if (!context.credentials.openaiApiKey) {
      throw new AppError(
        "missing_openai_key",
        `Model '${displayModel}' requires OPENAI_API_KEY when OpenRouter is not configured.`,
        400
      );
    }

    return {
      adapter: new OpenAIAdapter(),
      apiKey: context.credentials.openaiApiKey,
      provider,
      providerModel: normalizeDirectModel(provider, displayModel),
      displayModel
    };
  }

  if (!context.credentials.anthropicApiKey) {
    throw new AppError(
      "missing_anthropic_key",
      `Model '${displayModel}' requires ANTHROPIC_API_KEY when OpenRouter is not configured.`,
      400
    );
  }

  return {
    adapter: new AnthropicAdapter(),
    apiKey: context.credentials.anthropicApiKey,
    provider,
    providerModel: normalizeDirectModel(provider, displayModel),
    displayModel
  };
}
