---
name: gifgrep
description:
  Search GIF providers with CLI/TUI, download results, and extract
  stills/sheets.
homepage: https://gifgrep.com
metadata: { 'nachos': { 'requires': { 'bins': ['gifgrep'] } } }
---

# gifgrep

Search GIF providers (Tenor/Giphy), browse in a TUI, download results, and
extract stills/sheets.

## Quick start

```bash
gifgrep cats --max 5
gifgrep cats --format url | head -n 5
gifgrep search --json cats
gifgrep tui "office handshake"
gifgrep cats --download --max 1 --format url
```

## Stills and sheets

```bash
gifgrep still ./clip.gif --at 1.5s -o still.png
gifgrep sheet ./clip.gif --frames 9 --cols 3 -o sheet.png
```

## Notes

- `GIPHY_API_KEY` required for Giphy. `TENOR_API_KEY` optional (Tenor demo key
  used if unset).
- Use `--json` or `--format` for scriptable output.
