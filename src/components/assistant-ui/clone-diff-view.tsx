import { CodePanel } from "@/components/assistant-ui/code-panel";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  FileCheckIcon,
} from "lucide-react";
import { type FC, type ReactNode, useState } from "react";

/**
 * Mirrors the Rust `FileDiff` serde struct from `src-tauri/src/pi/diff.rs`.
 */
export interface FileDiff {
  path: string;
  base_path: string | null;
  status: "added" | "deleted" | "renamed" | "modified";
  hunks: string;
}

/**
 * Mirrors the Rust `DiffResult` serde tagged enum (`tag = "kind"`,
 * `rename_all = "snake_case"`) from `src-tauri/src/pi/diff.rs`.
 */
export type DiffResult =
  | { kind: "no_clone" }
  | { kind: "empty" }
  | { kind: "git_error"; message: string }
  | {
      kind: "diff";
      files: FileDiff[];
      truncated: boolean;
      total_lines: number;
    };

const STATUS_VARIANT: Record<
  FileDiff["status"],
  "default" | "secondary" | "outline"
> = {
  added: "default",
  modified: "secondary",
  renamed: "secondary",
  deleted: "outline",
};

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-0.5", className)}>
      <p className="mb-0.5 text-[10px] text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function FileDiffEntry({ file }: { file: FileDiff }) {
  const [open, setOpen] = useState(false);

  const label =
    file.status === "renamed" && file.base_path
      ? `${file.base_path} → ${file.path}`
      : file.path;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border/60 bg-muted/20"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {label}
        </span>
        <Badge variant={STATUS_VARIANT[file.status]} className="text-[10px]">
          {file.status}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2">
        <Section title="diff">
          <CodePanel language="diff" text={file.hunks} maxLines={40} />
        </Section>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DiffBody({ result }: { result: DiffResult }) {
  switch (result.kind) {
    case "no_clone":
      return (
        <p className="text-sm text-muted-foreground">
          No clone is associated with this thread.
        </p>
      );

    case "empty":
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <FileCheckIcon className="size-6" />
          <p className="text-sm">The agent made no changes.</p>
        </div>
      );

    case "git_error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200/90">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Failed to compute diff</p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
              {result.message}
            </pre>
          </div>
        </div>
      );

    case "diff":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {result.files.length}{" "}
            {result.files.length === 1 ? "file" : "files"} changed
          </p>
          {result.files.map((file) => (
            <FileDiffEntry key={file.path} file={file} />
          ))}
          {result.truncated && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Diff truncated at {result.total_lines.toLocaleString()} lines.
                Open the clone directly to review the full changes.
              </span>
            </div>
          )}
        </div>
      );
  }
}

export const CloneDiffView: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DiffResult | null;
  loading?: boolean;
}> = ({ open, onOpenChange, result, loading }) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>Review changes</SheetTitle>
          <SheetDescription>
            What the agent changed in its clone, compared to the base commit.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Computing diff…</p>
          ) : result ? (
            <DiffBody result={result} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};
