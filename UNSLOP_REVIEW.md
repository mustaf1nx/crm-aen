# AEN CRM — Unslop review, 12 November 2026

Applied the user-provided **unslop** skill by **Damir Sokolovsky ([@heydamir](https://x.com/heydamir))**, [source](https://github.com/heydamir/unslop), licensed under **CC BY 4.0**. This review and the design treatment adapt its workflow; the skill was read directly from the supplied local folder, not installed globally.

## Audit and direction

The previous screen had oversized colored navigation, widely tracked uppercase labels, repeated rounded metric cards, many unrelated text tints, decorative channel badges and promotional copy. Those competed with customer messages and made the funnel take more vertical space.

- Product: a clothing retailer's shared sales and conversation desk across three cities.
- Character: calm, practical, precise.
- World: a store counter and clothing labels; pale neutral surfaces and graphite text.
- Moments: unread customer messages and actual product media, with semantic colors for stages.
- Signature: a quiet city label and deal number on each card, connecting the shared inbox to the physical stores.

## Passes

1. **Spacing:** compact 36px desktop navigation, consistent 8/12/16/24px spacing in primary controls and cards; kept comfortable mobile targets.
2. **Color:** neutral sidebar, canvas and lanes; one restrained green action color. Stage dots still express distinct states.
3. **Icons:** existing Lucide icons, common stroke; replaced the text gear in filters and removed decorative check/block/dot symbols from card labels.
4. **Copy:** clothing/store context replaces marketing slogans; sentence-case section labels and shorter empty-state text.
5. **Type:** local Segoe UI/system stack, mostly 400/500 weights, tabular numbers; no downloaded font dependency.
6. **Layout:** compact metric strip replaces three separate cards. Preserved section order, wide chat and secondary details panel.
7. **Details:** quieter borders and counters, consistent controls, visible keyboard focus, useful city labels.
8. **Visuals:** actual customer media remains the content focus; no decorative/generated images or fake analytics added.
9. **Motion:** restrained color/border transitions; retained opaque pointer dragging, lane highlighting, Escape cancellation and edge scrolling.

## Refusal interaction

Dropping a deal into Refusal previews that stage immediately and opens a focused reason dialog. No second stage selection is required. A blank or whitespace-only reason cannot submit. Stage and reason are persisted together by the existing stage endpoint. Cancel/Escape restores the previous position without a server mutation. A failed save keeps the entered reason for retry. The stage endpoint already independently rejects empty refusal reasons.

## Validation

Production TypeScript/Vite build and Playwright scenario passed. The browser scenario checks actual pointer movement, one opaque moving card, normal click-to-chat, Escape, rollback after an HTTP failure, refusal cancellation, blank-reason prevention, failed-save retry and successful stage/reason persistence. Existing message, attachment, unread, filter and mobile-layout checks also passed. Desktop board, chat and mobile screenshots were inspected using mock customer data; no real messages were sent by these tests.

The change does not implement stock management, new integrations or a full design-system rewrite. Existing backend and provider behavior remain outside this UI-focused change.
