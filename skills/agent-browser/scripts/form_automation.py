#!/usr/bin/env python3
"""
Complex form handling with validation and error recovery.

Usage:
    python form_automation.py --help
    python form_automation.py --url https://example.com/form --config form_data.json
"""

import argparse
import json
import sys
from playwright.sync_api import sync_playwright, TimeoutError


class FormAutomation:
    """Automate complex form interactions."""
    
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
    
    def fill_text_field(self, field_name: str, value: str, is_sensitive: bool = False):
        """Fill text input field."""
        try:
            selector = f'input[name="{field_name}"], textarea[name="{field_name}"]'
            self.page.wait_for_selector(selector, timeout=5000)
            self.page.fill(selector, value)
            
            if not is_sensitive:
                print(f"✓ Filled {field_name}: {value}")
            else:
                print(f"✓ Filled {field_name}: [REDACTED]")
            return True
        except TimeoutError:
            print(f"✗ Field not found: {field_name}", file=sys.stderr)
            return False
    
    def select_option(self, field_name: str, value: str):
        """Select dropdown option."""
        try:
            selector = f'select[name="{field_name}"]'
            self.page.wait_for_selector(selector, timeout=5000)
            self.page.select_option(selector, value)
            print(f"✓ Selected {field_name}: {value}")
            return True
        except TimeoutError:
            print(f"✗ Dropdown not found: {field_name}", file=sys.stderr)
            return False
    
    def check_checkbox(self, field_name: str, checked: bool = True):
        """Check or uncheck checkbox."""
        try:
            selector = f'input[name="{field_name}"][type="checkbox"]'
            self.page.wait_for_selector(selector, timeout=5000)
            
            if checked:
                self.page.check(selector)
                print(f"✓ Checked: {field_name}")
            else:
                self.page.uncheck(selector)
                print(f"✓ Unchecked: {field_name}")
            return True
        except TimeoutError:
            print(f"✗ Checkbox not found: {field_name}", file=sys.stderr)
            return False
    
    def select_radio(self, field_name: str, value: str):
        """Select radio button."""
        try:
            selector = f'input[name="{field_name}"][value="{value}"]'
            self.page.wait_for_selector(selector, timeout=5000)
            self.page.check(selector)
            print(f"✓ Selected radio {field_name}: {value}")
            return True
        except TimeoutError:
            print(f"✗ Radio button not found: {field_name}={value}", file=sys.stderr)
            return False
    
    def upload_file(self, field_name: str, file_path: str):
        """Upload file."""
        try:
            selector = f'input[name="{field_name}"][type="file"]'
            self.page.wait_for_selector(selector, timeout=5000)
            self.page.set_input_files(selector, file_path)
            print(f"✓ Uploaded file to {field_name}: {file_path}")
            return True
        except TimeoutError:
            print(f"✗ File input not found: {field_name}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"✗ File upload failed: {e}", file=sys.stderr)
            return False
    
    def fill_form(self, form_data: dict):
        """Fill entire form from config."""
        success = True
        
        for field, config in form_data.items():
            field_type = config.get('type', 'text')
            value = config.get('value')
            
            if field_type == 'text' or field_type == 'email' or field_type == 'password':
                is_sensitive = field_type == 'password' or config.get('sensitive', False)
                if not self.fill_text_field(field, value, is_sensitive):
                    success = False
            
            elif field_type == 'select':
                if not self.select_option(field, value):
                    success = False
            
            elif field_type == 'checkbox':
                if not self.check_checkbox(field, value):
                    success = False
            
            elif field_type == 'radio':
                if not self.select_radio(field, value):
                    success = False
            
            elif field_type == 'file':
                if not self.upload_file(field, value):
                    success = False
        
        return success
    
    def submit_and_verify(self, submit_selector: str = 'button[type="submit"]',
                          success_selector: str = '.success-message',
                          error_selector: str = '.error-message'):
        """Submit form and check for success/error."""
        try:
            # Submit
            self.page.click(submit_selector)
            print("✓ Form submitted")
            
            # Wait for result
            self.page.wait_for_selector(
                f'{success_selector}, {error_selector}',
                timeout=10000
            )
            
            # Check for errors
            if self.page.locator(error_selector).is_visible():
                error = self.page.locator(error_selector).text_content()
                print(f"✗ Form error: {error}", file=sys.stderr)
                return {'success': False, 'error': error}
            
            # Success
            success_msg = self.page.locator(success_selector).text_content()
            print(f"✓ Form success: {success_msg}")
            return {'success': True, 'message': success_msg}
        
        except TimeoutError:
            print("✗ No response after form submission", file=sys.stderr)
            return {'success': False, 'error': 'Timeout waiting for response'}


def main():
    parser = argparse.ArgumentParser(
        description='Automate complex form submissions'
    )
    parser.add_argument(
        '--url',
        required=True,
        help='URL of the form page'
    )
    parser.add_argument(
        '--config',
        required=True,
        help='Path to JSON config file with form data'
    )
    parser.add_argument(
        '--submit-selector',
        default='button[type="submit"]',
        help='CSS selector for submit button'
    )
    parser.add_argument(
        '--success-selector',
        default='.success-message',
        help='CSS selector for success message'
    )
    parser.add_argument(
        '--error-selector',
        default='.error-message',
        help='CSS selector for error message'
    )
    parser.add_argument(
        '--headless',
        action='store_true',
        default=True,
        help='Run in headless mode'
    )
    
    args = parser.parse_args()
    
    # Load form config
    try:
        with open(args.config) as f:
            form_data = json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Run automation
    try:
        with FormAutomation(headless=args.headless) as automation:
            # Navigate to form
            automation.page.goto(args.url)
            automation.page.wait_for_load_state('networkidle')
            print(f"✓ Navigated to: {args.url}")
            
            # Fill form
            if not automation.fill_form(form_data):
                print("Warning: Some fields failed to fill", file=sys.stderr)
            
            # Submit and verify
            result = automation.submit_and_verify(
                submit_selector=args.submit_selector,
                success_selector=args.success_selector,
                error_selector=args.error_selector
            )
            
            # Output result as JSON
            print(json.dumps(result, indent=2))
            
            sys.exit(0 if result['success'] else 1)
    
    except Exception as e:
        print(f"Automation error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
