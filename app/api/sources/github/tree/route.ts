import { NextRequest, NextResponse } from "next/server";

import { AppError, toErrorResponse } from "@/lib/server/errors";
import { getServerDebateEnv } from "@/lib/server/env";
import { getGitHubSourceTree } from "@/lib/server/source-tree";
import type { GitHubTreeRequestPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as GitHubTreeRequestPayload | null;

    if (!body || typeof body !== "object") {
      throw new AppError("invalid_payload", "Request body must be valid JSON.", 400);
    }

    const env = getServerDebateEnv();
    const tree = await getGitHubSourceTree({
      repoUrl: asString(body.repoUrl),
      ref: asString(body.ref),
      githubToken: asString(body.githubToken) || env.githubToken
    });

    return NextResponse.json(tree);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(toErrorResponse(error), { status: error.status });
    }

    const fallback = new AppError(
      "github_tree_failed",
      "The GitHub repository tree could not be loaded.",
      500
    );

    return NextResponse.json(toErrorResponse(fallback), { status: fallback.status });
  }
}
