#!/usr/bin/env python3
"""
Screenshot capture and visual testing utilities.

Usage:
    python visual_testing.py --help
    python visual_testing.py capture --url https://example.com --output screenshot.png
    python visual_testing.py element --url https://example.com --selector ".header" --output header.png
    python visual_testing.py compare --baseline baseline.png --current current.png
"""

import argparse
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright


class VisualTesting:
    """Visual testing and screenshot utilities."""
    
    def __init__(self, headless: bool = True, viewport: dict = None):
        self.headless = headless
        self.viewport = viewport or {'width': 1280, 'height': 720}
        self.playwright = None
        self.browser = None
        self.page = None
    
    def __enter__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=self.headless)
        self.page = self.browser.new_page(viewport=self.viewport)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
    
    def capture_page(self, output_path: str, full_page: bool = False):
        """Capture full page screenshot."""
        self.page.screenshot(path=output_path, full_page=full_page)
        print(f"✓ Screenshot saved: {output_path}")
        
        # Get dimensions
        dimensions = self.page.evaluate('''() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight
        })''')
        print(f"  Size: {dimensions['width']}x{dimensions['height']}")
    
    def capture_element(self, selector: str, output_path: str):
        """Capture screenshot of specific element."""
        self.page.wait_for_selector(selector, timeout=10000)
        element = self.page.locator(selector)
        element.screenshot(path=output_path)
        print(f"✓ Element screenshot saved: {output_path}")
    
    def capture_viewport(self, output_path: str):
        """Capture current viewport only."""
        self.page.screenshot(path=output_path, full_page=False)
        print(f"✓ Viewport screenshot saved: {output_path}")
        print(f"  Viewport: {self.viewport['width']}x{self.viewport['height']}")
    
    def wait_and_capture(self, selector: str, output_path: str, timeout: int = 30000):
        """Wait for element to appear, then capture."""
        print(f"Waiting for element: {selector}")
        self.page.wait_for_selector(selector, state='visible', timeout=timeout)
        self.capture_page(output_path, full_page=True)


def compare_images(baseline_path: str, current_path: str, diff_path: str = None):
    """
    Compare two images and report differences.
    
    Note: This is a simple pixel-by-pixel comparison.
    For production use, consider tools like pixelmatch or pytest-playwright.
    """
    try:
        from PIL import Image, ImageChops
        import numpy as np
    except ImportError:
        print("Error: PIL (Pillow) required for image comparison", file=sys.stderr)
        print("Install with: pip install Pillow", file=sys.stderr)
        sys.exit(1)
    
    # Load images
    baseline = Image.open(baseline_path)
    current = Image.open(current_path)
    
    # Check dimensions
    if baseline.size != current.size:
        print(f"✗ Image dimensions differ:", file=sys.stderr)
        print(f"  Baseline: {baseline.size}", file=sys.stderr)
        print(f"  Current:  {current.size}", file=sys.stderr)
        return False
    
    # Calculate difference
    diff = ImageChops.difference(baseline, current)
    
    # Convert to numpy for analysis
    diff_array = np.array(diff)
    
    # Calculate metrics
    max_diff = diff_array.max()
    mean_diff = diff_array.mean()
    diff_pixels = np.count_nonzero(diff_array)
    total_pixels = diff_array.size
    diff_percentage = (diff_pixels / total_pixels) * 100
    
    print(f"\nComparison Results:")
    print(f"  Max difference:     {max_diff}")
    print(f"  Mean difference:    {mean_diff:.2f}")
    print(f"  Different pixels:   {diff_pixels:,} / {total_pixels:,}")
    print(f"  Difference:         {diff_percentage:.2f}%")
    
    # Save diff image if requested
    if diff_path:
        # Enhance diff for visibility
        diff_enhanced = diff.point(lambda x: x * 10)
        diff_enhanced.save(diff_path)
        print(f"\n✓ Difference image saved: {diff_path}")
    
    # Return True if images are identical
    is_identical = max_diff == 0
    if is_identical:
        print("\n✓ Images are identical")
    else:
        print(f"\n✗ Images differ by {diff_percentage:.2f}%")
    
    return is_identical


def main():
    parser = argparse.ArgumentParser(
        description='Visual testing and screenshot utilities'
    )
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Capture page
    capture_parser = subparsers.add_parser('capture', help='Capture page screenshot')
    capture_parser.add_argument('--url', required=True)
    capture_parser.add_argument('--output', required=True)
    capture_parser.add_argument('--full-page', action='store_true', help='Capture full page')
    capture_parser.add_argument('--width', type=int, default=1280)
    capture_parser.add_argument('--height', type=int, default=720)
    capture_parser.add_argument('--headless', action='store_true', default=True)
    
    # Capture element
    element_parser = subparsers.add_parser('element', help='Capture element screenshot')
    element_parser.add_argument('--url', required=True)
    element_parser.add_argument('--selector', required=True)
    element_parser.add_argument('--output', required=True)
    element_parser.add_argument('--width', type=int, default=1280)
    element_parser.add_argument('--height', type=int, default=720)
    element_parser.add_argument('--headless', action='store_true', default=True)
    
    # Wait and capture
    wait_parser = subparsers.add_parser('wait', help='Wait for element then capture')
    wait_parser.add_argument('--url', required=True)
    wait_parser.add_argument('--selector', required=True)
    wait_parser.add_argument('--output', required=True)
    wait_parser.add_argument('--timeout', type=int, default=30000)
    wait_parser.add_argument('--width', type=int, default=1280)
    wait_parser.add_argument('--height', type=int, default=720)
    wait_parser.add_argument('--headless', action='store_true', default=True)
    
    # Compare images
    compare_parser = subparsers.add_parser('compare', help='Compare two screenshots')
    compare_parser.add_argument('--baseline', required=True)
    compare_parser.add_argument('--current', required=True)
    compare_parser.add_argument('--diff', help='Output path for diff image')
    
    args = parser.parse_args()
    
    try:
        if args.command == 'compare':
            # Image comparison (no browser needed)
            is_identical = compare_images(args.baseline, args.current, args.diff)
            sys.exit(0 if is_identical else 1)
        
        # Browser-based commands
        viewport = {'width': args.width, 'height': args.height}
        
        with VisualTesting(headless=args.headless, viewport=viewport) as testing:
            # Navigate to URL
            testing.page.goto(args.url)
            testing.page.wait_for_load_state('networkidle')
            print(f"✓ Navigated to: {args.url}")
            
            if args.command == 'capture':
                testing.capture_page(args.output, full_page=args.full_page)
            
            elif args.command == 'element':
                testing.capture_element(args.selector, args.output)
            
            elif args.command == 'wait':
                testing.wait_and_capture(args.selector, args.output, timeout=args.timeout)
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
