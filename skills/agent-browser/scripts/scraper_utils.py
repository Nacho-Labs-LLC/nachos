#!/usr/bin/env python3
"""
Data extraction utilities for web scraping.

Usage:
    python scraper_utils.py --help
    python scraper_utils.py table --url https://example.com --selector "table.data"
    python scraper_utils.py links --url https://example.com
    python scraper_utils.py structured --url https://example.com --config extract.json
"""

import argparse
import json
import sys
from playwright.sync_api import sync_playwright


class ScraperUtils:
    """Utilities for extracting data from web pages."""
    
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.page = None
    
    def __enter__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.page = self.browser.new_page()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
    
    def extract_table(self, selector: str) -> list[dict]:
        """Extract data from HTML table."""
        self.page.wait_for_selector(selector, timeout=10000)
        
        # Extract headers
        headers = self.page.locator(f'{selector} thead th').all_text_contents()
        if not headers:
            # Try first row as headers
            first_row = self.page.locator(f'{selector} tr').first
            headers = first_row.locator('th, td').all_text_contents()
        
        # Extract rows
        rows = []
        row_elements = self.page.locator(f'{selector} tbody tr').all()
        
        for row in row_elements:
            cells = row.locator('td').all_text_contents()
            if cells:
                rows.append(dict(zip(headers, cells)))
        
        return rows
    
    def extract_links(self, base_selector: str = 'a') -> list[dict]:
        """Extract all links from page."""
        links = []
        
        link_elements = self.page.locator(base_selector).all()
        
        for link in link_elements:
            try:
                href = link.get_attribute('href')
                text = link.text_content().strip()
                
                if href:
                    links.append({
                        'url': href,
                        'text': text,
                        'title': link.get_attribute('title') or ''
                    })
            except Exception:
                continue
        
        return links
    
    def extract_structured(self, config: dict) -> dict:
        """Extract structured data based on config."""
        result = {}
        
        for field, selector_config in config.items():
            try:
                selector = selector_config['selector']
                extract_type = selector_config.get('type', 'text')
                multiple = selector_config.get('multiple', False)
                
                locator = self.page.locator(selector)
                
                if multiple:
                    elements = locator.all()
                    if extract_type == 'text':
                        result[field] = [el.text_content() for el in elements]
                    elif extract_type == 'href':
                        result[field] = [el.get_attribute('href') for el in elements]
                    elif extract_type == 'src':
                        result[field] = [el.get_attribute('src') for el in elements]
                    elif extract_type == 'attribute':
                        attr = selector_config.get('attribute')
                        result[field] = [el.get_attribute(attr) for el in elements]
                else:
                    if extract_type == 'text':
                        result[field] = locator.text_content()
                    elif extract_type == 'href':
                        result[field] = locator.get_attribute('href')
                    elif extract_type == 'src':
                        result[field] = locator.get_attribute('src')
                    elif extract_type == 'attribute':
                        attr = selector_config.get('attribute')
                        result[field] = locator.get_attribute(attr)
            
            except Exception as e:
                print(f"Warning: Could not extract {field}: {e}", file=sys.stderr)
                result[field] = None
        
        return result
    
    def extract_with_js(self, script: str):
        """Execute JavaScript to extract data."""
        return self.page.evaluate(script)


def main():
    parser = argparse.ArgumentParser(
        description='Web scraping utilities'
    )
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Table extraction
    table_parser = subparsers.add_parser('table', help='Extract data from HTML table')
    table_parser.add_argument('--url', required=True)
    table_parser.add_argument('--selector', required=True, help='Table CSS selector')
    table_parser.add_argument('--output', help='Output JSON file (optional)')
    table_parser.add_argument('--headless', action='store_true', default=True)
    
    # Link extraction
    links_parser = subparsers.add_parser('links', help='Extract all links from page')
    links_parser.add_argument('--url', required=True)
    links_parser.add_argument('--selector', default='a', help='Link selector (default: a)')
    links_parser.add_argument('--output', help='Output JSON file (optional)')
    links_parser.add_argument('--headless', action='store_true', default=True)
    
    # Structured extraction
    structured_parser = subparsers.add_parser('structured', help='Extract structured data with config')
    structured_parser.add_argument('--url', required=True)
    structured_parser.add_argument('--config', required=True, help='JSON config file')
    structured_parser.add_argument('--output', help='Output JSON file (optional)')
    structured_parser.add_argument('--headless', action='store_true', default=True)
    
    # JavaScript extraction
    js_parser = subparsers.add_parser('js', help='Extract data with JavaScript')
    js_parser.add_argument('--url', required=True)
    js_parser.add_argument('--script', required=True, help='JavaScript to execute')
    js_parser.add_argument('--output', help='Output JSON file (optional)')
    js_parser.add_argument('--headless', action='store_true', default=True)
    
    args = parser.parse_args()
    
    try:
        with ScraperUtils(headless=args.headless) as scraper:
            # Navigate to URL
            scraper.page.goto(args.url)
            scraper.page.wait_for_load_state('networkidle')
            print(f"✓ Navigated to: {args.url}", file=sys.stderr)
            
            # Execute command
            if args.command == 'table':
                data = scraper.extract_table(args.selector)
                print(f"✓ Extracted {len(data)} rows", file=sys.stderr)
            
            elif args.command == 'links':
                data = scraper.extract_links(args.selector)
                print(f"✓ Extracted {len(data)} links", file=sys.stderr)
            
            elif args.command == 'structured':
                with open(args.config) as f:
                    config = json.load(f)
                data = scraper.extract_structured(config)
                print(f"✓ Extracted {len(data)} fields", file=sys.stderr)
            
            elif args.command == 'js':
                data = scraper.extract_with_js(args.script)
                print(f"✓ JavaScript executed", file=sys.stderr)
            
            # Output data
            if hasattr(args, 'output') and args.output:
                with open(args.output, 'w') as f:
                    json.dump(data, f, indent=2)
                print(f"✓ Saved to: {args.output}", file=sys.stderr)
            else:
                print(json.dumps(data, indent=2))
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
