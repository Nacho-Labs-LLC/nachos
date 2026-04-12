---
name: gog
description:
  Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
homepage: https://gogcli.sh
metadata: { 'nachos': { 'requires': { 'bins': ['gog'] } } }
---

# gog

Use `gog` for Gmail/Calendar/Drive/Contacts/Sheets/Docs. Requires OAuth setup.

## Setup (once)

```bash
gog auth credentials /path/to/client_secret.json
gog auth add you@gmail.com --services gmail,calendar,drive,contacts,docs,sheets
gog auth list
```

## Common commands

```bash
gog gmail search 'newer_than:7d' --max 10
gog gmail send --to a@b.com --subject "Hi" --body "Hello"
gog calendar events <calendarId> --from <iso> --to <iso>
gog drive search "invoice" --max 10 --json
gog sheets get <sheetId> "Tab!A1:D10" --json
gog docs export <docId> --format txt --out /tmp/doc.txt
```

## Notes

- Prefer `--json` for scripting.
- Avoid write operations unless explicitly requested by the user.
