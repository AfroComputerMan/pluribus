const ROOT_CONTEXT_ID = "__root__";

type UnknownRecord = Record<string, unknown>;

export type AgentActivityTool = {
  kind: "tool";
  parentId?: string;
  toolCallId: string;
  toolName: string;
  args: UnknownRecord;
  argsText: string;
  artifact?: unknown;
  result?: unknown;
  isError: boolean;
};

export type AgentActivityReasoning = {
  kind: "reasoning";
  parentId?: string;
  text: string;
};

export type AgentActivityItem = AgentActivityTool | AgentActivityReasoning;

export type AgentActivityContext = {
  id: string;
  label: string;
  parentToolCallId?: string;
  items: AgentActivityItem[];
};

export type AgentActivityModel = {
  contexts: AgentActivityContext[];
  hasActivity: boolean;
};

type MessageContentPart = {
  type?: string;
  parentId?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  argsText?: string;
  artifact?: unknown;
  result?: unknown;
  isError?: boolean;
};

function asObject(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as UnknownRecord;
}

function safeParseObject(value: string): UnknownRecord {
  try {
    return asObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function getContextId(parentId?: string): string {
  const trimmed = parentId?.trim();
  return trimmed ? trimmed : ROOT_CONTEXT_ID;
}

function formatContextLabel(
  contextId: string,
  taskArgsByToolCallId: Map<string, UnknownRecord>,
): string {
  if (contextId === ROOT_CONTEXT_ID) return "Main agent";

  const taskArgs = taskArgsByToolCallId.get(contextId);
  if (!taskArgs) return "Sub-agent";

  const subagentType =
    typeof taskArgs.subagent_type === "string" ? taskArgs.subagent_type : "";
  const description =
    typeof taskArgs.description === "string" ? taskArgs.description : "";

  const pieces = [subagentType.trim(), description.trim()].filter(Boolean);
  return pieces.length > 0 ? pieces.join(" · ") : "Sub-agent";
}

export function buildAgentActivityModel(parts: unknown[] | undefined): AgentActivityModel {
  if (!Array.isArray(parts) || parts.length === 0) {
    return { contexts: [], hasActivity: false };
  }

  const contextsById = new Map<string, AgentActivityContext>();
  const orderedContextIds: string[] = [];
  const taskArgsByToolCallId = new Map<string, UnknownRecord>();

  function ensureContext(contextId: string): AgentActivityContext {
    const existing = contextsById.get(contextId);
    if (existing) return existing;

    const context: AgentActivityContext = {
      id: contextId,
      label: contextId === ROOT_CONTEXT_ID ? "Main agent" : "Sub-agent",
      parentToolCallId: contextId === ROOT_CONTEXT_ID ? undefined : contextId,
      items: [],
    };
    contextsById.set(contextId, context);
    orderedContextIds.push(contextId);
    return context;
  }

  for (const raw of parts) {
    const part = raw as MessageContentPart;
    if (part.type !== "reasoning" && part.type !== "tool-call") continue;

    const contextId = getContextId(part.parentId);
    const context = ensureContext(contextId);

    if (part.type === "reasoning") {
      if (!part.text) continue;
      context.items.push({
        kind: "reasoning",
        parentId: part.parentId,
        text: part.text,
      });
      continue;
    }

    const toolCallId = part.toolCallId?.trim() || `tool-${context.items.length}`;
    const toolName = part.toolName?.trim() || "tool";
    const argsText = part.argsText ?? "";
    const args =
      argsText.trim().startsWith("{") || argsText.trim().startsWith("[")
        ? safeParseObject(argsText)
        : asObject(part.args);

    if (toolName === "Task") {
      taskArgsByToolCallId.set(toolCallId, args);
    }

    context.items.push({
      kind: "tool",
      parentId: part.parentId,
      toolCallId,
      toolName,
      args,
      argsText: argsText || JSON.stringify(args),
      artifact: part.artifact,
      result: part.result,
      isError: part.isError === true,
    });
  }

  const contexts = orderedContextIds
    .map((id) => {
      const context = contextsById.get(id);
      if (!context || context.items.length === 0) return null;
      return {
        ...context,
        label: formatContextLabel(id, taskArgsByToolCallId),
      };
    })
    .filter((context): context is AgentActivityContext => Boolean(context));

  return {
    contexts,
    hasActivity: contexts.length > 0,
  };
}
