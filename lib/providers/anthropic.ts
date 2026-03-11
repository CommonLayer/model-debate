import type { ProviderAdapter, ProviderGenerateTextInput } from "@/lib/providers/adapter";
import { ProviderRequestError, summarizeProviderError } from "@/lib/server/errors";

type AnthropicResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

function extractAnthropicText(payload: AnthropicResponse): string {
  if (!Array.isArray(payload.content)) {
    return "";
  }

  return payload.content
    .flatMap((item) => {
      if (item?.type !== "text" || typeof item.text !== "string") {
        return [];
      }

      return [item.text.trim()];
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = "anthropic" as const;

  async generate(input: ProviderGenerateTextInput): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxOutputTokens,
        system: input.systemPrompt,
        messages: [
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
          provider: "anthropic",
          status: response.status,
          bodyText,
          model: input.model
        }),
        response.status,
        "anthropic"
      );
    }

    const payload = (await response.json()) as AnthropicResponse;
    const text = extractAnthropicText(payload);

    if (!text) {
      throw new ProviderRequestError("Anthropic returned an empty response.", 502, "anthropic");
    }

    return text;
  }
}
