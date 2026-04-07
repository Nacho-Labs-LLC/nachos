---
name: agent-browser
description:
  Production-grade browser automation for AI agents using Playwright. Navigate
  URLs, take screenshots, click elements, fill forms, extract text/data, wait
  for elements, handle multiple tabs, and manage cookies/sessions. Use when an
  AI agent needs to interact with web applications for data extraction, testing,
  form submission, visual verification, login flows, or any browser-based
  automation. Security-focused with sandboxed browsing and domain controls.
---

# Agent Browser - AI-Powered Browser Automation

Production-grade Playwright wrapper designed for AI agents to interact with web
applications safely and effectively.

## Core Capabilities

- **Navigation**: Visit URLs, wait for page states, handle redirects
- **Element Interaction**: Click, type, select, hover, drag-and-drop
- **Data Extraction**: Get text, attributes, tables, structured data
- **Visual Verification**: Screenshots, full-page captures, element snapshots
- **Multi-Tab Management**: Open/close tabs, switch contexts, parallel workflows
- **Session Management**: Cookies, local storage, session persistence
- **Form Automation**: Fill complex forms, handle validation, file uploads
- **Security**: Sandboxed execution, domain allowlists, credential protection

## Quick Start

### Basic Navigation and Extraction

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Navigate and wait for page load
    page.goto('https://example.com')
    page.wait_for_load_state('networkidle')

    # Extract data
    title = page.title()
    content = page.locator('main').text_content()

    # Take screenshot
    page.screenshot(path='page.png')

    browser.close()
```

### Security-First Pattern

```python
# Define allowed domains
ALLOWED_DOMAINS = ['example.com', 'api.example.com']

def is_allowed_domain(url: str) -> bool:
    from urllib.parse import urlparse
    domain = urlparse(url).netloc
    return any(domain == allowed or domain.endswith(f'.{allowed}')
               for allowed in ALLOWED_DOMAINS)

# Validate before navigation
if is_allowed_domain(url):
    page.goto(url)
else:
    raise SecurityError(f"Domain not allowed: {url}")
```

## Common Workflows

### 1. Login Flow

```python
def login(page, username: str, password: str, login_url: str):
    """
    Secure login workflow with state verification.
    """
    page.goto(login_url)
    page.wait_for_load_state('networkidle')

    # Fill credentials
    page.fill('input[name="username"]', username)
    page.fill('input[name="password"]', password)

    # Submit and wait for navigation
    page.click('button[type="submit"]')
    page.wait_for_url('**/dashboard**', timeout=10000)

    # Verify login success
    assert page.locator('.user-profile').is_visible()

    return page.context().cookies()
```

### 2. Data Scraping

```python
def scrape_table(page, table_selector: str) -> list[dict]:
    """
    Extract structured data from HTML table.
    """
    page.wait_for_selector(table_selector)

    # Extract headers
    headers = page.locator(f'{table_selector} thead th').all_text_contents()

    # Extract rows
    rows = []
    row_elements = page.locator(f'{table_selector} tbody tr').all()

    for row in row_elements:
        cells = row.locator('td').all_text_contents()
        rows.append(dict(zip(headers, cells)))

    return rows
```

### 3. Form Submission

```python
def submit_form(page, form_data: dict):
    """
    Fill and submit complex forms with validation handling.
    """
    # Fill text inputs
    for field, value in form_data.items():
        page.fill(f'input[name="{field}"]', value)

    # Handle dropdowns
    page.select_option('select[name="country"]', 'US')

    # Handle checkboxes
    page.check('input[name="terms"]')

    # File upload
    page.set_input_files('input[type="file"]', 'document.pdf')

    # Submit and handle validation
    page.click('button[type="submit"]')

    # Wait for either success or error message
    page.wait_for_selector('.success-message, .error-message')

    if page.locator('.error-message').is_visible():
        error = page.locator('.error-message').text_content()
        return {'success': False, 'error': error}

    return {'success': True}
```

### 4. Visual Verification

```python
def visual_check(page, element_selector: str, expected_state: str):
    """
    Verify visual state of elements with screenshot evidence.
    """
    page.wait_for_selector(element_selector)
    element = page.locator(element_selector)

    # Capture element screenshot
    element.screenshot(path=f'{expected_state}_check.png')

    # Verify visibility and state
    checks = {
        'visible': element.is_visible(),
        'enabled': element.is_enabled(),
        'text': element.text_content(),
        'classes': element.get_attribute('class')
    }

    return checks
```

### 5. Multi-Tab Workflow

```python
def multi_tab_automation(browser):
    """
    Coordinate actions across multiple tabs.
    """
    # Create multiple pages
    page1 = browser.new_page()
    page2 = browser.new_page()

    # Navigate in parallel
    page1.goto('https://example.com/source')
    page2.goto('https://example.com/target')

    # Extract from first tab
    data = page1.locator('.data').text_content()

    # Use in second tab
    page2.fill('input[name="data"]', data)
    page2.click('button[type="submit"]')

    # Wait for result in second tab
    page2.wait_for_selector('.result')
    result = page2.locator('.result').text_content()

    return result
```

### 6. Session Persistence

```python
def save_session(page, session_file: str):
    """
    Save cookies and storage for session reuse.
    """
    import json

    session_data = {
        'cookies': page.context().cookies(),
        'localStorage': page.evaluate('() => Object.entries(localStorage)'),
        'sessionStorage': page.evaluate('() => Object.entries(sessionStorage)')
    }

    with open(session_file, 'w') as f:
        json.dump(session_data, f)

def restore_session(page, session_file: str):
    """
    Restore previous session state.
    """
    import json

    with open(session_file) as f:
        session_data = json.load(f)

    # Restore cookies
    page.context().add_cookies(session_data['cookies'])

    # Restore storage (must navigate first)
    page.goto('https://example.com')

    for key, value in session_data['localStorage']:
        page.evaluate(f'localStorage.setItem("{key}", {json.dumps(value)})')

    for key, value in session_data['sessionStorage']:
        page.evaluate(f'sessionStorage.setItem("{key}", {json.dumps(value)})')
```

## Element Selection Strategies

### Priority Order

1. **Accessible roles** (best for stability): `role=button[name="Submit"]`
2. **Test IDs** (if available): `data-testid=submit-button`
3. **Labels and text**: `text="Submit"` or `label >> input`
4. **CSS selectors**: `button.submit-btn`
5. **XPath** (last resort): `//button[@class='submit']`

### Smart Waiting

```python
# Wait for element to exist
page.wait_for_selector('.dynamic-content')

# Wait for element to be visible
page.locator('.modal').wait_for(state='visible')

# Wait for network to be idle
page.wait_for_load_state('networkidle')

# Wait for specific request
with page.expect_response('**/api/data') as response:
    page.click('button')
data = response.value.json()
```

## Security Best Practices

### 1. Domain Allowlisting

```python
# scripts/browser_secure.py
class SecureBrowser:
    def __init__(self, allowed_domains: list[str]):
        self.allowed_domains = allowed_domains
        self.playwright = None
        self.browser = None

    def validate_url(self, url: str) -> bool:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        return any(domain == d or domain.endswith(f'.{d}')
                   for d in self.allowed_domains)

    def navigate(self, page, url: str):
        if not self.validate_url(url):
            raise SecurityError(f"Blocked domain: {url}")
        page.goto(url)
```

### 2. Credential Protection

```python
# NEVER log credentials
def safe_fill_form(page, field: str, value: str, is_sensitive: bool = False):
    """
    Fill form field with logging control.
    """
    if not is_sensitive:
        print(f"Filling {field} with: {value}")
    else:
        print(f"Filling {field} with: [REDACTED]")

    page.fill(field, value)

# Use environment variables, never hardcode
import os
password = os.getenv('APP_PASSWORD')
```

### 3. Sandboxed Execution

```python
# Launch with security flags
browser = p.chromium.launch(
    headless=True,
    args=[
        '--disable-dev-shm-usage',
        '--no-sandbox',  # Only in controlled environments
        '--disable-setuid-sandbox',
        '--disable-gpu'
    ]
)

# Isolate browser contexts
context = browser.new_context(
    viewport={'width': 1280, 'height': 720},
    user_agent='Mozilla/5.0...',
    ignore_https_errors=False,  # Enforce HTTPS
    java_script_enabled=True,
    accept_downloads=False  # Prevent unexpected downloads
)
```

### 4. Timeout Controls

```python
# Set reasonable timeouts to prevent hangs
page.set_default_timeout(30000)  # 30 seconds
page.set_default_navigation_timeout(60000)  # 60 seconds

# Use try-except for graceful handling
try:
    page.wait_for_selector('.slow-element', timeout=10000)
except TimeoutError:
    print("Element did not appear in time")
    # Handle gracefully
```

## Advanced Techniques

### Network Interception

```python
def intercept_api_calls(page):
    """
    Monitor and modify network requests.
    """
    api_calls = []

    def handle_request(route, request):
        # Log API calls
        if '/api/' in request.url:
            api_calls.append({
                'url': request.url,
                'method': request.method,
                'headers': request.headers
            })

        # Continue request
        route.continue_()

    page.route('**/*', handle_request)
    return api_calls
```

### JavaScript Evaluation

```python
# Extract complex data structures
data = page.evaluate('''() => {
    return Array.from(document.querySelectorAll('.item')).map(item => ({
        title: item.querySelector('.title').textContent,
        price: item.querySelector('.price').textContent,
        link: item.querySelector('a').href
    }));
}''')

# Modify page behavior
page.evaluate('() => { window.scrollTo(0, document.body.scrollHeight); }')
```

### Dynamic Content Handling

```python
def wait_for_dynamic_content(page, selector: str, timeout: int = 30000):
    """
    Wait for AJAX/React content to load.
    """
    # Wait for network idle
    page.wait_for_load_state('networkidle')

    # Wait for specific element
    page.wait_for_selector(selector, state='visible', timeout=timeout)

    # Additional wait for animations
    page.wait_for_timeout(500)
```

## Error Handling Patterns

```python
from playwright.sync_api import TimeoutError, Error

def robust_automation(page, url: str):
    """
    Handle common failure modes gracefully.
    """
    try:
        page.goto(url, wait_until='networkidle', timeout=60000)

    except TimeoutError:
        # Retry with longer timeout
        page.goto(url, timeout=120000)

    except Error as e:
        if 'net::ERR_CONNECTION_REFUSED' in str(e):
            raise ConnectionError(f"Cannot connect to {url}")
        elif 'net::ERR_NAME_NOT_RESOLVED' in str(e):
            raise ValueError(f"Invalid URL: {url}")
        else:
            raise

    # Verify page loaded correctly
    if page.title() == '':
        raise RuntimeError("Page failed to load properly")

    return True
```

## Performance Optimization

### Resource Blocking

```python
# Block unnecessary resources to speed up automation
context.route('**/*.{png,jpg,jpeg,gif,svg,css,font}', lambda route: route.abort())

# Or selectively allow
def route_handler(route):
    if route.request.resource_type in ['image', 'font']:
        route.abort()
    else:
        route.continue_()

page.route('**/*', route_handler)
```

### Parallel Execution

```python
import asyncio
from playwright.async_api import async_playwright

async def scrape_multiple_pages(urls: list[str]):
    """
    Scrape multiple pages concurrently.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        async def scrape_page(url):
            page = await browser.new_page()
            await page.goto(url)
            content = await page.content()
            await page.close()
            return content

        results = await asyncio.gather(*[scrape_page(url) for url in urls])
        await browser.close()

    return results
```

## Testing and Debugging

### Debug Mode

```python
# Launch with visible browser for debugging
browser = p.chromium.launch(
    headless=False,
    slow_mo=1000  # Slow down by 1 second per action
)

# Enable console logging
page.on('console', lambda msg: print(f'Console: {msg.text}'))

# Enable request logging
page.on('request', lambda req: print(f'Request: {req.url}'))
page.on('response', lambda res: print(f'Response: {res.url} {res.status}'))
```

### Trace Recording

```python
# Record trace for debugging
context = browser.new_context()
context.tracing.start(screenshots=True, snapshots=True)

# ... perform automation ...

context.tracing.stop(path='trace.zip')
# View trace at: https://trace.playwright.dev
```

## Common Pitfalls

❌ **Don't**: Navigate before waiting for previous action

```python
page.click('button')
page.goto('https://example.com')  # May navigate before click completes
```

✅ **Do**: Wait for navigation or state change

```python
page.click('button')
page.wait_for_url('**/next-page**')
```

❌ **Don't**: Use brittle selectors

```python
page.click('div > div > div > button')  # Breaks easily
```

✅ **Do**: Use semantic selectors

```python
page.click('role=button[name="Submit"]')
```

❌ **Don't**: Assume instant element availability

```python
element = page.locator('.dynamic')
element.click()  # May fail if not loaded
```

✅ **Do**: Use auto-waiting locators

```python
page.locator('.dynamic').click()  # Waits automatically
```

## Environment Setup

### Installation

```bash
# Install Playwright
pip install playwright

# Install browsers
playwright install chromium

# Optional: Install specific browsers
playwright install firefox webkit
```

### Configuration

Create `playwright.config.py`:

```python
from playwright.sync_api import sync_playwright

class Config:
    HEADLESS = True
    VIEWPORT = {'width': 1280, 'height': 720}
    TIMEOUT = 30000
    ALLOWED_DOMAINS = ['example.com', 'trusted-site.com']

    @classmethod
    def create_browser(cls, playwright):
        return playwright.chromium.launch(headless=cls.HEADLESS)

    @classmethod
    def create_context(cls, browser):
        return browser.new_context(
            viewport=cls.VIEWPORT,
            ignore_https_errors=False,
            java_script_enabled=True
        )
```

## Integration with Nachos

### As a Nachos Skill

This skill is designed to be used by AI agents within the Nachos framework. The
agent can invoke browser automation by:

1. **Analyzing the task** to determine required actions
2. **Generating Playwright scripts** using patterns from this skill
3. **Executing scripts** in sandboxed environment
4. **Extracting and returning** structured results
5. **Handling errors** gracefully with retries

### Security in Multi-Tenant Environments

When running in Nachos:

- Enforce domain allowlists via environment variables
- Run browser in isolated Docker containers
- Limit memory and CPU usage
- Set execution timeouts
- Sanitize all extracted data before returning
- Never persist credentials
- Log actions for audit trail (excluding sensitive data)

## Reference Scripts

See `scripts/` directory for production-ready utilities:

- `browser_secure.py` - Secure browser wrapper with domain validation
- `form_automation.py` - Complex form handling
- `session_manager.py` - Cookie and storage management
- `scraper_utils.py` - Data extraction helpers
- `visual_testing.py` - Screenshot comparison utilities

Use `--help` with any script to see usage before reading source code.

## Additional Resources

- [Playwright Documentation](https://playwright.dev/python/)
- [Selectors Guide](https://playwright.dev/python/docs/selectors)
- [Best Practices](https://playwright.dev/python/docs/best-practices)
- [API Reference](https://playwright.dev/python/docs/api/class-playwright)

---

**Security Notice**: This skill enables powerful browser automation. Always
validate domains, protect credentials, and sandbox execution in production
environments. Review logs regularly for unauthorized access attempts.
