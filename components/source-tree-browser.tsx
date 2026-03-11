"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { File, FolderTree, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { SourceTreeNode } from "@/lib/types";

type SourceTreeBrowserProps = {
  nodes: SourceTreeNode[];
  rootLabel: string;
  selectedPaths: string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onTogglePath: (path: string) => void;
  emptyLabel: string;
};

function filterNodes(nodes: SourceTreeNode[], query: string): SourceTreeNode[] {
  if (!query) {
    return nodes;
  }

  const lowered = query.toLowerCase();

  return nodes.reduce<SourceTreeNode[]>((accumulator, node) => {
    if (node.kind === "directory") {
      const filteredChildren = filterNodes(node.children || [], query);

      if (node.name.toLowerCase().includes(lowered) || filteredChildren.length > 0) {
        accumulator.push({
          ...node,
          children: filteredChildren
        });
      }

      return accumulator;
    }

    if (
      node.name.toLowerCase().includes(lowered) ||
      node.path.toLowerCase().includes(lowered)
    ) {
      accumulator.push(node);
    }

    return accumulator;
  }, []);
}

function renderNode(input: {
  node: SourceTreeNode;
  depth: number;
  selectedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  forceOpen: boolean;
}): ReactNode {
  const { node } = input;

  if (node.kind === "directory") {
    return (
      <details
        key={node.id}
        className="rounded-lg border border-border/70 bg-background/40"
        open={input.forceOpen || input.depth < 1}
      >
        <summary className="cursor-pointer list-none px-3 py-2 text-sm text-foreground">
          <span className="inline-flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            {node.name}
          </span>
        </summary>
        <div className="space-y-2 border-t border-border/70 px-3 py-2">
          {(node.children || []).map((child) =>
            renderNode({
              node: child,
              depth: input.depth + 1,
              selectedPaths: input.selectedPaths,
              onTogglePath: input.onTogglePath,
              forceOpen: input.forceOpen
            })
          )}
        </div>
      </details>
    );
  }

  const checked = input.selectedPaths.has(node.path);

  return (
    <label
      key={node.id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm transition-colors hover:bg-background/70"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => input.onTogglePath(node.path)}
        className="mt-1 h-4 w-4 rounded border-border bg-background"
      />
      <div className="min-w-0 flex-1">
        <div className="inline-flex items-center gap-2 text-foreground">
          <File className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{node.path}</div>
      </div>
    </label>
  );
}

export function SourceTreeBrowser({
  nodes,
  rootLabel,
  selectedPaths,
  searchValue,
  onSearchChange,
  onTogglePath,
  emptyLabel
}: SourceTreeBrowserProps) {
  const filteredNodes = useMemo(
    () => filterNodes(nodes, searchValue.trim()),
    [nodes, searchValue]
  );
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{rootLabel}</span>
          <span className="ml-2">{selectedPaths.length} selected</span>
        </div>
      </div>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search files"
          className="pl-9"
        />
      </label>

      <div className="scroll-soft max-h-64 space-y-2 overflow-auto rounded-xl border border-border/70 bg-background/30 p-2">
        {filteredNodes.length > 0 ? (
          filteredNodes.map((node) =>
            renderNode({
              node,
              depth: 0,
              selectedPaths: selectedPathSet,
              onTogglePath,
              forceOpen: !!searchValue.trim()
            })
          )
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
