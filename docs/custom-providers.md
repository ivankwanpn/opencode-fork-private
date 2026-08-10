# Custom providers

Configure a custom provider when your API is not already available through the built-in provider list. Configuration is saved to OpenCode's global configuration destination, so it is available to your OpenCode clients; it is not written into the current project.

You need a provider ID (lowercase letters, numbers, `-`, and `_`), a display name, an API base URL, and at least one model. Optional custom headers are sent with discovery and model requests.

## Choose the protocol

Choose the protocol that matches the API transport exposed by the provider:

| Protocol | Transport |
| --- | --- |
| **OpenAI Responses** (`openai-responses`) | OpenAI **Responses API** transport |
| **OpenAI Chat Completions** (`openai-compatible`) | OpenAI-compatible **Chat Completions API** transport |
| **Anthropic Messages** (`anthropic-messages`) | Anthropic **Messages API** transport |

These are distinct transports. Select the one documented by the endpoint you are configuring, rather than choosing based on a model name alone.

## Desktop and TUI

In Desktop, select **Other** in the provider picker to open the custom-provider wizard. Enter the provider ID, display name, protocol, base URL, optional API key, and optional headers. Then choose **Discover models** or **Manual entry**.

In Desktop, discovery presents the returned models for multi-selection. You can add more than one model, review or edit each selection, and use manual entry at any time when the desired model is absent. In the TUI, select a discovered model and use **Add another** to configure more models. If discovery fails, choose **Retry discovery** or **Manual entry**.

For every selected or manually entered model, Desktop and the TUI ask for:

- A display name.
- Whether the model supports reasoning.
- An optional context limit and optional output limit, both in tokens.

Leave both limits blank if they are unknown. When one limit is supplied, supply the other too; both must be positive integers and the output limit cannot exceed the context limit. Anthropic reasoning models with an output limit require at least 4 output tokens.

Reasoning is a model capability, not a saved effort setting. When reasoning is enabled, OpenCode chooses the available reasoning-effort options at model runtime. The available efforts can differ between OpenAI and Anthropic models because their protocols and individual models expose different supported effort lists. Do not expect configuration to save one fixed reasoning effort for all future runs.

### TUI flow

Open `/connect`, choose **Other**, and complete the wizard in this order:

1. Provider ID and display name.
2. Protocol and base URL.
3. Optional API key and custom headers.
4. Discover models or enter a model manually.
5. For each model: model ID (manual only), display name, reasoning capability, context limit, and output limit.
6. Add another model or finish, then review and save.

After the first screen, press `Esc` to go **Back** and `Ctrl+C` to **Cancel**. The final review also provides a Cancel choice.

## CLI

Run the same interactive configuration flow from the command line:

```sh
opencode providers configure [id]
```

The optional `id` skips the provider-ID prompt. In text and password prompts, type `:back` to return to the preceding step or `:cancel` to abandon configuration. Selection prompts include **Back** and **Cancel** choices.

## Credentials

The API-key field supports either a literal key or an environment reference:

- A literal value is stored through OpenCode's credential storage and used for the provider.
- `{env:NAME}` stores the environment-variable reference in the provider configuration. OpenCode resolves `NAME` when it needs the credential; discovery reports an environment error if that variable is unavailable.

For example, use `{env:ACME_API_KEY}`, not a shell expression or an expanded secret. Leave the field blank only when the endpoint does not require a key.

## Model discovery

Discovery is server-side, avoiding browser CORS requirements. It accepts common catalog response shapes (`data`, `models`, `items`, arrays, and keyed objects) and normalizes the resulting model IDs and available metadata.

OpenCode tries compatible catalog candidates from the base URL. A URL ending in `/vN` tries `/models` (and, except for `/v1`, also `/v1/models`); other base URLs try `/v1/models`. For known compatibility suffixes such as `/api/anthropic` or `/claudecode`, it also tries the root `/v1/models` and `/models` candidates. A `404` or `405` moves on to the next candidate.

The whole discovery operation has a **15-second total timeout**, shared by all candidates and response parsing. Redirects are followed only within the same origin and for at most three hops. Redirects to another origin, malformed redirect targets, invalid catalog responses, and other unsuccessful responses are rejected. Use manual model entry if the provider does not expose a compatible catalog endpoint.

## Equivalent configuration

The wizard writes the same official-compatible `provider` configuration shape used by OpenCode. This example uses an environment reference and placeholder header value; it contains no real credential:

```jsonc
{
  "provider": {
    "acme-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Acme AI",
      "env": ["ACME_API_KEY"],
      "options": {
        "baseURL": "https://api.example.invalid/v1",
        "headers": {
          "X-Workspace": "example-workspace"
        }
      },
      "models": {
        "acme-code-1": {
          "name": "Acme Code 1",
          "reasoning": true,
          "limit": {
            "context": 200000,
            "output": 16000
          }
        }
      }
    }
  }
}
```

The `npm` value follows the chosen protocol: `@ai-sdk/openai` for OpenAI Responses, `@ai-sdk/openai-compatible` for OpenAI Chat Completions, and `@ai-sdk/anthropic` for Anthropic Messages. Omit `env` when using a literal key through the wizard; the key itself does not belong in this JSON example.
