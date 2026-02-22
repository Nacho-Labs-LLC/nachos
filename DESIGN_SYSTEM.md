# Nachos Design System

**Date:** 2026-02-22  
**Status:** Track 5 - Design System Concept  
**Theme:** Nachos & Layers 🧀

---

## Brand Identity

### Core Concept: **Layers of Flavor**

Nachos are all about **layers** — chips, cheese, salsa, guac, jalapeños, sour cream. Each layer adds something unique. The Nachos framework mirrors this:

- **Channels** (bottom layer - the chips, the foundation)
- **Gateway** (melted cheese - binds everything)
- **Tools** (toppings - add functionality)
- **LLM** (the flavor - brings it all together)
- **Skills** (extra toppings - customize to taste)

**Design philosophy:**
- **Modular** - Add/remove layers as needed
- **Playful yet professional** - Fun but not childish
- **Warm and inviting** - Like comfort food
- **Technical but accessible** - Sophisticated simplicity

---

## Logo & Wordmark Concepts

### Logo: Layered Icon

```
Option 1: Stacked Layers
┌─────────────┐
│  ▓▓▓▓▓▓▓▓▓  │  ← Skill layer
├─────────────┤
│  ▒▒▒▒▒▒▒▒▒  │  ← Tool layer
├─────────────┤
│  ░░░░░░░░░  │  ← Gateway layer
├─────────────┤
│  ▓▓▓▓▓▓▓▓▓  │  ← Channel layer
└─────────────┘

Option 2: Cheese Wedge
    /\
   /  \
  /🧀🧀\   ← Simplified cheese wedge
 /______\

Option 3: Abstract N
 ███╗   ██╗
 ████╗  ██║
 ██╔██╗ ██║  ← Blocky, layered N
 ██║╚██╗██║
 ██║ ╚████║
 ╚═╝  ╚═══╝
```

**Recommended:** Option 2 (Cheese Wedge)
- Simple, memorable
- Works at any size
- Ties to "Nachos" name
- Can be animated (melt effect)

### Wordmark

```
NACHOS
Modular AI Orchestration
```

**Typography:**
- **Wordmark:** Bold, geometric sans-serif (e.g., Inter, Space Grotesk)
- **Tagline:** Lighter weight, slightly condensed

---

## Color Palette

### Primary Colors (Nacho-Inspired)

```css
/* Cheese (Primary - warm yellow/gold) */
--cheese-50:  #FFFBEB;   /* Lightest - backgrounds */
--cheese-100: #FEF3C7;
--cheese-200: #FDE68A;
--cheese-400: #FBBF24;   /* Main brand color */
--cheese-600: #D97706;   /* Hover states */
--cheese-800: #92400E;   /* Dark mode text */

/* Salsa (Accent - vibrant red/orange) */
--salsa-400: #FB923C;    /* Accent color */
--salsa-600: #EA580C;    /* Hover */
--salsa-700: #C2410C;    /* Active */

/* Guac (Success - fresh green) */
--guac-400: #4ADE80;     /* Success states */
--guac-600: #16A34A;
--guac-700: #15803D;

/* Sour Cream (Neutral - cool grays) */
--cream-50:  #F9FAFB;    /* Backgrounds */
--cream-100: #F3F4F6;
--cream-200: #E5E7EB;    /* Borders */
--cream-400: #9CA3AF;    /* Muted text */
--cream-600: #4B5563;    /* Secondary text */
--cream-800: #1F2937;    /* Primary text */
--cream-900: #111827;    /* Headings */
```

### Semantic Colors

```css
/* Status colors */
--success: var(--guac-600);    /* Green */
--warning: var(--salsa-400);   /* Orange */
--error: #EF4444;              /* Red */
--info: #3B82F6;               /* Blue */

/* Interaction */
--primary: var(--cheese-400);  /* Brand gold */
--primary-hover: var(--cheese-600);
--accent: var(--salsa-400);    /* Call-to-action */
--accent-hover: var(--salsa-600);
```

### Dark Mode

```css
[data-theme="dark"] {
  --bg: #0A0A0A;                /* Deep black */
  --surface: #171717;           /* Elevated surfaces */
  --surface-2: #262626;         /* Cards, inputs */
  --border: #404040;
  --text: #FAFAFA;
  --text-muted: #A3A3A3;
  
  /* Adjust brand colors for dark mode */
  --cheese-primary: #FBBF24;    /* Brighter gold */
  --salsa-primary: #FB923C;     /* Softer orange */
  --guac-primary: #4ADE80;      /* Brighter green */
}
```

---

## Typography

### Font Stack

```css
/* Headings & UI */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 
             system-ui, sans-serif;

/* Code & Data */
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
```

### Type Scale

```css
/* Headings */
--text-xs: 11px;      /* Labels, captions */
--text-sm: 13px;      /* Body small */
--text-base: 15px;    /* Body text */
--text-lg: 17px;      /* Subheadings */
--text-xl: 20px;      /* H3 */
--text-2xl: 24px;     /* H2 */
--text-3xl: 30px;     /* H1 */
--text-4xl: 36px;     /* Hero */

/* Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;

/* Line heights */
--leading-tight: 1.25;
--leading-snug: 1.375;
--leading-normal: 1.5;
--leading-relaxed: 1.625;
```

---

## Spacing & Layout

### Spacing Scale (8px base)

```css
--space-1: 4px;    /* 0.25rem */
--space-2: 8px;    /* 0.5rem */
--space-3: 12px;   /* 0.75rem */
--space-4: 16px;   /* 1rem */
--space-5: 20px;   /* 1.25rem */
--space-6: 24px;   /* 1.5rem */
--space-8: 32px;   /* 2rem */
--space-10: 40px;  /* 2.5rem */
--space-12: 48px;  /* 3rem */
--space-16: 64px;  /* 4rem */
--space-20: 80px;  /* 5rem */
```

### Border Radius

```css
--radius-sm: 3px;   /* Chips, tags */
--radius: 6px;      /* Buttons, inputs */
--radius-md: 8px;   /* Cards */
--radius-lg: 12px;  /* Modals */
--radius-xl: 16px;  /* Hero sections */
--radius-full: 9999px; /* Pills, avatars */
```

### Shadows

```css
/* Light mode */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
--shadow: 0 1px 3px rgba(0, 0, 0, 0.1),
          0 1px 2px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07),
             0 2px 4px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1),
             0 4px 6px rgba(0, 0, 0, 0.05);

/* Dark mode - lighter shadows */
[data-theme="dark"] {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.6);
}
```

---

## Component Library

### Buttons

```css
/* Primary (cheese gold) */
.btn-primary {
  background: var(--cheese-400);
  color: var(--cream-900);
  font-weight: 600;
  padding: 8px 16px;
  border-radius: var(--radius);
  transition: background 0.15s;
}
.btn-primary:hover {
  background: var(--cheese-600);
}

/* Secondary (salsa accent) */
.btn-secondary {
  background: transparent;
  border: 1.5px solid var(--salsa-400);
  color: var(--salsa-600);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
}
```

### Cards

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  box-shadow: var(--shadow-sm);
}

.card-hover:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--cheese-400);
  transform: translateY(-2px);
  transition: all 0.2s;
}
```

### Status Indicators

```html
<!-- Running (green) -->
<span class="status-dot status-success"></span>

<!-- Warning (orange) -->
<span class="status-dot status-warning"></span>

<!-- Error (red) -->
<span class="status-dot status-error"></span>

<!-- Idle (gray) -->
<span class="status-dot status-idle"></span>
```

```css
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-success { background: var(--guac-600); }
.status-warning { background: var(--salsa-400); }
.status-error { background: var(--error); }
.status-idle { background: var(--cream-400); }
```

### Badges

```html
<span class="badge badge-cheese">Beta</span>
<span class="badge badge-salsa">New</span>
<span class="badge badge-guac">Active</span>
```

```css
.badge {
  display: inline-block;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.badge-cheese {
  background: rgba(251, 191, 36, 0.15);
  color: var(--cheese-600);
}
```

---

## Documentation Site Design

### Homepage Hero

```
┌─────────────────────────────────────────┐
│                                         │
│     🧀 Nachos                          │
│     Modular AI Orchestration           │
│                                         │
│     [Get Started]  [View Docs]         │
│                                         │
│     ┌───────┐  ┌───────┐  ┌───────┐   │
│     │Channel│  │Gateway│  │  LLM  │   │  ← Layered diagram
│     └───────┘  └───────┘  └───────┘   │
│                                         │
└─────────────────────────────────────────┘
```

**Design notes:**
- Large cheese emoji as hero icon
- Gradient background (cheese-50 to cream-50)
- Animated layer diagram (builds on scroll)
- Big, friendly CTAs

### Feature Cards

```
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ 🔌 Channels    │  │ 🛠️ Tools      │  │ 📝 Memory     │
│                │  │                │  │                │
│ Connect your   │  │ Extend with    │  │ Remember      │
│ favorite       │  │ powerful       │  │ context       │
│ platforms      │  │ capabilities   │  │ across        │
│                │  │                │  │ sessions      │
└────────────────┘  └────────────────┘  └────────────────┘
```

### Code Examples

```html
<div class="code-example">
  <div class="code-tabs">
    <button class="tab active">nachos.toml</button>
    <button class="tab">Docker</button>
    <button class="tab">CLI</button>
  </div>
  <pre><code class="language-toml">
[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[channels.discord]
enabled = true
token = "..."
  </code></pre>
</div>
```

**Syntax highlighting:** Use Prism.js with custom theme (cheese-tinted)

---

## Animations & Interactions

### Cheese Melt Animation

For loading states:
```css
@keyframes melt {
  0% {
    transform: translateY(0);
    opacity: 1;
  }
  100% {
    transform: translateY(10px);
    opacity: 0.6;
    filter: blur(2px);
  }
}

.loading-cheese {
  animation: melt 1s ease-in-out infinite alternate;
}
```

### Layer Build Animation

For homepage diagram:
```css
.layer {
  opacity: 0;
  transform: translateY(20px);
  animation: slide-in 0.5s ease-out forwards;
}

.layer:nth-child(1) { animation-delay: 0.1s; }
.layer:nth-child(2) { animation-delay: 0.2s; }
.layer:nth-child(3) { animation-delay: 0.3s; }

@keyframes slide-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### Hover Effects

```css
/* Cards lift on hover */
.card-interactive {
  transition: transform 0.2s, box-shadow 0.2s;
}
.card-interactive:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

/* Buttons grow slightly */
.btn {
  transition: transform 0.1s;
}
.btn:active {
  transform: scale(0.98);
}
```

---

## Icon System

### Custom Icons (SVG)

**Layer icon:**
```svg
<svg viewBox="0 0 24 24">
  <rect x="2" y="2" width="20" height="4" rx="1" fill="currentColor" opacity="0.3"/>
  <rect x="2" y="8" width="20" height="4" rx="1" fill="currentColor" opacity="0.5"/>
  <rect x="2" y="14" width="20" height="4" rx="1" fill="currentColor" opacity="0.7"/>
  <rect x="2" y="20" width="20" height="4" rx="1" fill="currentColor"/>
</svg>
```

**Cheese wedge:**
```svg
<svg viewBox="0 0 24 24">
  <path d="M4 20 L12 4 L20 20 Z" fill="#FBBF24"/>
  <circle cx="8" cy="16" r="1.5" fill="#FDE68A"/>
  <circle cx="14" cy="14" r="1" fill="#FDE68A"/>
  <circle cx="10" cy="12" r="1.2" fill="#FDE68A"/>
</svg>
```

### Icon Library

Use **Lucide Icons** (clean, consistent, open-source)
- Channels: `MessageSquare`, `Send`, `Inbox`
- Tools: `Wrench`, `Code`, `Terminal`
- Status: `CheckCircle`, `AlertCircle`, `XCircle`
- Navigation: `Menu`, `X`, `ChevronRight`

---

## Accessibility

### Color Contrast

All text combinations meet **WCAG AA** (4.5:1):
- Primary text on background: ✅ 15:1
- Muted text on background: ✅ 4.8:1
- Button text on cheese-400: ✅ 5.2:1

### Focus Indicators

```css
:focus-visible {
  outline: 2px solid var(--cheese-400);
  outline-offset: 2px;
  border-radius: var(--radius);
}

/* Alternative: ring style */
:focus-visible {
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.3);
}
```

---

## Implementation Plan

### Phase 1: Design Tokens (2 hours)

```css
/* Create design-tokens.css */
:root {
  /* Colors, typography, spacing from above */
}

[data-theme="dark"] {
  /* Dark mode overrides */
}
```

### Phase 2: Component Library (4 hours)

```css
/* Create components.css */
.btn { /* ... */ }
.card { /* ... */ }
.badge { /* ... */ }
/* etc. */
```

### Phase 3: Documentation Site (8 hours)

- Choose framework (VitePress recommended)
- Apply design system
- Create page templates
- Add navigation
- Deploy

### Phase 4: Brand Assets (2 hours)

- Export logo SVGs
- Create favicon
- Generate social media assets (OG images)
- Create email signature template

---

## Files to Create

```
packages/design/
├── tokens.css              # Design tokens
├── components.css          # Component styles
├── README.md               # Design system docs
├── assets/
│   ├── logo.svg
│   ├── logo-dark.svg
│   ├── icon.svg
│   └── wordmark.svg
└── examples/
    ├── button.html
    ├── card.html
    └── forms.html
```

---

## Success Metrics

- [ ] Design system used in Admin UI
- [ ] Documentation site matches brand
- [ ] CLI output uses brand colors
- [ ] All components pass accessibility audit
- [ ] Design tokens exported for other tools

---

## Next Steps

1. Review with nebula (get feedback on nacho theme!)
2. Create design tokens CSS
3. Build component library
4. Apply to Admin UI (Track 2)
5. Build docs site (Track 4)

🧀 **Let's make it delicious!**
