import { NextRequest, NextResponse } from "next/server";

import { AppError, toErrorResponse } from "@/lib/server/errors";
import { loadModelCatalog } from "@/lib/server/model-catalog";

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

export async function GET(): Promise<NextResponse> {
  const catalog = await loadModelCatalog();

  return NextResponse.json(catalog);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body = asRecord(rawBody);

    if (!body) {
      throw new AppError("invalid_payload", "Request body must be valid JSON.", 400);
    }

    const catalog = await loadModelCatalog({
      openrouterApiKey: asString(body.apiKey)
    });

    return NextResponse.json(catalog);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(toErrorResponse(error), { status: error.status });
    }

    const fallback = new AppError(
      "unexpected_error",
      "Model discovery failed before a catalog could be returned.",
      500
    );

    return NextResponse.json(toErrorResponse(fallback), { status: fallback.status });
  }
}
