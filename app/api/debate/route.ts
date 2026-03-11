import { NextRequest, NextResponse } from "next/server";

import {
  DEFAULT_BUILDER_DISPLAY_NAME,
  DEFAULT_CRITIC_DISPLAY_NAME
} from "@/lib/prompts";
import { runDebate } from "@/lib/server/debate-runner";
import { AppError, ProviderRequestError, toErrorResponse } from "@/lib/server/errors";
import { getServerDebateEnv } from "@/lib/server/env";
import type {
  DebateSynthesisFormat,
  DebateRequestPayload,
  DebateStreamEvent,
  DebateSettings,
  SourceFileRef,
  SourcePack
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

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

function asSynthesisFormat(value: unknown): DebateSynthesisFormat {
  const candidate = asString(value);

  if (
    candidate === "auto" ||
    candidate === "tech_architecture" ||
    candidate === "decision_strategy" ||
    candidate === "factual_practical" ||
    candidate === "proof_validation"
  ) {
    return candidate;
  }

  return "auto";
}

function sanitizeSourceFileRef(value: unknown): SourceFileRef | null {
  const record = asRecord(value);
  const origin = asString(record?.origin);
  const label = asString(record?.label).slice(0, 512);
  const id = asString(record?.id).slice(0, 512);

  if (!record || !id || !label) {
    return null;
  }

  if (origin !== "upload" && origin !== "workspace" && origin !== "github") {
    return null;
  }

  return {
    id,
    origin,
    label,
    path: asString(record.path).slice(0, 1024) || undefined,
    repoUrl: asString(record.repoUrl).slice(0, 512) || undefined,
    ref: asString(record.ref).slice(0, 256) || undefined,
    size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : undefined
  };
}

function sanitizeSourcePack(value: unknown): SourcePack | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  const files = Array.isArray(record.files)
    ? record.files
        .map((item) => sanitizeSourceFileRef(item))
        .filter((item): item is SourceFileRef => item !== null)
    : [];
  const excerpts = Array.isArray(record.excerpts)
    ? record.excerpts
        .map((item) => {
          const excerpt = asRecord(item);

          if (!excerpt) {
            return null;
          }

          const id = asString(excerpt.id).slice(0, 64);
          const sourceId = asString(excerpt.sourceId).slice(0, 512);
          const title = asString(excerpt.title).slice(0, 512);
          const text = asString(excerpt.text).slice(0, 12000);
          const locator = asString(excerpt.locator).slice(0, 512);

          if (!id || !sourceId || !title || !text || !locator) {
            return null;
          }

          return {
            id,
            sourceId,
            title,
            text,
            locator
          };
        })
        .filter(
          (
            item
          ): item is {
            id: string;
            sourceId: string;
            title: string;
            text: string;
            locator: string;
          } => item !== null
        )
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((warning) => asString(warning).slice(0, 512)).filter(Boolean)
    : [];

  if (files.length === 0 && excerpts.length === 0 && warnings.length === 0) {
    return null;
  }

  return {
    files,
    excerpts,
    warnings
  };
}

function resolveSettings(body: Record<string, unknown>): {
  credentials: {
    openrouterApiKey: string;
    openaiApiKey: string;
    anthropicApiKey: string;
  };
  settings: DebateSettings;
  sourcePack: SourcePack | null;
} {
  const env = getServerDebateEnv();
  const participantA = asRecord(body.participantA);
  const participantB = asRecord(body.participantB);

  const topic = asString(body.topic).slice(0, 2000);
  const objective = asString(body.objective).slice(0, 4000);
  const notes = asString(body.notes).slice(0, 6000);
  const rounds = asInteger(body.rounds, env.defaults.rounds, 1, 5);
  const synthesisFormat = asSynthesisFormat(body.synthesisFormat);
  const participantAModel =
    asString(participantA?.modelId) || asString(participantA?.model) || env.defaults.participantAModel;
  const participantBModel =
    asString(participantB?.modelId) || asString(participantB?.model) || env.defaults.participantBModel;
  const synthesisModel = asString(body.synthesisModel) || env.defaults.synthesisModel;
  const openrouterApiKey = asString(body.apiKey) || env.openrouterApiKey;
  const sourcePack = sanitizeSourcePack(body.sourcePack);

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
      notes,
      rounds,
      participantA: {
        slot: "A",
        displayName: asString(participantA?.displayName) || DEFAULT_CRITIC_DISPLAY_NAME,
        modelId: participantAModel,
        rolePreset: "critic",
        customInstruction: asString(participantA?.customInstruction) || undefined
      },
      participantB: {
        slot: "B",
        displayName: asString(participantB?.displayName) || DEFAULT_BUILDER_DISPLAY_NAME,
        modelId: participantBModel,
        rolePreset: "builder",
        customInstruction: asString(participantB?.customInstruction) || undefined
      },
      synthesisModel,
      synthesisFormat
    },
    sourcePack
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as DebateRequestPayload | null;

    if (!body || typeof body !== "object") {
      throw new AppError("invalid_payload", "Request body must be valid JSON.", 400);
    }

    if (body.stream === true) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const writeEvent = (event: DebateStreamEvent): void => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          try {
            const { credentials, settings, sourcePack } = resolveSettings(body as Record<string, unknown>);
            const result = await runDebate({
              credentials,
              settings,
              sourcePack,
              onStatus: (event) => {
                writeEvent(event);
              }
            });

            writeEvent({
              type: "result",
              result
            });
          } catch (error) {
            if (error instanceof ProviderRequestError) {
              writeEvent({
                type: "error",
                ...toErrorResponse(error)
              });
            } else if (error instanceof AppError) {
              writeEvent({
                type: "error",
                ...toErrorResponse(error)
              });
            } else {
              const fallback = new AppError(
                "unexpected_error",
                "The debate run failed before a result could be returned.",
                500
              );

              writeEvent({
                type: "error",
                ...toErrorResponse(fallback)
              });
            }
          } finally {
            controller.close();
          }
        }
      });

      return new NextResponse(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no"
        }
      });
    }

    const { credentials, settings, sourcePack } = resolveSettings(body);
    const result = await runDebate({
      credentials,
      settings,
      sourcePack
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
