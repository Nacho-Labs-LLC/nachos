#!/usr/bin/env python3
"""
Secure browser wrapper with domain validation and security controls.

Usage:
    python browser_secure.py --help
    python browser_secure.py --url https://example.com --allowed-domains example.com,trusted.com
"""

import argparse
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, Error


class SecureBrowser:
    """Browser wrapper with security controls."""
    
    def __init__(self, allowed_domains: list[str], headless: bool = True):
        self.allowed_domains = allowed_domains
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.context = None
        
    def validate_url(self, url: str) -> bool:
        """Check if URL domain is in allowlist."""
        try:
            domain = urlparse(url).netloc
            # Remove port if present
            domain = domain.split(':')[0]
            
            return any(
                domain == allowed or domain.endswith(f'.{allowed}')
                for allowed in self.allowed_domains
            )
        except Exception:
            return False
    
    def __enter__(self):
        """Context manager entry."""
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        )
        self.context = self.browser.new_context(
            viewport={'width': 1280, 'height': 720},
            ignore_https_errors=False,
            java_script_enabled=True,
            accept_downloads=False
        )
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
    
    def navigate(self, url: str):
        """Navigate to URL after validation."""
        if not self.validate_url(url):
            raise SecurityError(f"Domain not in allowlist: {url}")
        
        page = self.context.new_page()
        
        try:
            page.goto(url, wait_until='networkidle', timeout=60000)
            page.wait_for_load_state('networkidle')
            return page
        except Error as e:
            page.close()
            raise
    
    def extract_text(self, page, selector: str) -> str:
        """Safely extract text from element."""
        try:
            element = page.locator(selector)
            element.wait_for(state='visible', timeout=10000)
            return element.text_content()
        except Exception as e:
            print(f"Warning: Could not extract text from {selector}: {e}", file=sys.stderr)
            return ""
    
    def screenshot(self, page, output_path: str, full_page: bool = False):
        """Take screenshot of page."""
        page.screenshot(path=output_path, full_page=full_page)
        print(f"Screenshot saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description='Secure browser automation with domain allowlist'
    )
    parser.add_argument(
        '--url',
        required=True,
        help='URL to navigate to'
    )
    parser.add_argument(
        '--allowed-domains',
        required=True,
        help='Comma-separated list of allowed domains (e.g., example.com,api.example.com)'
    )
    parser.add_argument(
        '--selector',
        help='CSS selector to extract text from'
    )
    parser.add_argument(
        '--screenshot',
        help='Output path for screenshot'
    )
    parser.add_argument(
        '--full-page',
        action='store_true',
        help='Take full-page screenshot'
    )
    parser.add_argument(
        '--headless',
        action='store_true',
        default=True,
        help='Run in headless mode (default: true)'
    )
    
    args = parser.parse_args()
    
    # Parse allowed domains
    allowed_domains = [d.strip() for d in args.allowed_domains.split(',')]
    
    # Run secure browser
    try:
        with SecureBrowser(allowed_domains, headless=args.headless) as browser:
            page = browser.navigate(args.url)
            
            if args.selector:
                text = browser.extract_text(page, args.selector)
                print(text)
            
            if args.screenshot:
                browser.screenshot(page, args.screenshot, full_page=args.full_page)
            
            if not args.selector and not args.screenshot:
                # Default: print page title
                print(f"Title: {page.title()}")
                print(f"URL: {page.url}")
    
    except SecurityError as e:
        print(f"Security error: {e}", file=sys.stderr)
        sys.exit(1)
    except Error as e:
        print(f"Browser error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
