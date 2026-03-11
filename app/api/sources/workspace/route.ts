import { NextRequest, NextResponse } from "next/server";

import { AppError, toErrorResponse } from "@/lib/server/errors";
import { getWorkspaceSourceTree } from "@/lib/server/source-tree";
import type { LocalRepoTreeRequestPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    toErrorResponse(
      new AppError(
        "local_repo_path_required",
        "Use POST /api/sources/workspace with a repoPath to load a local repository tree.",
        400
      )
    ),
    { status: 400 }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as LocalRepoTreeRequestPayload | null;

    if (!body || typeof body !== "object") {
      throw new AppError("invalid_payload", "Request body must be valid JSON.", 400);
    }

    const tree = await getWorkspaceSourceTree({
      repoPath: asString(body.repoPath)
    });
    return NextResponse.json(tree);
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(toErrorResponse(error), { status: error.status });
    }

    const fallback = new AppError(
      "workspace_tree_failed",
      "The workspace file tree could not be loaded.",
      500
    );

    return NextResponse.json(toErrorResponse(fallback), { status: fallback.status });
  }
}
