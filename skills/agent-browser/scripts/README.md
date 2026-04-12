# Agent Browser Scripts

Production-ready utilities for browser automation. Each script is self-contained
and can be used independently.

## Quick Reference

| Script               | Purpose                               | Usage                              |
| -------------------- | ------------------------------------- | ---------------------------------- |
| `browser_secure.py`  | Secure browsing with domain allowlist | `python browser_secure.py --help`  |
| `form_automation.py` | Complex form handling                 | `python form_automation.py --help` |
| `session_manager.py` | Cookie/storage management             | `python session_manager.py --help` |
| `scraper_utils.py`   | Data extraction utilities             | `python scraper_utils.py --help`   |
| `visual_testing.py`  | Screenshot and visual testing         | `python visual_testing.py --help`  |

## Installation

```bash
pip install playwright
playwright install chromium
```

## Examples

### Secure Browser

```bash
# Navigate with domain validation
python browser_secure.py \
  --url https://example.com \
  --allowed-domains example.com,api.example.com \
  --screenshot page.png
```

### Form Automation

```bash
# Fill and submit form
python form_automation.py \
  --url https://example.com/contact \
  --config form_data.json
```

Example `form_data.json`:

```json
{
  "name": {
    "type": "text",
    "value": "John Doe"
  },
  "email": {
    "type": "email",
    "value": "john@example.com"
  },
  "country": {
    "type": "select",
    "value": "US"
  },
  "terms": {
    "type": "checkbox",
    "value": true
  }
}
```

### Session Manager

```bash
# Save session after login
python session_manager.py save \
  --url https://example.com/dashboard \
  --output session.json

# Restore session later
python session_manager.py restore \
  --input session.json \
  --verify-selector ".user-profile"
```

### Data Scraping

```bash
# Extract table data
python scraper_utils.py table \
  --url https://example.com/data \
  --selector "table.results" \
  --output data.json

# Extract all links
python scraper_utils.py links \
  --url https://example.com \
  --output links.json

# Custom extraction with config
python scraper_utils.py structured \
  --url https://example.com \
  --config extract_config.json
```

Example `extract_config.json`:

```json
{
  "title": {
    "selector": "h1",
    "type": "text"
  },
  "price": {
    "selector": ".price",
    "type": "text"
  },
  "images": {
    "selector": ".gallery img",
    "type": "src",
    "multiple": true
  }
}
```

### Visual Testing

```bash
# Capture full page
python visual_testing.py capture \
  --url https://example.com \
  --output page.png \
  --full-page

# Capture specific element
python visual_testing.py element \
  --url https://example.com \
  --selector ".header" \
  --output header.png

# Compare screenshots
python visual_testing.py compare \
  --baseline baseline.png \
  --current current.png \
  --diff differences.png
```

## Best Practices

1. **Always use --help first** - See all options before using a script
2. **Headless by default** - All scripts run in headless mode
3. **Security first** - Use domain allowlists and credential protection
4. **Error handling** - Scripts exit with non-zero codes on failure
5. **JSON output** - Most scripts output JSON for easy parsing

## Integration

These scripts are designed to be called as black-box utilities without reading
source code into context. They handle complex workflows reliably while keeping
token usage minimal.

When building AI agent workflows:

1. Use `--help` to understand the script
2. Call the script directly with appropriate arguments
3. Parse JSON output for structured data
4. Handle exit codes for error detection
