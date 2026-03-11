const FALLBACK_PARTICIPANT_A_MODEL = "openai/gpt-5.2";
const FALLBACK_PARTICIPANT_B_MODEL = "anthropic/claude-sonnet-4-6";
const FALLBACK_SYNTHESIS_MODEL = "openai/gpt-5.2";
const DEFAULT_ROUNDS = 2;

function readEnvString(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

export type PublicDebateDefaults = {
  participantAModel: string;
  participantBModel: string;
  synthesisModel: string;
  rounds: number;
};

export function getServerDebateEnv(): {
  openrouterApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  defaults: PublicDebateDefaults;
} {
  return {
    openrouterApiKey: readEnvString(process.env.OPENROUTER_API_KEY),
    openaiApiKey: readEnvString(process.env.OPENAI_API_KEY),
    anthropicApiKey: readEnvString(process.env.ANTHROPIC_API_KEY),
    defaults: {
      participantAModel: readEnvString(
        process.env.DEFAULT_PARTICIPANT_A_MODEL,
        FALLBACK_PARTICIPANT_A_MODEL
      ),
      participantBModel: readEnvString(
        process.env.DEFAULT_PARTICIPANT_B_MODEL,
        FALLBACK_PARTICIPANT_B_MODEL
      ),
      synthesisModel: readEnvString(process.env.DEFAULT_SYNTHESIS_MODEL, FALLBACK_SYNTHESIS_MODEL),
      rounds: DEFAULT_ROUNDS
    }
  };
}

export function getPublicDebateDefaults(): PublicDebateDefaults {
  return getServerDebateEnv().defaults;
}
