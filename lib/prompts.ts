import type { DebateSettings, DebateTurn, ParticipantSlot } from "@/lib/types";

function renderTranscript(turns: DebateTurn[]): string {
  if (turns.length === 0) {
    return "No prior turns.";
  }

  return turns
    .map((turn) => {
      return `Round ${turn.round} - Participant ${turn.participant} (${turn.model})\n${turn.text}`;
    })
    .join("\n\n");
}

export function buildDebateBrief(settings: DebateSettings): string {
  return [`Topic: ${settings.topic}`, `Objective: ${settings.objective}`].join("\n");
}

export function buildParticipantSystemPrompt(slot: ParticipantSlot): string {
  if (slot === "A") {
    return [
      "You are Participant A in a structured model-vs-model debate.",
      "Lead with first-principles reasoning, expose weak assumptions, and apply pressure where the plan seems underspecified.",
      "Stay concrete and avoid generic filler."
    ].join("\n");
  }

  return [
    "You are Participant B in a structured model-vs-model debate.",
    "Respond directly to Participant A, defend the strongest practical alternative, and keep the argument implementation-aware.",
    "Stay concrete and avoid generic filler."
  ].join("\n");
}

export function buildTurnPrompt(input: {
  slot: ParticipantSlot;
  round: number;
  totalRounds: number;
  brief: string;
  transcript: DebateTurn[];
}): string {
  const roleInstruction =
    input.slot === "A"
      ? "Open the round by making the strongest concise case you can, and challenge the main unresolved weakness."
      : "Answer the strongest current challenge, then sharpen the counter-position without repeating the same framing.";

  return [
    input.brief,
    `Current turn: ${input.round}/${input.totalRounds} for participant ${input.slot}.`,
    "Debate transcript so far:",
    renderTranscript(input.transcript),
    "Response rules:",
    "- Write 3 numbered points.",
    "- Keep the response between 140 and 220 words.",
    "- Engage with the latest opposing claim when one exists.",
    "- End with a single line that starts with 'Immediate next question:'.",
    roleInstruction
  ].join("\n\n");
}

export function buildSynthesisSystemPrompt(): string {
  return [
    "You are the synthesis model for a structured model-vs-model debate.",
    "Produce an actionable Markdown synthesis, not a transcript recap.",
    "Be specific, balanced, and implementation-oriented."
  ].join("\n");
}

export function buildSynthesisPrompt(input: {
  settings: DebateSettings;
  transcript: DebateTurn[];
}): string {
  return [
    `Topic: ${input.settings.topic}`,
    `Objective: ${input.settings.objective}`,
    "Full transcript:",
    renderTranscript(input.transcript),
    "Return Markdown with exactly these sections:",
    "## Core thesis",
    "## Strongest argument from A",
    "## Strongest argument from B",
    "## Agreements",
    "## Unresolved tensions",
    "## Synthesis",
    "## Next actions",
    "Keep each section concise and concrete."
  ].join("\n\n");
}
