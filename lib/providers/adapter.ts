import type { ProviderId } from "@/lib/types";

export type ProviderGenerateTextInput = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  temperature?: number;
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  generate(input: ProviderGenerateTextInput): Promise<string>;
}
