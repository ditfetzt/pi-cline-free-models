import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import * as http from "node:http";
import * as url from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Cache file path for model state persistence
const MODELS_CACHE_FILE = path.join(os.homedir(), ".pi", "agent", ".cline-models-cache.json");

// Last known models (for comparison)
let lastKnownModels: any[] = [];

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
  // 1. Register provider immediately with cached models if available
  // This ensures models are available for /model and /scoped-models right away
  registerClineProvider(pi, lastKnownModels);

  // 2. Schedule non-blocking update on session start
  pi.on("session_start", async (_event, ctx) => {
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
  const headers = {
    "HTTP-Referer": "https://cline.bot",
    "X-Title": "Cline",
    "X-Client-Type": "extension",
    "X-Client-Version": "3.57.1",
    "X-Core-Version": "3.57.1",
    "User-Agent": "Cline/3.57.1",
  };

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
    baseUrl: "https://api.cline.bot/api/v1",
    authHeader: true,
    api: "openai-completions",
    headers: headers,
    models: validatedModels,
    oauth: {
      name: "Cline",
      usesCallbackServer: true,
      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const serverPort = 31234;
        const callbackUrl = `http://127.0.0.1:${serverPort}/auth`;
        
        // Build the auth URL
        const authUrl = new URL("https://api.cline.bot/api/v1/auth/authorize");
        authUrl.searchParams.set("client_type", "extension");
        authUrl.searchParams.set("callback_url", callbackUrl);
        authUrl.searchParams.set("redirect_uri", callbackUrl);
        
        let finalAuthUrl = authUrl.toString();
        try {
            const response = await fetch(authUrl.toString(), {
                method: "GET",
                redirect: "manual",
                headers: { "Content-Type": "application/json" }
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
              if (server) {
                server.close();
                server = null;
              }
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
            if (server) {
              server.close();
              server = null;
            }
            reject(new Error("TIMEOUT"));
          }, 5 * 60 * 1000);
          
          // Handle abort signal
          if (callbacks.signal) {
            const abortHandler = () => {
              if (server) {
                server.close();
                server = null;
              }
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
  4. Copy the code from the URL bar:
     ${accent}http://127.0.0.1:31234/auth?code=${highlight}${bold}XXX${reset}${accent}${reset}
  5. Paste the ${highlight}${bold}XXX${reset} code here
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
              if (server) {
                server.close();
                server = null;
              }
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
                  const url = new URL(userInput);
                  const urlCode = url.searchParams.get("code");
                  if (urlCode) {
                    code = urlCode;
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

          // Try to decode the code directly (Cline uses base64-encoded tokens)
          try {
            const decoded = JSON.parse(Buffer.from(code, "base64").toString("utf-8"));
            if (decoded.accessToken && decoded.expiresAt) {
              return {
                access: `workos:${decoded.accessToken}`,
                refresh: decoded.refreshToken || "",
                expires: new Date(decoded.expiresAt).getTime()
              };
            }
          } catch (e) {
            // Not valid base64 JSON, fall through to token exchange
          }

          const tokenUrl = "https://api.cline.bot/api/v1/auth/token";
          const exchangeRes = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grant_type: "authorization_code",
              code: code,
              client_type: "extension",
              redirect_uri: callbackUrl,
              provider: provider || "github" 
            })
          });

          if (!exchangeRes.ok) throw new Error(`Token exchange failed: ${exchangeRes.status}`);

          const data = await exchangeRes.json() as any;
          if (!data.success || !data.data) throw new Error("Invalid token response");

          return {
            access: `workos:${data.data.accessToken}`,
            refresh: data.data.refreshToken,
            expires: new Date(data.data.expiresAt).getTime()
          };
        } catch (error) {
          // Clean up server on error
          if (server) {
            server.close();
          }
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
        const refreshUrl = "https://api.cline.bot/api/v1/auth/refresh";
        const response = await fetch(refreshUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
