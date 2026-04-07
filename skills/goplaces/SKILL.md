---
name: goplaces
description:
  Query Google Places API (New) via the goplaces CLI for text search, place
  details, resolve, and reviews.
homepage: https://github.com/steipete/goplaces
metadata:
  {
    'nachos':
      {
        'requires': { 'bins': ['goplaces'], 'env': ['GOOGLE_PLACES_API_KEY'] },
        'primaryEnv': 'GOOGLE_PLACES_API_KEY',
      },
  }
---

# goplaces

Modern Google Places API (New) CLI. Human output by default, `--json` for
scripts.

## Setup

- Export `GOOGLE_PLACES_API_KEY` in the container environment.

## Common commands

```bash
goplaces search "coffee" --open-now --min-rating 4 --limit 5
goplaces search "pizza" --lat 40.8 --lng -73.9 --radius-m 3000
goplaces resolve "Soho, London" --limit 5
goplaces details <place_id> --reviews
goplaces search "sushi" --json
```

## Notes

- Places API usage is billed; set quotas and alerts in Google Cloud.
- Use `--json` for stable, machine-readable output.
