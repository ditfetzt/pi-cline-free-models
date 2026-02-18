import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import * as http from "node:http";
import * as url from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

// ULID generation (Crockford's Base32, 48-bit timestamp + 80-bit random)
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function generateUlid(): string {
  const now = Date.now();
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = ULID_CHARS[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rand = crypto.randomBytes(16);
  let r = "";
  for (let i = 0; i < 16; i++) {
    r += ULID_CHARS[rand[i] % 32];
  }
  return ts + r;
}

// Cline client identity (match official VS Code extension)
const CLINE_VERSION = "3.63.0";
const CLINE_API_BASE = (process.env.PI_CLINE_API_BASE || "https://api.cline.bot/api/v1").replace(/\/+$/, "");
const CLINE_PLATFORM = "Visual Studio Code";
const CLINE_PLATFORM_VERSION = "1.109.3";
const CLINE_CLIENT_TYPE = "VSCode Extension";

function buildBasicClineHeaders(): Record<string, string> {
  return {
    "X-Platform": CLINE_PLATFORM,
    "X-Platform-Version": CLINE_PLATFORM_VERSION,
    "X-Client-Type": CLINE_CLIENT_TYPE,
    "X-Client-Version": CLINE_VERSION,
    "X-Core-Version": CLINE_VERSION,
  };
}

function buildClineCompletionHeaders(taskId: string = generateUlid()): Record<string, string> {
  return {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "X-Task-ID": taskId,
    ...buildBasicClineHeaders(),
    "X-Is-Multiroot": "false",
  };
}

function buildClineAuthHeaders(): Record<string, string> {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...buildBasicClineHeaders(),
  };
}

type ClineScaffold = {
  taskProgress: string;
  environmentDetails: string;
};

const FALLBACK_TASK_PROGRESS_BLOCK = `
# task_progress List (Optional - Plan Mode)

While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary todo list using the task_progress parameter.

Reminder on how to use the task_progress parameter:


1. To create or update a todo list, include the task_progress parameter in the next tool call
2. Review each item and update its status:
   - Mark completed items with: - [x]
   - Keep incomplete items as: - [ ]
   - Add new items if you discover additional steps
3. Modify the list as needed:
		- Add any new steps you've discovered
		- Reorder if the sequence has changed
4. Ensure the list accurately reflects the current state

**Remember:** Keeping the task_progress list updated helps track progress and ensures nothing is missed.`;

function formatLocalTimeWithTimezone(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  });
  const timeZone = formatter.resolvedOptions().timeZone;
  const timeZoneOffset = -now.getTimezoneOffset() / 60;
  const timeZoneOffsetStr = `${timeZoneOffset >= 0 ? "+" : ""}${timeZoneOffset}:00`;
  return `${formatter.format(now)} (${timeZone}, UTC${timeZoneOffsetStr})`;
}

function buildFallbackEnvironmentDetails(): string {
  const cwd = process.cwd();
  const hint = path.basename(cwd) || "workspace";
  return `<environment_details>
# Visual Studio Code Visible Files
(No visible files)

# Visual Studio Code Open Tabs
(No open tabs)

# Current Time
${formatLocalTimeWithTimezone()}

# Current Working Directory (${cwd}) Files
(No files)

# Workspace Configuration
{
  "workspaces": {
    "${cwd}": {
      "hint": "${hint}"
    }
  }
}

# Detected CLI Tools
These are some of the tools on the user's machine, and may be useful if needed to accomplish the task: gh, git, docker, kubectl, npm, yarn, pnpm, cargo, go, curl, jq, make, node, psql, sqlite3, code, grep, sed, awk, brew, bundle. This list is not exhaustive, and other tools may be available.

# Context Window Usage
0 / 204,8K tokens used (0%)

# Current Mode
PLAN MODE
In this mode you should focus on information gathering, asking questions, and architecting a solution. Once you have a plan, use the plan_mode_respond tool to engage in a conversational back and forth with the user. Do not use the plan_mode_respond tool until you've gathered all the information you need e.g. with read_file or ask_followup_question.
(Remember: If it seems the user wants you to use tools only available in Act Mode, you should ask the user to "toggle to Act mode" (use those words) - they will have to manually do this themselves with the Plan/Act toggle button below. You do not have the ability to switch to Act Mode yourself, and must wait for the user to do it themselves once they are satisfied with the plan. You also cannot present an option to toggle to Act mode, as this will be something you need to direct the user to do manually themselves.)
</environment_details>`;
}

function loadScaffoldFromDebugCapture(): ClineScaffold | null {
  try {
    const candidateDirs = [
      process.env.PI_CLINE_CAPTURE_DIR,
      path.join(process.cwd(), ".debug", "capture"),
      path.join(process.cwd(), ".debug-capture"), // legacy location
      path.join(os.homedir(), ".pi", "agent", ".debug", "capture"),
      path.join(os.homedir(), ".pi", "agent", ".debug-capture"), // legacy location
    ].filter((d): d is string => !!d);

    for (const captureDir of candidateDirs) {
      if (!fs.existsSync(captureDir)) continue;

      const files = fs
        .readdirSync(captureDir)
        .filter(f => f.endsWith("-request.body.json"))
        .sort()
        .reverse();

      for (const file of files) {
        const body = JSON.parse(fs.readFileSync(path.join(captureDir, file), "utf-8"));
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        for (const msg of messages) {
          if (msg?.role !== "user" || !Array.isArray(msg?.content)) continue;
          const textBlocks = msg.content
            .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
            .map((part: any) => part.text as string);

          const taskProgress = textBlocks.find((t: string) => t.includes("# task_progress List (Optional - Plan Mode)"));
          const environmentDetails = textBlocks.find((t: string) => t.includes("<environment_details>"));

          if (taskProgress && environmentDetails) {
            return { taskProgress, environmentDetails };
          }
        }
      }
    }
  } catch {
    // Ignore scaffold parse errors
  }
  return null;
}

function extractUserText(content: any): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("\n\n")
      .trim();
  }
  return "";
}

function wrapUserMessageForCline(content: any, scaffold: ClineScaffold): any[] {
  const userText = extractUserText(content) || "(no user text)";
  const images = Array.isArray(content)
    ? content.filter((part: any) => part?.type === "image" && part?.mimeType && part?.data)
    : [];

  return [
    { type: "text", text: `<task>\n${userText}\n</task>` },
    { type: "text", text: scaffold.taskProgress },
    { type: "text", text: scaffold.environmentDetails },
    ...images,
  ];
}

function isClineWrappedUserContent(content: any): boolean {
  if (!Array.isArray(content)) return false;

  const textBlocks = content
    .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
    .map((part: any) => part.text as string);

  if (textBlocks.length < 1) return false;

  const hasTask = textBlocks.some((t: string) => /<task>[\s\S]*<\/task>/.test(t));
  const hasTaskProgress = textBlocks.some((t: string) => t.includes("# task_progress List (Optional - Plan Mode)"));
  const hasEnvironment = textBlocks.some((t: string) => t.includes("<environment_details>"));

  return hasTask && hasTaskProgress && hasEnvironment;
}

function extractTaskBodyFromWrappedContent(content: any): string {
  if (!Array.isArray(content)) return "";

  for (const part of content) {
    if (part?.type !== "text" || typeof part?.text !== "string") continue;
    const match = part.text.match(/<task>\s*([\s\S]*?)\s*<\/task>/);
    if (match && typeof match[1] === "string") {
      return match[1].trim();
    }
  }

  return "";
}

type ToolCallContext = {
  name: string;
  summary: string;
};

function parseToolCallArguments(rawArgs: any): any {
  if (rawArgs == null) return {};
  if (typeof rawArgs === "object") return rawArgs;
  if (typeof rawArgs === "string") {
    try {
      return JSON.parse(rawArgs);
    } catch {
      return { raw: rawArgs };
    }
  }
  return { raw: String(rawArgs) };
}

function summarizeToolCall(name: string, rawArgs: any): string {
  const args = parseToolCallArguments(rawArgs);

  if (name === "bash" && typeof args?.command === "string") {
    return `$ ${args.command}`;
  }

  if (name === "read" && typeof args?.path === "string") {
    return `read ${args.path}`;
  }

  if (name === "edit" && typeof args?.path === "string") {
    return `edit ${args.path}`;
  }

  if (name === "write" && typeof args?.path === "string") {
    return `write ${args.path}`;
  }

  const compact = JSON.stringify(args);
  if (compact && compact !== "{}") {
    return `${name} ${compact.slice(0, 240)}`;
  }

  return name;
}

function collectToolCallContext(messages: any[]): Map<string, ToolCallContext> {
  const byId = new Map<string, ToolCallContext>();

  for (const msg of messages) {
    const contentParts = Array.isArray(msg?.content) ? msg.content : [];

    const fromContent = contentParts
      .filter((part: any) => part?.type === "toolCall" && part?.id && part?.name)
      .map((part: any) => ({
        id: String(part.id),
        name: String(part.name),
        arguments: part.arguments,
      }));

    const fromToolCalls = Array.isArray(msg?.toolCalls)
      ? msg.toolCalls
        .filter((call: any) => call?.id && call?.name)
        .map((call: any) => ({
          id: String(call.id),
          name: String(call.name),
          arguments: call.arguments,
        }))
      : [];

    const fromToolCallsSnake = Array.isArray(msg?.tool_calls)
      ? msg.tool_calls
        .filter((call: any) => call?.id && (call?.name || call?.function?.name))
        .map((call: any) => ({
          id: String(call.id),
          name: String(call.name || call.function?.name),
          arguments: call.arguments ?? call.function?.arguments,
        }))
      : [];

    const calls = [...fromContent, ...fromToolCalls, ...fromToolCallsSnake];

    for (const call of calls) {
      byId.set(call.id, {
        name: call.name,
        summary: summarizeToolCall(call.name, call.arguments),
      });
    }
  }

  return byId;
}

function sanitizeMessageContentForCline(msg: any): any {
  if (!msg || typeof msg !== "object") return msg;

  const role = typeof msg.role === "string" ? msg.role : "user";
  const fallbackText =
    role === "assistant"
      ? "(assistant message)"
      : role === "tool"
        ? "(tool output)"
        : "(no content)";

  // Remove tool-calling metadata for Cline provider history serialization.
  // Anthropic-backed routes can reject mixed/empty tool-call message shapes.
  const baseMessage: any = { ...msg };
  delete baseMessage.toolCalls;
  delete baseMessage.tool_calls;
  delete baseMessage.functionCall;
  delete baseMessage.function_call;
  delete baseMessage.toolCall;

  if (typeof msg.content === "string") {
    return {
      ...baseMessage,
      content: msg.content.trim().length > 0 ? msg.content : fallbackText,
    };
  }

  if (Array.isArray(msg.content)) {
    const textParts = msg.content.filter(
      (part: any) => part?.type === "text" && typeof part?.text === "string" && part.text.trim().length > 0,
    );

    // Keep images for user turns only; drop other non-text parts (e.g. toolCall)
    // because they can lead to empty assistant/tool messages on Anthropic routes.
    const imageParts = role === "user"
      ? msg.content.filter((part: any) => part?.type === "image" && part?.mimeType && part?.data)
      : [];

    const normalized = [...textParts, ...imageParts];

    if (textParts.length === 0) {
      return {
        ...baseMessage,
        content: [{ type: "text", text: fallbackText }, ...normalized],
      };
    }

    return { ...baseMessage, content: normalized };
  }

  if (msg.content == null) {
    return { ...baseMessage, content: fallbackText };
  }

  // Unknown content shape: coerce to safe text for Anthropic compatibility.
  return { ...baseMessage, content: fallbackText };
}

function collapseContextMessagesForCline(messages: any[], scaffold: ClineScaffold): any[] {
  const toolCallContextById = collectToolCallContext(messages);
  const sanitized = messages.map((m: any) => sanitizeMessageContentForCline(m));

  const firstSystem = sanitized.find((m: any) => m?.role === "system");
  const systemText = firstSystem ? extractUserText(firstSystem.content) : "";

  // Idempotency: if we already have a wrapped Cline user message in the history,
  // reuse its <task> body and append only the turns that happened after it.
  let lastWrappedUserIndex = -1;
  let baseTranscript = "";

  for (let i = sanitized.length - 1; i >= 0; i--) {
    const msg = sanitized[i];
    if (msg?.role !== "user") continue;
    if (!isClineWrappedUserContent(msg?.content)) continue;

    lastWrappedUserIndex = i;
    baseTranscript = extractTaskBodyFromWrappedContent(msg.content);
    break;
  }

  const transcriptParts: string[] = [];
  if (baseTranscript.length > 0) {
    transcriptParts.push(baseTranscript);
  }

  const startIndex = lastWrappedUserIndex >= 0 ? lastWrappedUserIndex + 1 : 0;
  const noOutputCountsByCommand = new Map<string, number>();
  const seenNoOutputCommands = new Set<string>();

  for (let i = startIndex; i < sanitized.length; i++) {
    const sourceMsg = messages[i] ?? {};
    const msg = sanitized[i];
    const role = typeof msg?.role === "string" ? msg.role : "user";
    if (role === "system") continue;
    if (role === "user" && isClineWrappedUserContent(msg?.content)) continue;

    const hasToolCallMetadata =
      Array.isArray((sourceMsg as any)?.toolCalls) ||
      Array.isArray((sourceMsg as any)?.tool_calls) ||
      (Array.isArray((sourceMsg as any)?.content) &&
        (sourceMsg as any).content.some((part: any) => part?.type === "toolCall"));

    // Assistant tool-call turns are usually orchestration text ("I'll run ...").
    // Excluding them reduces self-referential looping while preserving actual tool output.
    if (role === "assistant" && hasToolCallMetadata) continue;

    const text = extractUserText(msg?.content).trim();
    if (!text) continue;

    if (role === "tool") {
      const toolCallId =
        (sourceMsg as any)?.toolCallId ??
        (sourceMsg as any)?.tool_call_id ??
        (sourceMsg as any)?.toolCallID ??
        null;

      const toolContext =
        typeof toolCallId === "string" ? toolCallContextById.get(toolCallId) : undefined;

      const toolName =
        toolContext?.name ||
        (typeof (sourceMsg as any)?.toolName === "string" ? (sourceMsg as any).toolName : "tool");

      const toolCallSummary = toolContext?.summary || toolName;
      const isNoOutputResult = text === "(no output)";

      if (isNoOutputResult) {
        const previousCount = noOutputCountsByCommand.get(toolCallSummary) || 0;
        noOutputCountsByCommand.set(toolCallSummary, previousCount + 1);

        // Keep only the first identical no-output command result in transcript
        // so repeated retries don't dominate context and induce loops.
        if (seenNoOutputCommands.has(toolCallSummary)) {
          continue;
        }
        seenNoOutputCommands.add(toolCallSummary);
      }

      transcriptParts.push(
        `<tool_result>\n<tool_call>\n${toolCallSummary}\n</tool_call>\n${text}\n</tool_result>`,
      );
    } else {
      transcriptParts.push(`[${role}]\n${text}`);
    }
  }

  const repeatedNoOutput = [...noOutputCountsByCommand.entries()]
    .filter(([, count]) => count > 1);

  if (repeatedNoOutput.length > 0) {
    const lines = repeatedNoOutput
      .map(([summary, count]) => {
        const hasLikelyWrongDiffScope = /git\s+diff\s+main\.\.\.origin\/main/.test(summary);
        const hint = hasLikelyWrongDiffScope
          ? " (this branch-range diff can be empty for local uncommitted changes; try `git diff` / `git diff --stat`)"
          : "";
        return `- ${summary} -> ${count} no-output attempts${hint}`;
      })
      .join("\n");

    transcriptParts.push(
      `[system_note]\nRepeated no-output tool calls detected:\n${lines}\nDo not repeat the same no-output command. Use an alternative command or proceed with available evidence.`,
    );
  }

  const transcript = transcriptParts.join("\n\n").trim() || "(no conversation yet)";

  const collapsed: any[] = [];
  if (systemText.trim().length > 0) {
    collapsed.push({ role: "system", content: systemText });
  }

  collapsed.push({
    role: "user",
    content: wrapUserMessageForCline(transcript, scaffold),
  });

  return collapsed;
}

// Cache file path for model state persistence
const MODELS_CACHE_FILE = path.join(os.homedir(), ".pi", "agent", ".cline-models-cache.json");

// Last known models (for comparison)
let lastKnownModels: any[] = [];

// Track selected provider to limit context shaping to Cline
let selectedProvider: string | null = null;

function isLikelyClineProvider(ctx: any): boolean {
  const provider = (ctx as any)?.model?.provider;
  if (provider === "cline") return true;
  if (selectedProvider === "cline") return true;

  const modelId = (ctx as any)?.model?.id;
  if (typeof modelId === "string" && lastKnownModels.some((m: any) => m.id === modelId)) return true;

  try {
    const entries = (ctx as any)?.sessionManager?.getEntries?.();
    if (Array.isArray(entries)) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry: any = entries[i];
        if (entry?.type !== "model_change") continue;
        if (entry?.provider === "cline") return true;
        break;
      }
    }
  } catch {
    // Ignore session history lookup errors
  }

  return false;
}

// Cline request scaffold (prefer extracted template from local debug capture if available)
let clineScaffold: ClineScaffold = {
  taskProgress: FALLBACK_TASK_PROGRESS_BLOCK,
  environmentDetails: buildFallbackEnvironmentDetails(),
};

const scaffoldFromCapture = loadScaffoldFromDebugCapture();
if (scaffoldFromCapture) {
  clineScaffold = scaffoldFromCapture;
}

// Load cached models if exists
try {
  if (fs.existsSync(MODELS_CACHE_FILE)) {
    const cache = JSON.parse(fs.readFileSync(MODELS_CACHE_FILE, "utf-8"));
    lastKnownModels = cache.models || [];
  }
} catch {
  // Ignore cache load errors
}

export default function (pi: ExtensionAPI) {
  // Register provider immediately with cached models if available
  // This ensures models are available for /model and /scoped-models right away
  registerClineProvider(pi, lastKnownModels);

  // Track selected provider to apply Cline-specific context shaping only when needed
  pi.on("model_select", async (event) => {
    selectedProvider = event.model?.provider || null;
  });

  // Shape outgoing context to mimic Cline's expected request envelope
  // (currently required by api.cline.bot for chat/completions authorization)
  pi.on("context", async (event, ctx) => {
    if (!isLikelyClineProvider(ctx)) return;
    selectedProvider = "cline";

    const sourceMessages = Array.isArray(event.messages) ? event.messages : [];
    const messages = collapseContextMessagesForCline(sourceMessages, clineScaffold);

    return { messages };
  });

  // Refresh headers (especially X-Task-ID) for every prompt
  pi.on("before_agent_start", async (_event, ctx) => {
    if (isLikelyClineProvider(ctx)) {
      selectedProvider = "cline";
    } else {
      selectedProvider = (ctx as any)?.model?.provider || selectedProvider;
    }
    registerClineProvider(pi, lastKnownModels);
  });

  // Non-blocking model refresh on session start
  pi.on("session_start", async (_event, ctx) => {
    if (isLikelyClineProvider(ctx)) {
      selectedProvider = "cline";
    }

    // Refresh provider identity at session boundary as well
    registerClineProvider(pi, lastKnownModels);

    // Reload scaffold from local capture if available
    const scaffold = loadScaffoldFromDebugCapture();
    if (scaffold) {
      clineScaffold = scaffold;
    }

    // Run in background to avoid blocking Pi's startup/UI sequence
    (async () => {
      try {
        const models = await fetchModels();
        if (models.length === 0) {
          ctx.ui.notify("Cline: No free models available. Check network or Cline status.", "warning");
          return;
        }

        // Check if models changed by comparing IDs
        const newModelIds = models.map(m => m.id);
        const lastKnownIds = lastKnownModels.map(m => m.id);
        const hasChanged = 
          newModelIds.length !== lastKnownIds.length ||
          !newModelIds.every(id => lastKnownIds.includes(id));

        if (hasChanged) {
          registerClineProvider(pi, models);

          // Save to cache
          try {
            fs.mkdirSync(path.dirname(MODELS_CACHE_FILE), { recursive: true });
            fs.writeFileSync(MODELS_CACHE_FILE, JSON.stringify({ models: models, timestamp: Date.now() }));
          } catch {
            // Ignore cache save errors
          }

          // Determine what changed for better messaging
          const added = newModelIds.filter(id => !lastKnownIds.includes(id));
          const removed = lastKnownIds.filter(id => !newModelIds.includes(id));

          if (lastKnownModels.length === 0) {
            // First time - just mention count
            ctx.ui.notify(`Cline: ${models.length} models available`, "info");
          } else if (added.length > 0 && removed.length > 0) {
            ctx.ui.notify(`Cline: ${added.length} new, ${removed.length} removed (${models.length} total)`, "info");
          } else if (added.length > 0) {
            ctx.ui.notify(`Cline: ${added.length} new models added (${models.length} total)`, "info");
          } else if (removed.length > 0) {
            ctx.ui.notify(`Cline: ${removed.length} models removed (${models.length} total)`, "info");
          }

          lastKnownModels = models;
        }
      } catch (error) {
        console.error("[Cline] Failed to update models:", error);
      }
    })();
  });
}

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (e) {
    return null;
  }
}

async function fetchModels(): Promise<any[]> {
  const models: any[] = [];
  let knownFreeIds: string[] = [];

  // 1. Dynamically fetch the list of "free" models from Cline's GitHub source
  // Source: https://github.com/cline/cline/blob/main/webview-ui/src/components/settings/OpenRouterModelPicker.tsx
  try {
    const freeModelsUrl = "https://raw.githubusercontent.com/cline/cline/main/webview-ui/src/components/settings/OpenRouterModelPicker.tsx";
    const response = await fetchWithTimeout(freeModelsUrl, 5000);
    if (response?.ok) {
      const text = await response.text();
      // Extract the freeModels array - look for "export const freeModels = [" followed by objects
      // Note: The array ends with ] not ]; (no semicolon in the TypeScript source)
      const freeModelsMatch = text.match(/export\s+const\s+freeModels\s*=\s*\[([\s\S]*?)\]\s*\n/);
      if (freeModelsMatch) {
        const freeSection = freeModelsMatch[1];
        // Find all id fields in the free models
        const idMatches = [...freeSection.matchAll(/id:\s*["']([^"']+)["']/g)];
        for (const match of idMatches) {
          knownFreeIds.push(match[1]);
        }
      }
    }
  } catch (e) {
    // Silently fail - we'll use empty models if GitHub is unreachable
  }

  // 2. Fetch OpenRouter metadata (for model details)
  let openRouterModels: any[] = [];
  try {
    const response = await fetchWithTimeout("https://openrouter.ai/api/v1/models", 8000);
    if (response?.ok) {
      const data = await response.json();
      openRouterModels = (data as any).data || [];
    }
  } catch (e) {
    // Silently fail - we'll use defaults for model info
  }

  // 3. Merge and validate - include all knownFreeIds, even if not in OpenRouter
  for (const id of knownFreeIds) {
    const info = openRouterModels.find((m: any) => m.id === id);
    
    // Default values (latest standards)
    let isReasoning = false;
    let contextWindow = 128000;
    let maxTokens = 8192;
    let name = `${extractNameFromId(id)} (Cline)`;
    let input = ["text"];
    let cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    if (info) {
       name = `${info.name} (Cline)`;
       
       // Detect Reasoning
       if (info.supported_parameters?.includes("include_reasoning") || 
           info.supported_parameters?.includes("reasoning") ||
           info.architecture?.instruct_type === "reasoning") {
         isReasoning = true;
       }
       
       // Detect Vision
       if (info.architecture?.modality?.includes("image")) {
         input = ["text", "image"];
       }

       contextWindow = info.context_length || contextWindow;
       maxTokens = info.top_provider?.max_completion_tokens || maxTokens;

       // Parse costs (per million tokens)
       const inputCost = parseFloat(info.pricing?.prompt || "0") * 1000000;
       const outputCost = parseFloat(info.pricing?.completion || "0") * 1000000;
       const cacheReadCost = parseFloat(info.pricing?.input_cache_read || "0") * 1000000;
       const cacheWriteCost = parseFloat(info.pricing?.input_cache_write || "0") * 1000000;

       // All Cline free models have zero cost
       cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    } else {
      // Model not found on OpenRouter - use safe defaults
      // All Cline free models have zero cost
      cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }

    models.push({
      id: id,
      name: name,
      reasoning: isReasoning,
      input: input,
      cost: cost,
      contextWindow: contextWindow,
      maxTokens: maxTokens,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens" as const,
      },
    });
  }

  return models;
}

function extractNameFromId(id: string): string {
  const parts = id.split("/");
  const name = parts[1] || parts[0];
  return name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function registerClineProvider(pi: ExtensionAPI, models: any[]) {
  const headers = buildClineCompletionHeaders();

  // Ensure all models have strictly valid metadata
  const validatedModels = models.map(model => ({
    id: model.id,
    name: model.name || model.id,
    reasoning: !!model.reasoning,
    input: Array.isArray(model.input) ? model.input : ["text"],
    cost: model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow || 128000,
    maxTokens: model.maxTokens || 16384,
    compat: model.compat,
  }));

  pi.registerProvider("cline", {
    baseUrl: CLINE_API_BASE,
    authHeader: true,
    api: "openai-completions",
    headers: headers,
    models: validatedModels,
    oauth: {
      name: "Cline",
      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const serverPort = 31234;
        const callbackUrl = `http://127.0.0.1:${serverPort}/auth`;
        
        // Build the auth URL
        const authUrl = new URL(`${CLINE_API_BASE}/auth/authorize`);
        authUrl.searchParams.set("client_type", "extension");
        authUrl.searchParams.set("callback_url", callbackUrl);
        authUrl.searchParams.set("redirect_uri", callbackUrl);
        
        let finalAuthUrl = authUrl.toString();
        try {
            const response = await fetch(authUrl.toString(), {
                method: "GET",
                redirect: "manual",
                headers: buildClineAuthHeaders()
            });
            if (response.status >= 300 && response.status < 400) {
                const loc = response.headers.get("Location");
                if (loc) finalAuthUrl = loc;
            } else {
                const json = await response.json() as any;
                if (json.redirect_url) finalAuthUrl = json.redirect_url;
            }
        } catch (e) {
            console.error("[Cline] Failed to fetch initial auth redirect", e);
        }

        // Start the local callback server for the browser to call back to
        let server: http.Server | null = null;
        let timeoutId: NodeJS.Timeout | null = null;

        const closeCallbackServer = () => {
          const activeServer = server;
          if (activeServer) {
            activeServer.close();
            server = null;
          }
        };
        
        const codePromise = new Promise<{ code: string; provider: string | null }>((resolve, reject) => {
          server = http.createServer((req, res) => {
            try {
              const reqUrl = new url.URL(req.url || "", `http://127.0.0.1:${serverPort}`);
              if (reqUrl.pathname === "/auth") {
                const code = reqUrl.searchParams.get("code");
                const provider = reqUrl.searchParams.get("provider");
                
                if (code) {
                  // Simple success page - only shown for same-machine auth
                  // For remote auth, browser will fail to connect to localhost anyway
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pi - Cline Auth</title>
  <style>
    body { 
      font-family: system-ui, sans-serif;
      background: #18181e;
      color: #b5bd68;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .message { text-align: center; }
    .message h1 { font-size: 24px; margin-bottom: 8px; }
    .message p { color: #808080; }
  </style>
</head>
<body>
  <div class="message">
    <h1>✓ Authenticated</h1>
    <p>You can close this window</p>
  </div>
</body>
</html>`);
                  resolve({ code, provider });
                } else {
                  res.writeHead(400);
                  res.end("Missing code");
                  reject(new Error("Missing code in callback"));
                }
              } else {
                res.writeHead(404);
                res.end("Not found");
              }
            } catch (e) {
              reject(e);
            } finally {
              closeCallbackServer();
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }
          });
          
          // Handle server errors (e.g., port in use)
          server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              reject(new Error(`Port ${serverPort} is already in use. If another login is in progress, please cancel it first.`));
            } else {
              reject(new Error(`Server error: ${err.message}`));
            }
          });
          
          server.listen(serverPort, "127.0.0.1");
          
          // Set up timeout - 5 minutes
          timeoutId = setTimeout(() => {
            closeCallbackServer();
            reject(new Error("TIMEOUT"));
          }, 5 * 60 * 1000);
          
          // Handle abort signal
          if (callbacks.signal) {
            const abortHandler = () => {
              closeCallbackServer();
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              reject(new Error("Login cancelled"));
            };
            callbacks.signal.addEventListener('abort', abortHandler, { once: true });
          }
        });

        // Show auth URL with instructions for both local and remote flows
        // Use powerline-style muted colors from pi-powerline-footer theme
        const reset = "\x1b[0m";
        const bold = "\x1b[1m";
        const dim = "\x1b[2m";
        
        // Muted powerline colors (RGB)
        const title = "\x1b[38;2;215;135;175m";      // #d787af - pink/mauve
        const label = "\x1b[38;2;0;175;175m";        // #00afaf - teal/cyan
        const accent = "\x1b[38;2;254;188;56m";      // #febc38 - orange
        const highlight = "\x1b[38;2;178;129;214m";  // #b281d6 - purple
        
        callbacks.onAuth({ 
          url: finalAuthUrl,
          instructions: `
  ${title}Cline Authentication${reset}

  ${label}Same machine:${reset}
  Your browser will open. Complete login to auto-complete.

  ${label}Different machine (SSH/remote):${reset}
  1. Open the URL above in a browser you want to
     authenticate with Cline
  2. Complete the login
  3. The browser will fail to connect to localhost
     (only works for same-device auth)
  4. Copy the callback URL from the URL bar:
     ${accent}http://127.0.0.1:31234/auth?code=${highlight}${bold}XXX${reset}${accent}&provider=...${reset}
  5. Paste the full callback URL here (preferred),
     or paste only ${highlight}${bold}XXX${reset}
`
        });
        
        try {
          let code: string;
          let provider: string | null = null;
          
          // Check if we have onManualCodeInput for remote auth support
          if (callbacks.onManualCodeInput) {
            // We have manual code input capability - race between local callback and manual input
            // This allows users to authenticate on a different machine and paste the code here
            const manualCodePromise = callbacks.onManualCodeInput();
            
            // Race between local callback and manual input
            const result = await Promise.race([
              codePromise.then(r => ({ type: "local" as const, ...r })),
              manualCodePromise.then(code => ({ type: "manual" as const, code }))
            ]);
            
            if (result.type === "local") {
              // Local callback won - server is already closed by the handler
              code = result.code;
              provider = result.provider;
            } else {
              // Manual input won - need to close the server
              closeCallbackServer();
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
              
              if (callbacks.signal?.aborted) {
                throw new Error("Login cancelled");
              }
              
              if (!result.code || result.code.trim() === "") {
                throw new Error("No code provided");
              }
              
              const userInput = result.code.trim();
              
              // Extract code from callback URL if user pasted full URL
              if (userInput.startsWith("http://") || userInput.startsWith("https://")) {
                try {
                  const callback = new URL(userInput);
                  const urlCode = callback.searchParams.get("code");
                  const urlProvider = callback.searchParams.get("provider");
                  if (urlCode) {
                    code = urlCode;
                    if (urlProvider) provider = urlProvider;
                  } else {
                    throw new Error("No code found in callback URL");
                  }
                } catch (e) {
                  throw new Error("Invalid callback URL format");
                }
              } else {
                // User pasted just the code
                code = userInput;
              }
            }
          } else {
            // No manual code input available, just wait for local callback
            const result = await codePromise;
            code = result.code;
            provider = result.provider;
          }

          const tokenUrl = `${CLINE_API_BASE}/auth/token`;
          const providerCandidates: Array<string | null> = provider
            ? [provider]
            : [null, "google", "github", "microsoft", "authkit"];

          let tokenData: any = null;
          let lastExchangeError = "";

          for (const providerCandidate of providerCandidates) {
            const payload: Record<string, string> = {
              grant_type: "authorization_code",
              code: code,
              client_type: "extension",
              redirect_uri: callbackUrl,
            };
            if (providerCandidate) {
              payload.provider = providerCandidate;
            }

            const exchangeRes = await fetch(tokenUrl, {
              method: "POST",
              headers: buildClineAuthHeaders(),
              body: JSON.stringify(payload)
            });

            if (!exchangeRes.ok) {
              const errText = await exchangeRes.text().catch(() => "");
              lastExchangeError = `${exchangeRes.status}${errText ? `: ${errText.slice(0, 120)}` : ""}`;
              continue;
            }

            const data = await exchangeRes.json() as any;
            if (data?.success && data?.data?.accessToken) {
              tokenData = data.data;
              provider = providerCandidate || provider;
              break;
            }
            lastExchangeError = "Invalid token response";
          }

          if (!tokenData) {
            throw new Error(`Token exchange failed${lastExchangeError ? ` (${lastExchangeError})` : ""}`);
          }

          return {
            access: `workos:${tokenData.accessToken}`,
            refresh: tokenData.refreshToken,
            expires: new Date(tokenData.expiresAt).getTime()
          };
        } catch (error) {
          // Clean up server on error
          closeCallbackServer();
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          // Handle specific errors
          if (error instanceof Error) {
            if (error.message === "Login cancelled") {
              throw error;
            }
            if (error.message === "TIMEOUT") {
              throw new Error("Authentication timed out. Please try again and complete the login within 5 minutes, or paste the callback URL manually.");
            }
          }
          throw error;
        }
      },

      async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
        const refreshUrl = `${CLINE_API_BASE}/auth/refresh`;
        const response = await fetch(refreshUrl, {
            method: "POST",
            headers: buildClineAuthHeaders(),
            body: JSON.stringify({
                refreshToken: credentials.refresh,
                grantType: "refresh_token"
            })
        });

        if (!response.ok) throw new Error("Failed to refresh token");
        const data = await response.json() as any;
        if (!data.success || !data.data) throw new Error("Invalid refresh response");
        
        return {
            access: `workos:${data.data.accessToken}`,
            refresh: data.data.refreshToken || credentials.refresh,
            expires: new Date(data.data.expiresAt).getTime()
        };
      },

      getApiKey(credentials: OAuthCredentials): string {
        return credentials.access;
      }
    }
  });
}
