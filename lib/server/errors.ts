function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkup(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function extractProviderErrorMessage(bodyText: string): string {
  const trimmed = bodyText.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as
      | { error?: string | { message?: string }; message?: string }
      | null;

    if (typeof parsed?.error === "string") {
      return normalizeWhitespace(parsed.error);
    }

    if (typeof parsed?.error?.message === "string") {
      return normalizeWhitespace(parsed.error.message);
    }

    if (typeof parsed?.message === "string") {
      return normalizeWhitespace(parsed.message);
    }
  } catch {
    return clip(stripMarkup(trimmed), 220);
  }

  return clip(stripMarkup(trimmed), 220);
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ProviderRequestError extends AppError {
  constructor(
    message: string,
    public readonly providerStatus: number,
    public readonly provider?: "openrouter" | "openai" | "anthropic"
  ) {
    super("provider_error", message, 502);
    this.name = "ProviderRequestError";
  }
}

type ProviderSummaryInput = {
  provider: "openrouter" | "openai" | "anthropic";
  status: number;
  bodyText: string;
  model?: string;
};

function getProviderLabel(provider: ProviderSummaryInput["provider"]): string {
  if (provider === "openai") {
    return "OpenAI";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  return "OpenRouter";
}

export function summarizeProviderError(input: ProviderSummaryInput): string {
  const message = extractProviderErrorMessage(input.bodyText);
  const providerLabel = getProviderLabel(input.provider);
  const prefix = `[${input.provider}-error:${input.status}]`;

  if (message) {
    const modelHintNeeded =
      input.status === 400 &&
      /model|does not exist|not found|unsupported|invalid/i.test(message) &&
      input.model;
    const modelHint = modelHintNeeded
      ? ` Check the model name '${input.model}' and your ${providerLabel} access.`
      : "";

    return `${prefix} ${clip(message, 220)}${modelHint}`;
  }

  if (input.status === 400) {
    return `${prefix} ${providerLabel} rejected the request. Check the model and request shape.`;
  }

  if (input.status === 401 || input.status === 403) {
    return `[${input.provider}-error:auth] ${providerLabel} rejected the API key or its access scope.`;
  }

  if (input.status === 429) {
    return `${prefix} ${providerLabel} rate limited the request.`;
  }

  if (input.status >= 500) {
    return `[${input.provider}-error:5xx] ${providerLabel} returned a provider-side failure.`;
  }

  return `${prefix} ${providerLabel} returned an unexpected error.`;
}

export function toErrorResponse(error: AppError): { error: string; details: string } {
  return {
    error: error.code,
    details: error.message
  };
}
