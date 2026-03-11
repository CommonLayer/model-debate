import {
  buildDebateBrief,
  buildParticipantSystemPrompt,
  buildSynthesisPrompt,
  buildSynthesisSystemPrompt,
  buildTurnPrompt
} from "@/lib/prompts";
import {
  resolveModelTarget,
  resolveProviderMode,
  type DebateCredentials
} from "@/lib/server/provider-resolution";
import type { DebateRunResult, DebateSettings, DebateTurn, ParticipantSlot, ProviderId } from "@/lib/types";

type RunDebateInput = {
  credentials: DebateCredentials;
  settings: DebateSettings;
};

function createTurn(turn: {
  round: number;
  participant: ParticipantSlot;
  model: string;
  text: string;
}): DebateTurn {
  return {
    id: `round-${turn.round}-${turn.participant}`,
    round: turn.round,
    participant: turn.participant,
    model: turn.model,
    text: turn.text.trim()
  };
}

export async function runDebate(input: RunDebateInput): Promise<DebateRunResult> {
  const providerMode = resolveProviderMode(input.credentials);
  const providersUsed = new Set<ProviderId>();
  const transcript: DebateTurn[] = [];
  const brief = buildDebateBrief(input.settings);
  const participantATarget = resolveModelTarget(input.settings.participantA.model, {
    mode: providerMode,
    credentials: input.credentials
  });
  const participantBTarget = resolveModelTarget(input.settings.participantB.model, {
    mode: providerMode,
    credentials: input.credentials
  });
  const synthesisTarget = resolveModelTarget(input.settings.synthesisModel, {
    mode: providerMode,
    credentials: input.credentials
  });

  for (let round = 1; round <= input.settings.rounds; round += 1) {
    const aText = await participantATarget.adapter.generate({
      apiKey: participantATarget.apiKey,
      model: participantATarget.providerModel,
      systemPrompt: buildParticipantSystemPrompt("A"),
      userPrompt: buildTurnPrompt({
        slot: "A",
        round,
        totalRounds: input.settings.rounds,
        brief,
        transcript
      }),
      maxOutputTokens: 700,
      temperature: 0.8
    });
    providersUsed.add(participantATarget.provider);

    transcript.push(
      createTurn({
        round,
        participant: "A",
        model: participantATarget.displayModel,
        text: aText
      })
    );

    const bText = await participantBTarget.adapter.generate({
      apiKey: participantBTarget.apiKey,
      model: participantBTarget.providerModel,
      systemPrompt: buildParticipantSystemPrompt("B"),
      userPrompt: buildTurnPrompt({
        slot: "B",
        round,
        totalRounds: input.settings.rounds,
        brief,
        transcript
      }),
      maxOutputTokens: 700,
      temperature: 0.8
    });
    providersUsed.add(participantBTarget.provider);

    transcript.push(
      createTurn({
        round,
        participant: "B",
        model: participantBTarget.displayModel,
        text: bText
      })
    );
  }

  const synthesis = await synthesisTarget.adapter.generate({
    apiKey: synthesisTarget.apiKey,
    model: synthesisTarget.providerModel,
    systemPrompt: buildSynthesisSystemPrompt(),
    userPrompt: buildSynthesisPrompt({
      settings: input.settings,
      transcript
    }),
    maxOutputTokens: 1200,
    temperature: 0.4
  });
  providersUsed.add(synthesisTarget.provider);

  return {
    transcript,
    synthesis: {
      model: synthesisTarget.displayModel,
      markdown: synthesis.trim()
    },
    meta: {
      provider: providerMode,
      providersUsed: [...providersUsed],
      generatedAt: new Date().toISOString(),
      rounds: input.settings.rounds,
      effectiveModels: {
        participantA: participantATarget.displayModel,
        participantB: participantBTarget.displayModel,
        synthesis: synthesisTarget.displayModel
      }
    }
  };
}
