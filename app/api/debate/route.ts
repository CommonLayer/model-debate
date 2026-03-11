import { NextRequest, NextResponse } from "next/server";

import { runDebate } from "@/lib/server/debate-runner";
import { AppError, ProviderRequestError, toErrorResponse } from "@/lib/server/errors";
import { getServerDebateEnv } from "@/lib/server/env";
import type { DebateRequestPayload, DebateSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function resolveSettings(body: Record<string, unknown>): {
  credentials: {
    openrouterApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
  };
  settings: DebateSettings;
} {
  const env = getServerDebateEnv();
  const participantA = asRecord(body.participantA);
  const participantB = asRecord(body.participantB);

  const topic = asString(body.topic).slice(0, 2000);
  const objective = asString(body.objective).slice(0, 4000);
  const rounds = asInteger(body.rounds, env.defaults.rounds, 1, 5);
  const participantAModel = asString(participantA?.model) || env.defaults.participantAModel;
  const participantBModel = asString(participantB?.model) || env.defaults.participantBModel;
  const synthesisModel = asString(body.synthesisModel) || env.defaults.synthesisModel;
  const openrouterApiKey = asString(body.apiKey) || env.openrouterApiKey;

  if (!topic || !objective) {
    throw new AppError(
      "invalid_payload",
      "Topic and objective are required before starting a debate.",
      400
    );
  }

  if (!openrouterApiKey && !env.openaiApiKey && !env.anthropicApiKey) {
    throw new AppError(
      "missing_provider_keys",
      "Provide an OpenRouter API key in the UI, set OPENROUTER_API_KEY, or configure OPENAI_API_KEY and ANTHROPIC_API_KEY in the environment.",
      400
    );
  }

  return {
    credentials: {
      openrouterApiKey,
      openaiApiKey: env.openaiApiKey,
      anthropicApiKey: env.anthropicApiKey
    },
    settings: {
      topic,
      objective,
      rounds,
      participantA: {
        slot: "A",
        model: participantAModel
      },
      participantB: {
        slot: "B",
        model: participantBModel
      },
      synthesisModel
    }
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as DebateRequestPayload | null;

    if (!body || typeof body !== "object") {
      throw new AppError("invalid_payload", "Request body must be valid JSON.", 400);
    }

    const { credentials, settings } = resolveSettings(body);
    const result = await runDebate({
      credentials,
      settings
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return NextResponse.json(toErrorResponse(error), { status: 502 });
    }

    if (error instanceof AppError) {
      return NextResponse.json(toErrorResponse(error), { status: error.status });
    }

    const fallback = new AppError(
      "unexpected_error",
      "The debate run failed before a result could be returned.",
      500
    );

    return NextResponse.json(toErrorResponse(fallback), { status: fallback.status });
  }
}
