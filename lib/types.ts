export type ProviderId = "openrouter" | "openai" | "anthropic";

export type ProviderMode = "openrouter" | "direct";

export type ParticipantSlot = "A" | "B";

export type ParticipantConfig = {
  slot: ParticipantSlot;
  model: string;
};

export type DebateSettings = {
  topic: string;
  objective: string;
  rounds: number;
  participantA: ParticipantConfig;
  participantB: ParticipantConfig;
  synthesisModel: string;
};

export type DebateTurn = {
  id: string;
  round: number;
  participant: ParticipantSlot;
  model: string;
  text: string;
};

export type SynthesisResult = {
  model: string;
  markdown: string;
};

export type DebateMeta = {
  provider: ProviderMode;
  providersUsed: ProviderId[];
  generatedAt: string;
  rounds: number;
  effectiveModels: {
    participantA: string;
    participantB: string;
    synthesis: string;
  };
};

export type DebateRunResult = {
  transcript: DebateTurn[];
  synthesis: SynthesisResult;
  meta: DebateMeta;
};

export type DebateExport = {
  version: 1;
  generatedAt: string;
  settings: DebateSettings;
  result: DebateRunResult;
};

export type DebateRequestPayload = {
  topic?: string;
  objective?: string;
  rounds?: number;
  participantA?: {
    model?: string;
  };
  participantB?: {
    model?: string;
  };
  synthesisModel?: string;
  apiKey?: string;
};

export type ModelCatalogSource = "recommended" | "openrouter" | "openai" | "anthropic";

export type ModelCatalogCredentialSource = "ui" | "env" | "direct" | "none";

export type ModelCatalogEntry = {
  id: string;
  label: string;
  source: ModelCatalogSource;
  description?: string;
};

export type ModelCatalogResponse = {
  mode: ProviderMode;
  credentialSource: ModelCatalogCredentialSource;
  loadedFrom: Exclude<ModelCatalogSource, "recommended">[];
  models: ModelCatalogEntry[];
  warnings: string[];
  fetchedAt: string;
};
