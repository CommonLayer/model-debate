import type { ProviderAdapter, ProviderGenerateTextInput } from "@/lib/providers/adapter";
import { ProviderRequestError, summarizeProviderError } from "@/lib/server/errors";

type OpenAIResponsesOutputContentItem = {
  type?: string;
  text?: string;
  refusal?: string;
};

type OpenAIResponsesOutputItem = {
  type?: string;
  role?: string;
  status?: string;
  content?: Array<{
    type?: string;
    text?: string;
    refusal?: string;
  }>;
};

type OpenAIResponsesPayload = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output_text?: unknown;
  output?: OpenAIResponsesOutputItem[];
};

function extractOpenAIResponseText(payload: OpenAIResponsesPayload): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .flatMap((item) => {
      if (
        (item?.type !== "output_text" && item?.type !== "text") ||
        typeof item.text !== "string"
      ) {
        return [];
      }

      return [item.text.trim()];
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function extractOpenAIRefusal(payload: OpenAIResponsesPayload): string {
  if (!Array.isArray(payload.output)) {
    return "";
  }

  return payload.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .flatMap((item: OpenAIResponsesOutputContentItem) => {
      if (typeof item?.refusal !== "string" || !item.refusal.trim()) {
        return [];
      }

      return [item.refusal.trim()];
    })
    .join("\n\n")
    .trim();
}

function isGpt5Model(model: string): boolean {
  return /^gpt-5(?:$|[-.])/i.test(model);
}

function buildOpenAIRequestBody(
  input: ProviderGenerateTextInput,
  maxOutputTokens: number
): Record<string, unknown> {
  return {
    model: input.model,
    instructions: input.systemPrompt,
    input: input.userPrompt,
    max_output_tokens: maxOutputTokens,
    ...(isGpt5Model(input.model)
      ? {
          reasoning: {
            effort: "minimal"
          }
        }
      : {})
  };
}

function getRetryMaxOutputTokens(maxOutputTokens: number): number {
  return Math.min(Math.max(maxOutputTokens * 2, maxOutputTokens + 600), 2400);
}

function shouldRetryWithoutText(
  payload: OpenAIResponsesPayload,
  attempt: number,
  totalAttempts: number
): boolean {
  return (
    attempt < totalAttempts - 1 &&
    payload.status === "incomplete" &&
    payload.incomplete_details?.reason === "max_output_tokens"
  );
}

function buildOpenAIEmptyResponseMessage(payload: OpenAIResponsesPayload): string {
  const refusal = extractOpenAIRefusal(payload);

  if (refusal) {
    return `OpenAI refused the request: ${refusal}`;
  }

  if (
    payload.status === "incomplete" &&
    payload.incomplete_details?.reason === "max_output_tokens"
  ) {
    return "OpenAI stopped before producing visible text because max_output_tokens was exhausted. GPT-5 counts reasoning tokens against that limit, so retry the run or increase the budget.";
  }

  return "OpenAI returned an empty response.";
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = "openai" as const;

  async generate(input: ProviderGenerateTextInput): Promise<string> {
    const attempts = [input.maxOutputTokens, getRetryMaxOutputTokens(input.maxOutputTokens)];
    let lastPayload: OpenAIResponsesPayload | null = null;

    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildOpenAIRequestBody(input, attempts[attempt]))
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");

        throw new ProviderRequestError(
          summarizeProviderError({
            provider: "openai",
            status: response.status,
            bodyText,
            model: input.model
          }),
          response.status,
          "openai"
        );
      }

      const payload = (await response.json()) as OpenAIResponsesPayload;
      lastPayload = payload;

      const text = extractOpenAIResponseText(payload);

      if (text) {
        return text;
      }

      if (shouldRetryWithoutText(payload, attempt, attempts.length)) {
        continue;
      }

      throw new ProviderRequestError(buildOpenAIEmptyResponseMessage(payload), 502, "openai");
    }

    throw new ProviderRequestError(
      buildOpenAIEmptyResponseMessage(lastPayload ?? {}),
      502,
      "openai"
    );
  }
}
