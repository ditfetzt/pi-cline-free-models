# pi-cline-free-models

![Banner](banner.webp)

**pi-cline-free-models** is a [Pi](https://github.com/mariozechner/pi-coding-agent) extension that integrates the **Cline** model ecosystem. It provides access to Cline's curated list of free and paid models (via OpenRouter) directly within your Pi agent.

## Features

- 🔓 **Access Free Models**: Instantly use models like **Kimi K2.5**, **MiniMax M2.1**, and **Giga Potato** without an API key.
- 🔄 **Dynamic Updates**: Automatically fetches the latest model list from Cline's repository on startup.
- 🧠 **Reasoning Support**: Full support for Chain-of-Thought (CoT) models.
- 👁️ **Vision Capable**: Image support for multimodal models.
- 🔐 **Seamless OAuth**: Authenticates securely via Cline's official login flow.

## Installation

Install directly from GitHub:

```bash
pi install github:ditfetzt/pi-cline-free-models
```

## Usage

### 1. Select a Model
Once installed, the models will appear in your Pi model selector under the **Cline** provider.

Common models include:
- `cline/moonshotai/kimi-k2.5` (Reasoning + Vision)
- `cline/minimax/minimax-m2.1` (Reasoning)
- `cline/stealth/giga-potato` (Fast/Free)

### 2. Authentication
The first time you try to use a model, the extension will initiate an OAuth flow:

1. A browser window will open pointing to `cline.bot`.
2. Log in with your GitHub account.
3. You will be redirected to a local server (`http://127.0.0.1:31234`).
4. **Close the tab** when you see "Authenticated!".
5. Pi is now authorized to generate text.

### 3. Update Models
The extension checks for new models every time Pi starts a new session. If Cline adds a new free model to their list, it will automatically appear in your selector.

## Troubleshooting

**Authentication fails / Callback URL error**
Ensure that port `31234` is not blocked on your machine. The extension spins up a temporary local server on this port to capture the authentication token.

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
