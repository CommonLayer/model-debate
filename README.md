# Model Debate

Model Debate is a public Next.js application for structured model-vs-model debates.

Version 1 is intentionally narrow: exactly two participants, a full alternating transcript, a final synthesis pass, and clean client-side export to Markdown or JSON.

## Overview

- Exactly 2 participants: `A` and `B`
- Strict alternating turns for each round
- Final synthesis generated after the transcript completes
- OpenRouter-first routing with a provider adapter abstraction
- Direct OpenAI and Anthropic fallback from environment keys when OpenRouter is not configured
- API key can come from the UI or the environment
- UI key overrides the environment key for the current browser session only
- Exports never include API keys

## Product Scope

This repository is intentionally focused.

- One mode only: 2-model debate
- No personas, presets, snapshots, or alternate run modes
- No persistence layer
- No local storage for secrets
- No repository-specific context loaders

## Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS

## Architecture

```text
app/
  api/debate/route.ts        # local API entrypoint
  api/models/route.ts        # provider-backed model discovery
  page.tsx                   # server entrypoint
components/
  debate-workbench.tsx       # main workbench UI
lib/
  providers/                 # provider adapters
  server/debate-runner.ts    # transcript orchestration + synthesis
  server/provider-resolution.ts
  exports.ts                 # Markdown / JSON export helpers
  types.ts                   # shared product types
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your local environment file

```bash
cp .env.example .env.local
```

### 3. Configure one of the supported auth paths

Option A: OpenRouter

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEFAULT_PARTICIPANT_A_MODEL=openai/gpt-5.2
DEFAULT_PARTICIPANT_B_MODEL=anthropic/claude-sonnet-4-6
DEFAULT_SYNTHESIS_MODEL=openai/gpt-5.2
```

Option B: Direct provider keys

```dotenv
OPENROUTER_API_KEY=
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
DEFAULT_PARTICIPANT_A_MODEL=openai/gpt-5.2
DEFAULT_PARTICIPANT_B_MODEL=anthropic/claude-sonnet-4-6
DEFAULT_SYNTHESIS_MODEL=openai/gpt-5.2
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | No | Preferred single-key path for mixed-provider debates |
| `OPENAI_API_KEY` | No | Used in direct mode for OpenAI models |
| `ANTHROPIC_API_KEY` | No | Used in direct mode for Anthropic models |
| `DEFAULT_PARTICIPANT_A_MODEL` | No | Default model shown for participant `A` |
| `DEFAULT_PARTICIPANT_B_MODEL` | No | Default model shown for participant `B` |
| `DEFAULT_SYNTHESIS_MODEL` | No | Default model used for the final synthesis |

Default fallbacks in code:

- `participant A`: `openai/gpt-5.2`
- `participant B`: `anthropic/claude-sonnet-4-6`
- `synthesis`: `openai/gpt-5.2`
- `rounds`: `2`

## Provider Resolution

The app resolves credentials in this order:

1. OpenRouter API key entered in the UI for the current session
2. `OPENROUTER_API_KEY` from the environment
3. Direct provider routing with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`

Direct routing is model-driven:

- `openai/...` routes to OpenAI
- `anthropic/...` routes to Anthropic

This keeps OpenRouter as the default integration while still allowing teams to test with provider keys stored only in `.env.local`.

## Model Selection

The model fields support both manual entry and a provider-backed dropdown.

- The UI loads a model catalog from the keys currently available to the server
- If you paste an OpenRouter key in the UI, click `Refresh models` to reload the catalog for that session key
- You can still enter a custom model ID even if it does not appear in the dropdown
- The dropdown reflects what your current OpenRouter, OpenAI, and Anthropic credentials can list, not a hardcoded static menu

## Security Model

- The UI API key is stored in React state only
- The UI API key is never written to `localStorage`
- Exported Markdown and JSON never include secrets
- Server responses never echo API keys
- The app is designed to avoid logging secrets

## Run Flow

1. Configure the debate topic, objective, round count, and models
2. Start the run from the local workbench
3. The server orchestrates alternating turns between `A` and `B`
4. The synthesis model generates a final working document from the transcript
5. Export the result as Markdown or JSON

## API

### `POST /api/debate`

Request body:

```json
{
  "topic": "Should early-stage teams prefer monoliths over microservices?",
  "objective": "Produce a concrete recommendation for an early-stage engineering team.",
  "rounds": 2,
  "participantA": { "model": "openai/gpt-5.2" },
  "participantB": { "model": "anthropic/claude-sonnet-4-6" },
  "synthesisModel": "openai/gpt-5.2",
  "apiKey": "optional_openrouter_key"
}
```

Response shape:

```json
{
  "transcript": [
    {
      "id": "round-1-A",
      "round": 1,
      "participant": "A",
      "model": "openai/gpt-5.2",
      "text": "..."
    }
  ],
  "synthesis": {
    "model": "openai/gpt-5.2",
    "markdown": "..."
  },
  "meta": {
    "provider": "openrouter",
    "providersUsed": ["openrouter"],
    "generatedAt": "2026-03-11T10:00:00.000Z",
    "rounds": 2,
    "effectiveModels": {
      "participantA": "openai/gpt-5.2",
      "participantB": "anthropic/claude-sonnet-4-6",
      "synthesis": "openai/gpt-5.2"
    }
  }
}
```

Error classes:

- `400` for invalid payloads or missing credentials
- `502` for upstream provider failures

### `POST /api/models`

Loads the model catalog for the current credential context.

Request body:

```json
{
  "apiKey": "optional_openrouter_key_from_ui"
}
```

Response shape:

```json
{
  "mode": "direct",
  "credentialSource": "direct",
  "loadedFrom": ["openai", "anthropic"],
  "models": [
    {
      "id": "openai/gpt-5.2",
      "label": "openai/gpt-5.2",
      "source": "recommended"
    },
    {
      "id": "anthropic/claude-sonnet-4-6",
      "label": "Claude Sonnet 4.6",
      "source": "anthropic"
    }
  ],
  "warnings": [],
  "fetchedAt": "2026-03-11T10:00:00.000Z"
}
```

## Exports

Markdown export includes:

- topic
- objective
- effective models
- synthesis
- full transcript

JSON export includes:

- versioned export payload
- settings used for the run
- debate result metadata
- transcript and synthesis

Neither export format includes API keys.

## Development Commands

```bash
npm run dev
npm run lint
npm run build
npm run test:models
```

`npm run test:models` checks the current keys in `.env.local` and prints the provider catalogs it can actually load.

## Contributing

Contributions should preserve the current product boundary.

- Keep v1 scoped to exactly 2 participants
- Do not introduce stored secrets, local storage key persistence, or secret-bearing exports
- Prefer provider changes through the adapter layer instead of route-specific branching
- Run `npm run lint` and `npm run build` before opening a pull request

## Security

- Never commit `.env.local`
- Never place live credentials in `.env.example`
- If a secret is ever committed, revoke it immediately and rotate it before any publication step

## License

MIT. See [LICENSE](LICENSE).

## Current Limits

- Exactly 2 participants
- Round count constrained to `1` through `5`
- No multi-session persistence
- No collaborative editing
- No provider-specific advanced tuning UI
