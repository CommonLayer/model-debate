import type { ProviderAdapter, ProviderGenerateTextInput } from "@/lib/providers/adapter";
import { ProviderRequestError, summarizeProviderError } from "@/lib/server/errors";

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function extractOpenRouterText(payload: OpenRouterResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((item) => {
      if (typeof item?.text !== "string" || !item.text.trim()) {
        return [];
      }

      return [item.text.trim()];
    })
    .join("\n\n")
    .trim();
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = "openrouter" as const;

  async generate(input: ProviderGenerateTextInput): Promise<string> {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxOutputTokens,
        messages: [
          {
            role: "system",
            content: input.systemPrompt
          },
          {
            role: "user",
            content: input.userPrompt
          }
        ]
      })
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");

      throw new ProviderRequestError(
        summarizeProviderError({
          provider: "openrouter",
          status: response.status,
          bodyText,
          model: input.model
        }),
        response.status,
        "openrouter"
      );
    }

    const payload = (await response.json()) as OpenRouterResponse;
    const text = extractOpenRouterText(payload);

    if (!text) {
      throw new ProviderRequestError("OpenRouter returned an empty response.", 502, "openrouter");
    }

    return text;
  }
}
