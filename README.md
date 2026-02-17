<p align="center">
  <img src="https://raw.githubusercontent.com/ditfetzt/pi-cline-free-models/main/banner.webp" alt="pi-cline-free-models" width="100%">
</p>

<div align="center">

# Pi Cline Free Models

**Unlock the full power of the Cline ecosystem directly inside Pi.**

[![Version](https://img.shields.io/npm/v/pi-cline-free-models?style=flat-square)](https://www.npmjs.com/package/pi-cline-free-models)
[![License](https://img.shields.io/npm/l/pi-cline-free-models?style=flat-square)](LICENSE)
[![Pi Compatible](https://img.shields.io/badge/Pi-Compatible-purple?style=flat-square)](https://github.com/mariozechner/pi-coding-agent)

</div>

## Why?

Cline has usually a bunch of free models available that stay usable for some time. 

**pi-cline-free-models** enables you to make use of those models. It acts as a provider extension for Pi, giving you instant access to models like **Kimi K2.5**, **MiniMax** and others as long as they stay available. The extension automatically fetches the latest model list on startup. Means if models are not supported anymore, you will notice. OAuth handshake with Cline is handled securely and seamlessly via SSO, just use your desired way of logging in with their platform (Google, Github, Microsoft).

## Installation

Install directly via `pi`:

```bash
pi install npm:pi-cline-free-models
```

## Updating

If you already have this extension installed, update and reload Pi:

```bash
pi install npm:pi-cline-free-models
```

Then run `/reload` (or restart Pi).

Most users do **not** need to re-authenticate after updating. If you still get `403 access forbidden`, run `/logout` for Cline and then `/login` again.

## Usage

### 1. Select a Model
Once installed, the models might not right away appear in your Pi model selector under the **Cline** provider.
If so, authenticate first. Every other time the models will be found via `/scoped-models`.

### 2. Authentication

1. Use `/login` and pick "Cline" as provider
2. You will be redirected to the website of Cline
3. Log in with your desired SSO method
4. **Close the tab** after authentication
5. Pi is now authorized to generate text

#### Remote/SSH Authentication

If you're running Pi on a remote server (e.g., VPS via SSH), the local callback won't work automatically. Follow these steps:

1. Copy the auth URL shown in Pi and open it in a browser on your **local machine**
2. Complete the login with your desired SSO method
3. The browser will fail to connect to `localhost` (this is expected - the callback only works on the same machine)
4. Copy the callback URL from the URL bar:
   ```
   http://127.0.0.1:31234/auth?code=XXX&provider=...
   ```
5. Paste the **full callback URL** into Pi when prompted (preferred).
   - Pasting only `XXX` still works in most cases.
6. Pi is now authorized to generate text

### 3. Update Models
The extension checks for new models every time Pi starts a new session. If Cline adds a new free model to their list, it will automatically appear in your selector the next time you start Pi or use `/reload`.

## Troubleshooting

### `403 access forbidden`

1. Update extension and run `/reload`
2. Ensure a Cline model is selected
3. If it still fails, run `/logout` (Cline) and `/login` again
4. For remote/SSH auth, paste the full callback URL (including `provider=...`) when prompted

No VS Code extension run is required for normal usage.

## Development

1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Install locally for development:
   ```bash
   pi install .
   ```

## License

MIT
