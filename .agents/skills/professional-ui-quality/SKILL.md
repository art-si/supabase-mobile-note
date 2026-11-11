---
name: professional-ui-quality
description: Enforce production-grade mobile UI quality for this Uni-app TMS driver application. Use whenever creating, modifying, refactoring, reviewing, or visually auditing a user-facing Vue page, component, workflow, form, popup, empty state, loading state, navigation surface, or responsive layout under src. Apply even when the request mentions only functionality.
---

# Professional UI Quality

Treat visual and interaction quality as part of feature completion. Build a calm, precise, trustworthy logistics interface that remains easy to operate quickly in a vehicle or warehouse environment.

## Use The Existing System

- Use the project tokens in `src/uni.scss`, Wot Design Uni components, and shared `Tms*` business components as the source of truth.
- Extend the nearest shared token or component before duplicating a broadly useful pattern in a page.
- Use HarmonyOS Sans as the primary product typeface and real bundled weights where available. Keep tabular numerals for operational data.
- Prefer neutral surfaces, indigo/blue primary accents, and restrained semantic success, warning, and danger colors.
- Build hierarchy with typography, spacing, grouping, borders, and tonal contrast before adding decoration.
- Keep one clear primary action per region. De-emphasize secondary and destructive actions.

## Mobile Design Rules

- Use a 4/8/12/16/24/32px spacing rhythm, translated consistently to `rpx`.
- Keep primary and secondary business actions at the shared 88rpx height and radius token. Do not create page-local 80/82/86rpx variants for equivalent actions.
- Keep icon-only compact controls at least 56rpx; use at least 88rpx for high-frequency or safety-critical touch actions when space permits.
- Respect every `env(safe-area-inset-*)` edge used by a full-bleed header, footer, popup, or bottom navigation.
- Use `min-width: 0`, wrapping, line clamping, or truncation deliberately. Never allow accidental horizontal scrolling.
- Avoid tiny low-contrast labels. Status must include text or an icon, not color alone.
- Treat hover as progressive enhancement; always design active, disabled, loading, and focus-visible states.

## Required Workflow

1. Read the target page, its child modules, `src/uni.scss`, and one polished neighboring workflow.
2. Identify the primary task, primary action, hierarchy, high-frequency data, and narrowest supported viewport.
3. Reuse or extend shared components and tokens. Do not introduce a competing local design system.
4. Implement relevant loading, empty, error/retry, disabled, busy, success, long-text, missing-value, and dense-data states.
5. Run typecheck and an H5 build. Review the focused diff and scan for duplicated patterns or accidental encoding changes.
6. Open the workflow in a real browser. Inspect the initial viewport and lower scroll content at a mobile width; check alignment, clipping, overflow, touch targets, focus, and console errors.
7. Iterate on visible defects before handoff. If browser verification is blocked, state that the visual gate remains unverified.

## Acceptance Checklist

- The workflow purpose and next action are immediately understandable.
- Type hierarchy clearly separates title, section, body, metadata, and status.
- Cards and sections align to a coherent grid and spacing rhythm.
- Equivalent buttons share height, radius, typography, icon gap, and state behavior.
- Long Chinese names, addresses, identifiers, and large numbers remain usable.
- Loading, empty, error, retry, disabled, and completion states look intentional.
- No new horizontal overflow or console errors appear at mobile width.
