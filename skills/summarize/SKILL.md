---
name: summarize
description:
  Summarize or extract text/transcripts from URLs, podcasts, and local files.
homepage: https://summarize.sh
metadata: { 'nachos': { 'requires': { 'bins': ['summarize'] } } }
---

# Summarize

Fast CLI to summarize URLs, local files, and YouTube links.

## When to use

- "summarize this URL/article"
- "what's this link about?"
- "transcribe this YouTube/video" (best-effort)

## Quick start

```bash
summarize "https://example.com" --model google/gemini-3-flash-preview
summarize "/path/to/file.pdf" --model google/gemini-3-flash-preview
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto
```

## Notes

- Use `--json` for machine-readable output.
- Use `--extract-only` for transcripts (URLs only).
- Configure provider keys via env (OPENAI_API_KEY, ANTHROPIC_API_KEY,
  GEMINI_API_KEY, XAI_API_KEY).
