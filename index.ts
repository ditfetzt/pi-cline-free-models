import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import * as http from "node:http";
import * as url from "node:url";

export default function (pi: ExtensionAPI) {
  // 1. Register immediately with fallback models so /login and /model work instantly
  const fallbackModels = getFallbackModels();
  registerClineProvider(pi, fallbackModels);

  // 2. Schedule non-blocking update on session start
  pi.on("session_start", async (_event, ctx) => {
    // Run in background to avoid blocking Pi's startup/UI sequence
    (async () => {
      try {
        const models = await fetchModels();
        if (models.length > 0) {
          registerClineProvider(pi, models);
          ctx.ui.notify(`Cline extension updated with ${models.length} models.`, "info");
        }
      } catch (error) {
        console.error("[Cline] Failed to update models:", error);
        // We already have fallback models registered, so no need to notify of failure
        // unless it's a critical error.
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
  const knownFreeIds: string[] = [];

  // 1. Dynamically fetch the list of "free" models from Cline's GitHub source
  try {
    const featuredModelsUrl = "https://raw.githubusercontent.com/cline/cline/main/cli/src/constants/featured-models.ts";
    const response = await fetchWithTimeout(featuredModelsUrl, 5000);
    if (response?.ok) {
      const text = await response.text();
      const freeBlockMatch = text.match(/free:\s*\[([\s\S]*?)\]/);
      if (freeBlockMatch) {
        const freeBlock = freeBlockMatch[1];
        const idMatches = freeBlock.matchAll(/id:\s*"([^"]+)"/g);
        for (const match of idMatches) {
          knownFreeIds.push(match[1]);
        }
      }
    }
  } catch (e) {
    console.warn("[Cline] Error fetching featured models:", e);
  }

  // Fallback to minimal set if fetch failed
  if (knownFreeIds.length === 0) {
    knownFreeIds.push(...getFallbackIds());
  }

  // 2. Fetch OpenRouter metadata
  let openRouterModels: any[] = [];
  try {
    const response = await fetchWithTimeout("https://openrouter.ai/api/v1/models", 8000);
    if (response?.ok) {
      const data = await response.json();
      openRouterModels = (data as any).data || [];
    }
  } catch (e) {
    console.warn("[Cline] Error fetching OpenRouter models:", e);
  }

  // 3. Merge and validate
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

       // Cline featured free models logic
       if (knownFreeIds.includes(id) || id === "stealth/giga-potato") {
         cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
       } else {
         cost = { input: inputCost, output: outputCost, cacheRead: cacheReadCost, cacheWrite: cacheWriteCost };
       }
    } else {
      // Manual overrides for known IDs if not on OpenRouter
      if (id === "moonshotai/kimi-k2.5") {
         input = ["text", "image"];
         contextWindow = 262144;
         isReasoning = true;
      } else if (id === "minimax/minimax-m2.1") {
         isReasoning = true;
      }
      cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }

    // Force reasoning for known capable models
    if (id === "moonshotai/kimi-k2.5" || id === "minimax/minimax-m2.1") {
        isReasoning = true;
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

  // 4. Ensure Stealth Model is included
  if (!models.find(m => m.id === "stealth/giga-potato")) {
     models.push({
        id: "stealth/giga-potato",
        name: "Giga Potato (Cline)",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 224000,
        maxTokens: 8192,
      });
  }

  return models;
}

function extractNameFromId(id: string): string {
  const parts = id.split("/");
  const name = parts[1] || parts[0];
  return name.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function getFallbackIds() {
  return [
    "moonshotai/kimi-k2.5",
    "minimax/minimax-m2.1",
    "kwaipilot/kat-coder-pro",
    "arcee-ai/trinity-large-preview:free"
  ];
}

function getFallbackModels() {
   return [
      {
        id: "moonshotai/kimi-k2.5",
        name: "Kimi K2.5 (Cline)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 8192,
      },
      {
        id: "minimax/minimax-m2.1",
        name: "MiniMax M2.1 (Cline)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "kwaipilot/kat-coder-pro",
        name: "KAT Coder Pro (Cline)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "arcee-ai/trinity-large-preview:free",
        name: "Trinity Large Preview (Cline)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "stealth/giga-potato",
        name: "Giga Potato (Cline)",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 224000,
        maxTokens: 8192,
      }
    ];
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
      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const serverPort = 31234; 
        const callbackUrl = `http://127.0.0.1:${serverPort}/auth`;
        
        const codePromise = new Promise<{ code: string; provider: string | null }>((resolve, reject) => {
          const server = http.createServer((req, res) => {
            try {
              const reqUrl = new url.URL(req.url || "", `http://127.0.0.1:${serverPort}`);
              if (reqUrl.pathname === "/auth") {
                const code = reqUrl.searchParams.get("code");
                const provider = reqUrl.searchParams.get("provider");
                
                if (code) {
                  res.writeHead(200, { "Content-Type": "text/html" });
                  res.end("<h1>Authenticated!</h1><p>You can close this window and return to Pi.</p><script>window.close()</script>");
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
              server.close();
            }
          });
          server.listen(serverPort, "127.0.0.1");
          setTimeout(() => {
            server.close();
            reject(new Error("Timeout waiting for authentication"));
          }, 5 * 60 * 1000);
        });

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

        callbacks.onAuth({ url: finalAuthUrl });
        const { code, provider } = await codePromise;

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
