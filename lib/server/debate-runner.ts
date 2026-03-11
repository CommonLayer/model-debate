import {
  buildDebateBrief,
  buildParticipantSystemPrompt,
  buildSynthesisPrompt,
  buildSynthesisSystemPrompt,
  buildTurnPrompt,
  detectDebateLanguage,
  resolveSynthesisFormat
} from "@/lib/prompts";
import {
  resolveModelTarget,
  resolveProviderMode,
  type DebateCredentials
} from "@/lib/server/provider-resolution";
import type {
  DebateRunResult,
  DebateSettings,
  DebateStreamStatusEvent,
  DebateTurn,
  ParticipantSlot,
  ProviderId,
  SourcePack,
  SourceOrigin
} from "@/lib/types";

type RunDebateInput = {
  credentials: DebateCredentials;
  settings: DebateSettings;
  sourcePack?: SourcePack | null;
  onStatus?: (event: DebateStreamStatusEvent) => void;
};

function createTurn(turn: {
  round: number;
  participant: ParticipantSlot;
  displayName: string;
  rolePreset: "critic" | "builder";
  model: string;
  text: string;
}): DebateTurn {
  return {
    id: `round-${turn.round}-${turn.participant}`,
    round: turn.round,
    participant: turn.participant,
    displayName: turn.displayName,
    rolePreset: turn.rolePreset,
    model: turn.model,
    text: turn.text.trim()
  };
}

export async function runDebate(input: RunDebateInput): Promise<DebateRunResult> {
  const providerMode = resolveProviderMode(input.credentials);
  const providersUsed = new Set<ProviderId>();
  const transcript: DebateTurn[] = [];
  const language = detectDebateLanguage(input.settings);
  const synthesisFormat = resolveSynthesisFormat(input.settings);
  const brief = buildDebateBrief(input.settings);
  const participantATarget = resolveModelTarget(input.settings.participantA.modelId, {
    mode: providerMode,
    credentials: input.credentials
  });
  const participantBTarget = resolveModelTarget(input.settings.participantB.modelId, {
    mode: providerMode,
    credentials: input.credentials
  });
  const synthesisTarget = resolveModelTarget(input.settings.synthesisModel, {
    mode: providerMode,
    credentials: input.credentials
  });

  input.onStatus?.({
    type: "status",
    stage: "prepare",
    message:
      language === "fr"
        ? "Preparation du debat, du brief et des sources."
        : "Preparing the debate brief and source pack."
  });

  for (let round = 1; round <= input.settings.rounds; round += 1) {
    input.onStatus?.({
      type: "status",
      stage: "turn_start",
      round,
      participant: "A",
      displayName: input.settings.participantA.displayName,
      model: participantATarget.displayModel,
      message:
        language === "fr"
          ? `${input.settings.participantA.displayName} ouvre le tour ${round}.`
          : `${input.settings.participantA.displayName} is opening round ${round}.`
    });

    const aText = await participantATarget.adapter.generate({
      apiKey: participantATarget.apiKey,
      model: participantATarget.providerModel,
      systemPrompt: buildParticipantSystemPrompt(input.settings.participantA, language),
      userPrompt: buildTurnPrompt({
        participant: input.settings.participantA,
        round,
        totalRounds: input.settings.rounds,
        brief,
        transcript,
        sourcePack: input.sourcePack,
        language
      }),
      maxOutputTokens: 900
    });
    providersUsed.add(participantATarget.provider);

    const participantATurn = createTurn({
      round,
      participant: "A",
      displayName: input.settings.participantA.displayName,
      rolePreset: input.settings.participantA.rolePreset,
      model: participantATarget.displayModel,
      text: aText
    });

    transcript.push(participantATurn);

    input.onStatus?.({
      type: "status",
      stage: "turn_complete",
      round,
      participant: "A",
      displayName: input.settings.participantA.displayName,
      model: participantATarget.displayModel,
      turn: participantATurn,
      message:
        language === "fr"
          ? `${input.settings.participantA.displayName} a termine le tour ${round}.`
          : `${input.settings.participantA.displayName} completed round ${round}.`
    });

    input.onStatus?.({
      type: "status",
      stage: "turn_start",
      round,
      participant: "B",
      displayName: input.settings.participantB.displayName,
      model: participantBTarget.displayModel,
      message:
        language === "fr"
          ? `${input.settings.participantB.displayName} repond au tour ${round}.`
          : `${input.settings.participantB.displayName} is responding in round ${round}.`
    });

    const bText = await participantBTarget.adapter.generate({
      apiKey: participantBTarget.apiKey,
      model: participantBTarget.providerModel,
      systemPrompt: buildParticipantSystemPrompt(input.settings.participantB, language),
      userPrompt: buildTurnPrompt({
        participant: input.settings.participantB,
        round,
        totalRounds: input.settings.rounds,
        brief,
        transcript,
        sourcePack: input.sourcePack,
        language
      }),
      maxOutputTokens: 900
    });
    providersUsed.add(participantBTarget.provider);

    const participantBTurn = createTurn({
      round,
      participant: "B",
      displayName: input.settings.participantB.displayName,
      rolePreset: input.settings.participantB.rolePreset,
      model: participantBTarget.displayModel,
      text: bText
    });

    transcript.push(participantBTurn);

    input.onStatus?.({
      type: "status",
      stage: "turn_complete",
      round,
      participant: "B",
      displayName: input.settings.participantB.displayName,
      model: participantBTarget.displayModel,
      turn: participantBTurn,
      message:
        language === "fr"
          ? `${input.settings.participantB.displayName} a termine le tour ${round}.`
          : `${input.settings.participantB.displayName} completed round ${round}.`
    });
  }

  input.onStatus?.({
    type: "status",
    stage: "synthesis_start",
    model: synthesisTarget.displayModel,
    message:
      language === "fr"
        ? "La synthese demarre sur le transcript complet."
        : "Starting the synthesis from the full transcript."
  });

  const synthesis = await synthesisTarget.adapter.generate({
    apiKey: synthesisTarget.apiKey,
    model: synthesisTarget.providerModel,
    systemPrompt: buildSynthesisSystemPrompt(language),
    userPrompt: buildSynthesisPrompt({
      settings: input.settings,
      brief,
      transcript,
      sourcePack: input.sourcePack,
      language,
      format: synthesisFormat
    }),
    maxOutputTokens: 1600
  });
  providersUsed.add(synthesisTarget.provider);

  input.onStatus?.({
    type: "status",
    stage: "finalize",
    message:
      language === "fr"
        ? "Finalisation du payload de run."
        : "Finalizing the run payload."
  });

  return {
    transcript,
    synthesis: {
      model: synthesisTarget.displayModel,
      markdown: synthesis.trim()
    },
    meta: {
      provider: providerMode,
      providersUsed: [...providersUsed],
      language,
      synthesisFormat,
      generatedAt: new Date().toISOString(),
      rounds: input.settings.rounds,
      sourceSummary: input.sourcePack
        ? {
            totalFiles: input.sourcePack.files.length,
            totalExcerpts: input.sourcePack.excerpts.length,
            origins: [...new Set(input.sourcePack.files.map((file) => file.origin))] as SourceOrigin[]
          }
        : null,
      effectiveModels: {
        participantA: participantATarget.displayModel,
        participantB: participantBTarget.displayModel,
        synthesis: synthesisTarget.displayModel
      },
      participants: {
        participantA: {
          displayName: input.settings.participantA.displayName,
          rolePreset: input.settings.participantA.rolePreset
        },
        participantB: {
          displayName: input.settings.participantB.displayName,
          rolePreset: input.settings.participantB.rolePreset
        }
      }
    }
  };
}
