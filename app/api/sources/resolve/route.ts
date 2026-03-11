import { NextRequest, NextResponse } from "next/server";

import { AppError, toErrorResponse } from "@/lib/server/errors";
import { getServerDebateEnv } from "@/lib/server/env";
import { resolveSourcePack } from "@/lib/server/source-resolver";
import type { SourceResolveManifest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseManifest(rawValue: string): SourceResolveManifest {
  if (!rawValue) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new AppError("invalid_manifest", "The source manifest must be valid JSON.", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("invalid_manifest", "The source manifest must be a JSON object.", 400);
  }

  return parsed as SourceResolveManifest;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const env = getServerDebateEnv();
    const manifest = parseManifest(asString(formData.get("manifest")));
    const githubToken = asString(formData.get("githubToken")) || env.githubToken;
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const sourcePack = await resolveSourcePack({
      manifest,
      uploadFiles: files,
      githubToken
    });

    return NextResponse.json(sourcePack);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(toErrorResponse(error), { status: error.status });
    }

    const fallback = new AppError(
      "source_resolution_failed",
      "The selected sources could not be prepared.",
      500
    );

    return NextResponse.json(toErrorResponse(fallback), { status: fallback.status });
  }
}
