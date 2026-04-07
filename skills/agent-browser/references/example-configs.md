# Example Configurations

Common configuration patterns for agent-browser automation.

## Form Data Configurations

### Contact Form

```json
{
  "name": {
    "type": "text",
    "value": "John Doe"
  },
  "email": {
    "type": "email",
    "value": "john@example.com",
    "sensitive": false
  },
  "subject": {
    "type": "text",
    "value": "Inquiry"
  },
  "message": {
    "type": "text",
    "value": "I have a question about your services."
  },
  "contact_method": {
    "type": "radio",
    "value": "email"
  },
  "subscribe": {
    "type": "checkbox",
    "value": true
  }
}
```

### Login Form

```json
{
  "username": {
    "type": "text",
    "value": "user@example.com"
  },
  "password": {
    "type": "password",
    "value": "secure_password_here",
    "sensitive": true
  },
  "remember_me": {
    "type": "checkbox",
    "value": true
  }
}
```

### Registration Form

```json
{
  "first_name": {
    "type": "text",
    "value": "John"
  },
  "last_name": {
    "type": "text",
    "value": "Doe"
  },
  "email": {
    "type": "email",
    "value": "john.doe@example.com"
  },
  "password": {
    "type": "password",
    "value": "SecureP@ssw0rd!",
    "sensitive": true
  },
  "confirm_password": {
    "type": "password",
    "value": "SecureP@ssw0rd!",
    "sensitive": true
  },
  "country": {
    "type": "select",
    "value": "US"
  },
  "terms": {
    "type": "checkbox",
    "value": true
  },
  "newsletter": {
    "type": "checkbox",
    "value": false
  }
}
```

### File Upload Form

```json
{
  "title": {
    "type": "text",
    "value": "Document Title"
  },
  "description": {
    "type": "text",
    "value": "Description of the document"
  },
  "category": {
    "type": "select",
    "value": "reports"
  },
  "file": {
    "type": "file",
    "value": "/path/to/document.pdf"
  },
  "visibility": {
    "type": "radio",
    "value": "public"
  }
}
```

## Data Extraction Configurations

### Product Page Extraction

```json
{
  "title": {
    "selector": "h1.product-title",
    "type": "text"
  },
  "price": {
    "selector": ".price",
    "type": "text"
  },
  "description": {
    "selector": ".product-description",
    "type": "text"
  },
  "images": {
    "selector": ".product-gallery img",
    "type": "src",
    "multiple": true
  },
  "availability": {
    "selector": ".stock-status",
    "type": "text"
  },
  "rating": {
    "selector": ".rating",
    "type": "attribute",
    "attribute": "data-rating"
  },
  "reviews_count": {
    "selector": ".reviews-count",
    "type": "text"
  }
}
```

### Article Extraction

```json
{
  "headline": {
    "selector": "h1",
    "type": "text"
  },
  "author": {
    "selector": ".author-name",
    "type": "text"
  },
  "publish_date": {
    "selector": "time",
    "type": "attribute",
    "attribute": "datetime"
  },
  "content": {
    "selector": "article .content",
    "type": "text"
  },
  "tags": {
    "selector": ".tag",
    "type": "text",
    "multiple": true
  },
  "featured_image": {
    "selector": ".featured-image img",
    "type": "src"
  }
}
```

### Search Results Extraction

```json
{
  "results": {
    "selector": ".search-result",
    "type": "text",
    "multiple": true
  },
  "titles": {
    "selector": ".result-title",
    "type": "text",
    "multiple": true
  },
  "links": {
    "selector": ".result-link",
    "type": "href",
    "multiple": true
  },
  "snippets": {
    "selector": ".result-snippet",
    "type": "text",
    "multiple": true
  },
  "total_results": {
    "selector": ".results-count",
    "type": "text"
  }
}
```

### Social Media Profile

```json
{
  "username": {
    "selector": ".profile-username",
    "type": "text"
  },
  "display_name": {
    "selector": ".profile-name",
    "type": "text"
  },
  "bio": {
    "selector": ".profile-bio",
    "type": "text"
  },
  "avatar": {
    "selector": ".profile-avatar",
    "type": "src"
  },
  "follower_count": {
    "selector": ".followers-count",
    "type": "text"
  },
  "following_count": {
    "selector": ".following-count",
    "type": "text"
  },
  "verified": {
    "selector": ".verified-badge",
    "type": "attribute",
    "attribute": "data-verified"
  }
}
```

## Security Configurations

### Domain Allowlist Examples

**E-commerce Site**

```python
ALLOWED_DOMAINS = [
    'shop.example.com',
    'api.example.com',
    'cdn.example.com',
    'checkout.example.com',
    'payment-gateway.trusted.com'
]
```

**Corporate Intranet**

```python
ALLOWED_DOMAINS = [
    'intranet.company.com',
    'wiki.company.com',
    'jira.company.com',
    'confluence.company.com'
]
```

**Research/Data Collection**

```python
ALLOWED_DOMAINS = [
    'example.com',
    'api.example.com',
    'data.provider.com'
]
```

### Browser Context Security

```python
context_options = {
    'viewport': {'width': 1280, 'height': 720},
    'user_agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...',
    'ignore_https_errors': False,  # Enforce HTTPS validation
    'java_script_enabled': True,
    'accept_downloads': False,  # Prevent unexpected downloads
    'bypass_csp': False,  # Respect Content Security Policy
    'locale': 'en-US',
    'timezone_id': 'America/New_York',
    'permissions': [],  # No special permissions
    'geolocation': None,  # No geolocation
    'color_scheme': 'light'
}
```

## Workflow Templates

### Login → Navigate → Extract

```python
from playwright.sync_api import sync_playwright

WORKFLOW_CONFIG = {
    "login": {
        "url": "https://example.com/login",
        "credentials": {
            "username": {"selector": "#username", "value": "user@example.com"},
            "password": {"selector": "#password", "value": "password", "sensitive": True}
        },
        "submit": "#login-button",
        "verify": ".user-profile"
    },
    "navigate": {
        "url": "https://example.com/data"
    },
    "extract": {
        "data": {
            "selector": ".data-table",
            "type": "table"
        }
    }
}
```

### Multi-Step Form

```python
MULTI_STEP_FORM = {
    "step1": {
        "fields": {
            "first_name": {"type": "text", "value": "John"},
            "last_name": {"type": "text", "value": "Doe"},
            "email": {"type": "email", "value": "john@example.com"}
        },
        "next_button": "button.next-step"
    },
    "step2": {
        "fields": {
            "address": {"type": "text", "value": "123 Main St"},
            "city": {"type": "text", "value": "Anytown"},
            "country": {"type": "select", "value": "US"}
        },
        "next_button": "button.next-step"
    },
    "step3": {
        "fields": {
            "card_number": {"type": "text", "value": "4111111111111111", "sensitive": True},
            "cvv": {"type": "text", "value": "123", "sensitive": True}
        },
        "submit_button": "button.submit"
    }
}
```

### Infinite Scroll Scraping

```python
INFINITE_SCROLL_CONFIG = {
    "url": "https://example.com/feed",
    "item_selector": ".feed-item",
    "scroll_delay": 1000,  # ms between scrolls
    "max_scrolls": 10,
    "extract": {
        "title": ".item-title",
        "link": ".item-link",
        "timestamp": ".item-time"
    }
}
```

## Environment Variables

Recommended environment variables for secure automation:

```bash
# Security
export BROWSER_ALLOWED_DOMAINS="example.com,api.example.com"
export BROWSER_TIMEOUT=30000
export BROWSER_HEADLESS=true

# Credentials (never hardcode!)
export APP_USERNAME="user@example.com"
export APP_PASSWORD="secure_password"
export API_KEY="your_api_key_here"

# Browser settings
export BROWSER_VIEWPORT_WIDTH=1280
export BROWSER_VIEWPORT_HEIGHT=720
export BROWSER_USER_AGENT="Custom Agent String"

# Output
export SCREENSHOT_DIR="./screenshots"
export SESSION_DIR="./sessions"
export DATA_OUTPUT_DIR="./data"
```

## Common Selectors Reference

### By Priority (Most Stable → Least Stable)

1. **Accessibility Roles** (most stable)
   - `role=button[name="Submit"]`
   - `role=textbox[name="Email"]`
   - `role=link[name="Learn More"]`

2. **Test IDs**
   - `[data-testid="submit-button"]`
   - `[data-test="login-form"]`

3. **Semantic HTML + ARIA**
   - `button[aria-label="Close"]`
   - `input[aria-label="Search"]`

4. **Labels**
   - `label:has-text("Email") >> input`
   - `text="Submit" >> ..`

5. **IDs**
   - `#submit-button`
   - `#email-input`

6. **Classes** (less stable)
   - `.btn-primary`
   - `.form-input`

7. **XPath** (last resort)
   - `//button[@class='submit']`
   - `//input[@name='email']`

### Common Patterns

```python
# Forms
"input[name='email']"
"input[type='password']"
"select[name='country']"
"input[type='checkbox'][name='terms']"
"button[type='submit']"

# Navigation
"nav a:has-text('Home')"
"role=navigation >> role=link[name='Contact']"

# Content
".article-title"
"main h1"
".product-price"

# Tables
"table.data-table"
"table thead th"
"table tbody tr"

# Dynamic content
".loading-spinner"
"[data-loaded='true']"
".toast-message"
```
