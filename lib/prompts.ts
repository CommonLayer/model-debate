import type {
  DebateLanguage,
  DebateSettings,
  DebateTurn,
  ParticipantConfig,
  ParticipantRolePreset,
  ResolvedDebateSynthesisFormat,
  SourcePack
} from "@/lib/types";

export const DEFAULT_CRITIC_DISPLAY_NAME = "Critic";
export const DEFAULT_BUILDER_DISPLAY_NAME = "Builder";

type RolePresetDefinition = {
  systemPrompt: string;
  turnStance: string;
};

type SynthesisFormatDefinition = {
  sections: string[];
  finalInstruction: string;
};

const FRENCH_WORD_MARKERS = [
  " le ",
  " la ",
  " les ",
  " un ",
  " une ",
  " des ",
  " et ",
  " ou ",
  " de ",
  " du ",
  " pour ",
  " avec ",
  " sans ",
  " doit ",
  " faire ",
  " vision ",
  " objectif ",
  " debat ",
  " preuve ",
  " architecture ",
  " priorite ",
  " priorités ",
  " contraintes ",
  " contexte "
];

function scoreFrenchText(value: string): number {
  const normalized = ` ${value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")} `;

  return FRENCH_WORD_MARKERS.reduce((score, marker) => {
    return normalized.includes(marker) ? score + 1 : score;
  }, 0);
}

export function detectDebateLanguage(settings: Pick<DebateSettings, "topic" | "objective" | "notes">): DebateLanguage {
  const sample = [settings.topic, settings.objective, settings.notes].join(" ").trim();

  if (!sample) {
    return "en";
  }

  return scoreFrenchText(sample) >= 2 ? "fr" : "en";
}

function scoreKeywordMatches(sample: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => (sample.includes(keyword) ? score + 1 : score), 0);
}

export function resolveSynthesisFormat(
  settings: Pick<DebateSettings, "topic" | "objective" | "notes" | "synthesisFormat">
): ResolvedDebateSynthesisFormat {
  if (settings.synthesisFormat !== "auto") {
    return settings.synthesisFormat;
  }

  const normalized = `${settings.topic} ${settings.objective} ${settings.notes}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");

  const techScore = scoreKeywordMatches(normalized, [
    "architecture",
    "repo",
    "repository",
    "systeme",
    "system",
    "infra",
    "code",
    "api",
    "schema",
    "module",
    "service",
    "implementation",
    "implementable"
  ]);
  const decisionScore = scoreKeywordMatches(normalized, [
    "should",
    "faut-il",
    "strategy",
    "strategie",
    "scope",
    "roadmap",
    "priorite",
    "priority",
    "direction",
    "positioning",
    "positionnement",
    "recommendation",
    "recommandation"
  ]);
  const factualScore = scoreKeywordMatches(normalized, [
    "est-il",
    "est ce",
    "is it",
    "administratif",
    "administrative",
    "medical",
    "sante",
    "health",
    "patient",
    "assurance",
    "rembourse",
    "reimbursement",
    "law",
    "legal",
    "droit",
    "demarches",
    "eligib",
    "recogn"
  ]);
  const proofScore = scoreKeywordMatches(normalized, [
    "preuve",
    "proof",
    "validate",
    "validation",
    "test",
    "benchmark",
    "measure",
    "metric",
    "metrique",
    "experiment",
    "protocole",
    "criteria",
    "critere"
  ]);

  const ranked = [
    { format: "tech_architecture" as const, score: techScore },
    { format: "decision_strategy" as const, score: decisionScore },
    { format: "factual_practical" as const, score: factualScore },
    { format: "proof_validation" as const, score: proofScore }
  ].sort((left, right) => right.score - left.score);

  if (ranked[0]?.score && ranked[0].score > 0) {
    return ranked[0].format;
  }

  return "decision_strategy";
}

function getSynthesisFormatDefinition(
  language: DebateLanguage,
  format: ResolvedDebateSynthesisFormat
): SynthesisFormatDefinition {
  if (language === "fr") {
    if (format === "tech_architecture") {
      return {
        sections: [
          "## Vision nette",
          "## Invariants non negociables",
          "## Faiblesses actuelles",
          "## Decisions d'architecture",
          "## Moyens code et infra",
          "## Preuves a exiger",
          "## Prochaines actions"
        ],
        finalInstruction:
          "Chaque section doit etre concrete et courte. Dans 'Moyens code et infra', cite les types de composants ou fichiers a renforcer."
      };
    }

    if (format === "decision_strategy") {
      return {
        sections: [
          "## Reponse courte",
          "## Options reelles",
          "## Tradeoffs cles",
          "## Recommandation",
          "## Risques immediats",
          "## Prochaines actions"
        ],
        finalInstruction:
          "Tranche clairement. Ne fais pas une synthese polie du debat: choisis une direction, explique les tradeoffs et nomme ce qu'il faut reporter."
      };
    }

    if (format === "factual_practical") {
      return {
        sections: [
          "## Reponse courte",
          "## Ce qui est certain",
          "## Ce qui depend du cas",
          "## Ce qu'il faut demander ou verifier",
          "## Demarches concretes"
        ],
        finalInstruction:
          "Ecris pour quelqu'un qui veut une reponse claire et pratique. Evite le jargon inutile. Distingue les faits, le cas par cas et les etapes a suivre."
      };
    }

    return {
      sections: [
        "## Hypothese a tester",
        "## Ce qu'il faut prouver",
        "## Methode minimale",
        "## Criteres de decision",
        "## Risques de faux positif",
        "## Prochaines actions"
      ],
      finalInstruction:
        "Reste operationnel. Definis une methode minimale, des criteres nets et les biais qui pourraient faire croire a tort que l'hypothese tient."
    };
  }

  if (format === "tech_architecture") {
    return {
      sections: [
        "## Clear thesis",
        "## Non-negotiable invariants",
        "## Current weaknesses",
        "## Architecture decisions",
        "## Code and infrastructure means",
        "## Proofs to require",
        "## Next actions"
      ],
      finalInstruction:
        "Each section must be short and concrete. In 'Code and infrastructure means', cite the kinds of components or files that need reinforcement."
    };
  }

  if (format === "decision_strategy") {
    return {
      sections: [
        "## Short answer",
        "## Real options",
        "## Key tradeoffs",
        "## Recommendation",
        "## Immediate risks",
        "## Next actions"
      ],
      finalInstruction:
        "Decide clearly. Do not produce a polite recap of the debate: choose a direction, explain the tradeoffs, and name what should be deferred."
    };
  }

  if (format === "factual_practical") {
    return {
      sections: [
        "## Short answer",
        "## What is certain",
        "## What depends on the case",
        "## What to ask or verify",
        "## Practical next steps"
      ],
      finalInstruction:
        "Write for someone who wants a clear and practical answer. Avoid unnecessary jargon. Separate facts, case-by-case conditions, and concrete steps."
    };
  }

  return {
    sections: [
      "## Hypothesis to test",
      "## What must be proven",
      "## Minimal method",
      "## Decision criteria",
      "## False-positive risks",
      "## Next actions"
    ],
    finalInstruction:
      "Stay operational. Define a minimal method, clear decision criteria, and the biases that could make the result look stronger than it is."
  };
}

export function getSynthesisSectionTitles(
  language: DebateLanguage,
  format: ResolvedDebateSynthesisFormat
): string[] {
  return getSynthesisFormatDefinition(language, format).sections.map((section) =>
    section.replace(/^##\s*/, "").trim()
  );
}

function getRolePresetDefinitions(language: DebateLanguage): Record<ParticipantRolePreset, RolePresetDefinition> {
  if (language === "fr") {
    return {
      critic: {
        systemPrompt: [
          "Tu tiens le role critic dans un debat technique ferme et constructif.",
          "Ton role: clarifier la vision, detecter les illusions conceptuelles, pointer les risques de dette semantique et exiger des invariants nets.",
          "Tu peux etre en desaccord avec le builder si l'architecture te semble floue ou fragile.",
          "Ne cherche pas le consensus. Le desaccord explicite est autorise s'il rend le travail plus net.",
          "Parle francais, sans flatterie, sans phrases creuses.",
          "Reste concret: vision, architecture, preuve, mesures, priorites de code."
        ].join("\n"),
        turnStance:
          "Commence par la these, puis les fragilites, puis ce que tu exigerais avant de dire que le socle est solide."
      },
      builder: {
        systemPrompt: [
          "Tu tiens le role builder dans un debat technique ferme et constructif.",
          "Ton role: transformer une vision en socle implementable, sequence de livraison, garde-fous de code, interfaces et instrumentation.",
          "Tu peux contredire le critic si sa critique manque de pragmatisme ou de plan d'execution.",
          "Ne cherche pas le consensus. Replique quand le desaccord est necessaire pour produire un plan executable.",
          "Parle francais, sans flatterie, sans phrases creuses.",
          "Reste concret: architecture, priorites, interfaces, tests, preuves et ordre de livraison."
        ].join("\n"),
        turnStance:
          "Reponds aux fragilites soulevees, propose une architecture executable, puis tranche les priorites de code et de livraison."
      }
    };
  }

  return {
    critic: {
      systemPrompt: [
        "You hold the critic role in a firm and constructive technical debate.",
        "Your role: clarify the thesis, detect conceptual illusions, point out semantic debt risks, and demand clear invariants.",
        "You may disagree with the builder if the architecture feels vague or fragile.",
        "Do not optimize for consensus. Direct disagreement is allowed when it sharpens the work.",
        "Speak English, with the same directness as a severe French technical review. No flattery. No empty phrasing.",
        "Stay concrete: vision, architecture, proof, measures, and code priorities."
      ].join("\n"),
      turnStance:
        "Start with the thesis, then the fragilities, then what you would require before saying the foundation is solid."
    },
    builder: {
      systemPrompt: [
        "You hold the builder role in a firm and constructive technical debate.",
        "Your role: turn a vision into an implementable foundation, delivery sequence, code safeguards, interfaces, and instrumentation.",
        "You may contradict the critic if the critique lacks pragmatism or an execution plan.",
        "Do not optimize for consensus. Push back when disagreement is needed to produce an executable plan.",
        "Speak English, with the same directness as a severe French technical review. No flattery. No empty phrasing.",
        "Stay concrete: architecture, priorities, interfaces, tests, proofs, and delivery sequence."
      ].join("\n"),
      turnStance:
        "Answer the fragilities raised, propose an executable architecture, then settle the code and delivery priorities."
    }
  };
}

function renderTranscript(turns: DebateTurn[], language: DebateLanguage): string {
  if (turns.length === 0) {
    return language === "fr" ? "Aucun tour precedent." : "No prior turn.";
  }

  return turns
    .map((turn) => {
      const prefix = language === "fr" ? "Tour" : "Round";
      return `${prefix} ${turn.round} — ${turn.displayName} (${turn.model})\n${turn.text}`;
    })
    .join("\n\n");
}

function renderEvidencePack(sourcePack: SourcePack, language: DebateLanguage): string {
  if (sourcePack.excerpts.length === 0) {
    return language === "fr" ? "Aucun paquet de preuves prepare." : "No evidence pack prepared.";
  }

  return sourcePack.excerpts
    .map((excerpt) =>
      [
        `${excerpt.id} · ${excerpt.title}`,
        `${language === "fr" ? "Ancrage" : "Locator"}: ${excerpt.locator}`,
        excerpt.text
      ].join("\n")
    )
    .join("\n\n");
}

export function buildDebateBrief(settings: DebateSettings): string {
  const language = detectDebateLanguage(settings);

  if (language === "fr") {
    return [
      `Sujet principal: ${settings.topic}`,
      `Objectif: ${settings.objective}`,
      settings.notes.trim() ? `Notes utilisateur:\n${settings.notes.trim()}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    `Main topic: ${settings.topic}`,
    `Objective: ${settings.objective}`,
    settings.notes.trim() ? `User notes:\n${settings.notes.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function getRolePresetLabel(rolePreset: ParticipantRolePreset): string {
  return rolePreset === "critic" ? DEFAULT_CRITIC_DISPLAY_NAME : DEFAULT_BUILDER_DISPLAY_NAME;
}

export function buildParticipantSystemPrompt(
  participant: ParticipantConfig,
  language: DebateLanguage
): string {
  const rolePreset = getRolePresetDefinitions(language)[participant.rolePreset];

  if (language === "fr") {
    return [
      rolePreset.systemPrompt,
      `Nom d'affichage: ${participant.displayName}.`,
      participant.customInstruction?.trim()
        ? `Instruction supplementaire:\n${participant.customInstruction.trim()}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    rolePreset.systemPrompt,
    `Display name: ${participant.displayName}.`,
    participant.customInstruction?.trim()
      ? `Additional instruction:\n${participant.customInstruction.trim()}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTurnPrompt(input: {
  participant: ParticipantConfig;
  round: number;
  totalRounds: number;
  brief: string;
  transcript: DebateTurn[];
  sourcePack?: SourcePack | null;
  language: DebateLanguage;
}): string {
  const rolePreset = getRolePresetDefinitions(input.language)[input.participant.rolePreset];
  const outputRules =
    input.language === "fr"
      ? [
          "- 220 a 320 mots.",
          "- 3 a 5 points numerotes.",
          "- Cite au moins 1 desaccord net si necessaire.",
          "- Reste technique, concret, sans flatterie.",
          "- Texte brut uniquement dans les tours de debat. Pas de titres Markdown, pas de gras, pas de blocs de code, pas de mise en forme decorative.",
          "- Termine par 'Priorite immediate:' suivi d'une action unique."
        ]
      : [
          "- 220 to 320 words.",
          "- 3 to 5 numbered points.",
          "- State at least 1 clear disagreement when needed.",
          "- Stay technical, concrete, and non-flattering.",
          "- Plain text only in debate turns. No Markdown headings, bold markers, code fences, or decorative formatting.",
          "- End with 'Immediate priority:' followed by exactly one action."
        ];

  if (input.sourcePack?.excerpts.length) {
    outputRules.splice(
      4,
      0,
      ...(input.language === "fr"
        ? [
            "- Cite le paquet de preuves inline avec des marqueurs du type [SRC-1] quand tu t'en sers.",
            "- N'invente jamais de citations. Si tu vas au-dela du paquet de preuves, indique que c'est une inference."
          ]
        : [
            "- Cite the evidence pack inline with markers like [SRC-1] when you rely on it.",
            "- Never invent citations. If you go beyond the evidence pack, label it as inference."
          ])
    );
  }

  if (input.language === "fr") {
    return [
      input.brief,
      `Tour courant: ${input.round}/${input.totalRounds}`,
      ...(input.sourcePack?.excerpts.length
        ? ["Paquet de preuves:", renderEvidencePack(input.sourcePack, input.language)]
        : []),
      "Historique du debat:",
      renderTranscript(input.transcript, input.language),
      "Consigne de sortie:",
      ...outputRules,
      rolePreset.turnStance
    ].join("\n\n");
  }

  return [
    input.brief,
    `Current round: ${input.round}/${input.totalRounds}`,
    ...(input.sourcePack?.excerpts.length
      ? ["Evidence pack:", renderEvidencePack(input.sourcePack, input.language)]
      : []),
    "Debate transcript so far:",
    renderTranscript(input.transcript, input.language),
    "Output instructions:",
    ...outputRules,
    rolePreset.turnStance
  ].join("\n\n");
}

export function buildSynthesisSystemPrompt(language: DebateLanguage): string {
  if (language === "fr") {
    return [
      "Tu es un redacteur technique severe.",
      "Tu synthetises un debat entre deux participants en une note de travail exploitable.",
      "Tu ne racontes pas le debat: tu produis un document de pilotage.",
      "N'ecris jamais un compte rendu de discussion.",
      "Ne nomme jamais les participants, les roles, ni les modeles.",
      "N'ecris jamais 'le critic dit', 'le builder repond', 'les deux s'accordent' ou une formule equivalente.",
      "Utilise le debat uniquement comme matiere premiere pour un document final autonome.",
      "Parle francais.",
      "Pas de flatterie, pas de fiction, pas de phrases vagues."
    ].join("\n");
  }

  return [
    "You are a severe technical writer.",
    "You synthesize a debate between two participants into an actionable working note.",
    "You do not narrate the debate: you produce a steering document.",
    "Never write a discussion recap.",
    "Do not mention the participants, role presets, or model names.",
    "Never write 'the critic says', 'the builder replies', 'both sides agree', or equivalent recap phrasing.",
    "Use the debate only as raw material for a standalone final document.",
    "Speak English, with the same directness as a severe French technical review.",
    "No flattery, no fiction, no vague phrasing."
  ].join("\n");
}

export function buildSynthesisPrompt(input: {
  settings: DebateSettings;
  brief: string;
  transcript: DebateTurn[];
  sourcePack?: SourcePack | null;
  language: DebateLanguage;
  format: ResolvedDebateSynthesisFormat;
}): string {
  const definition = getSynthesisFormatDefinition(input.language, input.format);

  if (input.language === "fr") {
    return [
      `Sujet: ${input.settings.topic}`,
      `Objectif: ${input.settings.objective}`,
      "Contexte:",
      input.brief,
      ...(input.sourcePack?.excerpts.length
        ? [
            "Paquet de preuves:",
            renderEvidencePack(input.sourcePack, input.language),
            "Utilise des citations [SRC-x] chaque fois que le paquet de preuves soutient une conclusion. N'invente pas de citations."
          ]
        : []),
      "Debat complet:",
      renderTranscript(input.transcript, input.language),
      "Utilise ce debat comme matiere brute, mais n'ecris pas de recapitulatif. N'explique pas qui a dit quoi. Ne mentionne ni participants, ni roles, ni modeles.",
      "Rends un markdown avec exactement ces sections:",
      ...definition.sections,
      definition.finalInstruction
    ].join("\n\n");
  }

  return [
    `Topic: ${input.settings.topic}`,
    `Objective: ${input.settings.objective}`,
    "Context:",
    input.brief,
    ...(input.sourcePack?.excerpts.length
      ? [
          "Evidence pack:",
          renderEvidencePack(input.sourcePack, input.language),
          "Use [SRC-x] citations whenever the evidence pack supports a conclusion. Do not invent citations."
        ]
      : []),
    "Full debate:",
    renderTranscript(input.transcript, input.language),
    "Use this debate as raw material, but do not write a recap. Do not explain who said what. Do not mention participants, role presets, or model names.",
    "Return Markdown with exactly these sections:",
    ...definition.sections,
    definition.finalInstruction
  ].join("\n\n");
}
