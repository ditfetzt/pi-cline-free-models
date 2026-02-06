<p align="center">
  <img src="banner.webp" alt="pi-cline-free-models" width="100%">
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

## Usage

### 1. Select a Model
Once installed, the models might not right away appear in your Pi model selector under the **Cline** provider.
If so, authenticate first. Every other time the models will be found via `/scoped-models`.

### 2. Authentication

1. Use `/login` and pick "Cline" as provider
2. You will be redirected to the website of Cline
3. Log in with your desired SSO method and get a notification about success
4. **Close the tab** after authentication
5. Pi is now authorized to generate text

### 3. Update Models
The extension checks for new models every time Pi starts a new session. If Cline adds a new free model to their list, it will automatically appear in your selector the next time you start Pi or use `/reload`.

## Development

1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link for local testing:
   ```bash
   pi install .
   ```

## License

MIT
