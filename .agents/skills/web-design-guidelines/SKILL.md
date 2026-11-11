---
name: web-design-guidelines
description: Review this Uni-app driver's H5 and cross-platform UI against current web interface, accessibility, typography, touch, safe-area, responsive-layout, content, and performance guidelines. Use for UI reviews, UX audits, accessibility checks, responsive checks, or whenever a user-facing page or component is changed.
---

# Web Interface Guidelines

Review the requested UI files against the latest rules at:

`https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`

Fetch the source before each review when internet access is available. Apply rules that map to Uni-app and the enabled target platforms; do not force React-specific syntax onto Vue or mini-program output.

## Uni-app Mapping

- Treat `wd-button` or native `button` as the semantic action primitive. Flag action handlers placed on plain `view`/`text` when a button is practical.
- Check accessible names for icon-only controls, labels for inputs, focus-visible behavior on H5, and non-color status cues.
- Check `env(safe-area-inset-*)`, touch target size, intentional tap highlight, and popup scroll containment.
- Check long Chinese text, identifiers, addresses, missing values, numeric alignment, and accidental horizontal overflow.
- Check explicit image dimensions, appropriate loading behavior, `prefers-reduced-motion`, and enumerated transitions.
- Accept Uni-app lifecycle, navigation, and conditional compilation patterns when they provide the platform-equivalent behavior.

## Review Workflow

1. Read the requested files plus the shared tokens and relevant child components.
2. Fetch and apply the current guideline rules.
3. Verify rendered behavior in a real browser when practical.
4. Fix issues when the user requested implementation; otherwise report concise findings grouped by file as `file:line - issue`.
5. Mark clean files with `✓ pass` and state any platform or browser verification limitation.
