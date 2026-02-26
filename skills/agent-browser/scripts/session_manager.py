#!/usr/bin/env python3
"""
Cookie and storage session management for browser automation.

Usage:
    python session_manager.py --help
    python session_manager.py save --url https://example.com --output session.json
    python session_manager.py restore --url https://example.com --input session.json
"""

import argparse
import json
import sys
from playwright.sync_api import sync_playwright


class SessionManager:
    """Manage browser sessions with cookies and storage."""
    
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.playwright = None
        self.browser = None
        self.context = None
    
    def __enter__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.context = self.browser.new_context()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
    
    def save_session(self, page, output_path: str):
        """Save cookies and storage to file."""
        # Get cookies
        cookies = self.context.cookies()
        
        # Get storage (must be on the page's domain)
        try:
            local_storage = page.evaluate('() => Object.entries(localStorage)')
            session_storage = page.evaluate('() => Object.entries(sessionStorage)')
        except Exception as e:
            print(f"Warning: Could not access storage: {e}", file=sys.stderr)
            local_storage = []
            session_storage = []
        
        # Build session data
        session_data = {
            'url': page.url,
            'cookies': cookies,
            'localStorage': local_storage,
            'sessionStorage': session_storage,
            'timestamp': page.evaluate('() => Date.now()')
        }
        
        # Save to file
        with open(output_path, 'w') as f:
            json.dump(session_data, f, indent=2)
        
        print(f"✓ Session saved to: {output_path}")
        print(f"  - Cookies: {len(cookies)}")
        print(f"  - LocalStorage items: {len(local_storage)}")
        print(f"  - SessionStorage items: {len(session_storage)}")
        
        return session_data
    
    def restore_session(self, page, session_path: str):
        """Restore cookies and storage from file."""
        # Load session data
        with open(session_path) as f:
            session_data = json.load(f)
        
        # Restore cookies
        cookies = session_data.get('cookies', [])
        if cookies:
            self.context.add_cookies(cookies)
            print(f"✓ Restored {len(cookies)} cookies")
        
        # Must navigate to domain first before setting storage
        original_url = session_data.get('url', '')
        if original_url:
            page.goto(original_url)
        
        # Restore localStorage
        local_storage = session_data.get('localStorage', [])
        for key, value in local_storage:
            try:
                page.evaluate(
                    f'({{key, value}}) => localStorage.setItem(key, value)',
                    {'key': key, 'value': value}
                )
            except Exception as e:
                print(f"Warning: Could not restore localStorage item {key}: {e}", file=sys.stderr)
        
        if local_storage:
            print(f"✓ Restored {len(local_storage)} localStorage items")
        
        # Restore sessionStorage
        session_storage = session_data.get('sessionStorage', [])
        for key, value in session_storage:
            try:
                page.evaluate(
                    f'({{key, value}}) => sessionStorage.setItem(key, value)',
                    {'key': key, 'value': value}
                )
            except Exception as e:
                print(f"Warning: Could not restore sessionStorage item {key}: {e}", file=sys.stderr)
        
        if session_storage:
            print(f"✓ Restored {len(session_storage)} sessionStorage items")
        
        # Reload page to apply session
        page.reload()
        
        return session_data
    
    def clear_session(self, page):
        """Clear all cookies and storage."""
        # Clear context cookies
        self.context.clear_cookies()
        
        # Clear storage
        try:
            page.evaluate('() => localStorage.clear()')
            page.evaluate('() => sessionStorage.clear()')
            print("✓ Session cleared")
        except Exception as e:
            print(f"Warning: Could not clear storage: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description='Manage browser session state (cookies and storage)'
    )
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Save command
    save_parser = subparsers.add_parser('save', help='Save session to file')
    save_parser.add_argument('--url', required=True, help='URL to navigate to')
    save_parser.add_argument('--output', required=True, help='Output JSON file path')
    save_parser.add_argument('--headless', action='store_true', default=True)
    
    # Restore command
    restore_parser = subparsers.add_parser('restore', help='Restore session from file')
    restore_parser.add_argument('--url', help='URL to navigate to (optional, uses saved URL if not provided)')
    restore_parser.add_argument('--input', required=True, help='Input JSON file path')
    restore_parser.add_argument('--verify-selector', help='CSS selector to verify session is active')
    restore_parser.add_argument('--headless', action='store_true', default=True)
    
    # Clear command
    clear_parser = subparsers.add_parser('clear', help='Clear all session data')
    clear_parser.add_argument('--url', required=True, help='URL to navigate to')
    clear_parser.add_argument('--headless', action='store_true', default=True)
    
    args = parser.parse_args()
    
    try:
        with SessionManager(headless=args.headless) as manager:
            page = manager.context.new_page()
            
            if args.command == 'save':
                page.goto(args.url)
                page.wait_for_load_state('networkidle')
                manager.save_session(page, args.output)
            
            elif args.command == 'restore':
                session_data = manager.restore_session(page, args.input)
                
                # Navigate to URL if provided, otherwise use saved URL
                target_url = args.url or session_data.get('url')
                if target_url:
                    page.goto(target_url)
                    page.wait_for_load_state('networkidle')
                    print(f"✓ Navigated to: {target_url}")
                
                # Verify session if selector provided
                if args.verify_selector:
                    if page.locator(args.verify_selector).is_visible():
                        print(f"✓ Session verified: element '{args.verify_selector}' is visible")
                    else:
                        print(f"✗ Session verification failed: element '{args.verify_selector}' not found", file=sys.stderr)
                        sys.exit(1)
            
            elif args.command == 'clear':
                page.goto(args.url)
                manager.clear_session(page)
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
