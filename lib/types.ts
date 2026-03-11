export type ProviderId = "openrouter" | "openai" | "anthropic";

export type ProviderMode = "openrouter" | "direct";

export type ParticipantSlot = "A" | "B";
export type ParticipantRolePreset = "critic" | "builder";
export type DebateLanguage = "fr" | "en";
export type DebateSynthesisFormat =
  | "auto"
  | "tech_architecture"
  | "decision_strategy"
  | "factual_practical"
  | "proof_validation";
export type ResolvedDebateSynthesisFormat = Exclude<DebateSynthesisFormat, "auto">;

export type ParticipantConfig = {
  slot: ParticipantSlot;
  displayName: string;
  modelId: string;
  rolePreset: ParticipantRolePreset;
  customInstruction?: string;
};

export type SourceOrigin = "upload" | "workspace" | "github";

export type SourceFileRef = {
  id: string;
  origin: SourceOrigin;
  label: string;
  path?: string;
  repoUrl?: string;
  ref?: string;
  size?: number;
};

export type ResolvedExcerpt = {
  id: string;
  sourceId: string;
  title: string;
  text: string;
  locator: string;
};

export type SourcePack = {
  files: SourceFileRef[];
  excerpts: ResolvedExcerpt[];
  warnings: string[];
};

export type DebateSettings = {
  topic: string;
  objective: string;
  notes: string;
  rounds: number;
  participantA: ParticipantConfig;
  participantB: ParticipantConfig;
  synthesisModel: string;
  synthesisFormat: DebateSynthesisFormat;
};

export type DebateTurn = {
  id: string;
  round: number;
  participant: ParticipantSlot;
  displayName: string;
  rolePreset: ParticipantRolePreset;
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
  language: DebateLanguage;
  synthesisFormat: ResolvedDebateSynthesisFormat;
  generatedAt: string;
  rounds: number;
  sourceSummary: {
    totalFiles: number;
    totalExcerpts: number;
    origins: SourceOrigin[];
  } | null;
  effectiveModels: {
    participantA: string;
    participantB: string;
    synthesis: string;
  };
  participants: {
    participantA: Pick<ParticipantConfig, "displayName" | "rolePreset">;
    participantB: Pick<ParticipantConfig, "displayName" | "rolePreset">;
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
  sourcePack: SourcePack | null;
  result: DebateRunResult;
};

export type DebateRequestPayload = {
  topic?: string;
  objective?: string;
  notes?: string;
  rounds?: number;
  stream?: boolean;
  synthesisFormat?: DebateSynthesisFormat;
  participantA?: {
    displayName?: string;
    modelId?: string;
    model?: string;
    rolePreset?: ParticipantRolePreset;
    customInstruction?: string;
  };
  participantB?: {
    displayName?: string;
    modelId?: string;
    model?: string;
    rolePreset?: ParticipantRolePreset;
    customInstruction?: string;
  };
  synthesisModel?: string;
  apiKey?: string;
  sourcePack?: SourcePack;
};

export type DebateStreamStatusStage =
  | "prepare"
  | "turn_start"
  | "turn_complete"
  | "synthesis_start"
  | "finalize";

export type DebateStreamStatusEvent = {
  type: "status";
  stage: DebateStreamStatusStage;
  message: string;
  round?: number;
  participant?: ParticipantSlot;
  displayName?: string;
  model?: string;
  turn?: DebateTurn;
};

export type DebateStreamEvent =
  | DebateStreamStatusEvent
  | {
      type: "result";
      result: DebateRunResult;
    }
  | {
      type: "error";
      error: string;
      details: string;
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

export type SourceTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  children?: SourceTreeNode[];
};

export type WorkspaceSourceTreeResponse = {
  basePath: string;
  rootLabel: string;
  rootPath: string;
  nodes: SourceTreeNode[];
  warnings: string[];
  fetchedAt: string;
};

export type LocalRepoTreeRequestPayload = {
  repoPath?: string;
};

export type GitHubRepoRef = {
  owner: string;
  name: string;
  url: string;
  ref: string;
};

export type GitHubSourceTreeResponse = {
  repo: GitHubRepoRef;
  nodes: SourceTreeNode[];
  warnings: string[];
  fetchedAt: string;
};

export type GitHubTreeRequestPayload = {
  repoUrl?: string;
  ref?: string;
  githubToken?: string;
};

export type SourceResolveManifest = {
  topic?: string;
  objective?: string;
  localRepoPath?: string;
  uploadLabels?: string[];
  workspacePaths?: string[];
  githubSelection?: {
    repoUrl?: string;
    ref?: string;
    paths?: string[];
  } | null;
};
