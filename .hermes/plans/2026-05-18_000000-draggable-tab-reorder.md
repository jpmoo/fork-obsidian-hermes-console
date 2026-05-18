# Draggable Hermes Console tab reorder plan

## Goal

Make Hermes Console tabs rearrangeable by drag-and-drop so a tab currently on the far left can be moved into the middle, and keep that order across Obsidian workspace saves/restores.

## Current context / assumptions

- Repo: `/Users/danny/dev/lean-obsidian-terminal`
- Product/package name: `obsidian-hermes-console`
- Main tab logic is in `src/terminal-tab-manager.ts`.
- Tab UI is rendered in `TerminalTabManager.renderTabBar()` around lines 1419-1519.
- There is already basic drag/drop code:
  - `dragSrcId` field exists.
  - `.terminal-tab` gets `draggable = true` when more than one visible tab exists.
  - `dragstart`, `dragover`, `dragleave`, `drop`, `dragend` handlers already splice `this.sessions`.
- Current gap likely causing the “can’t put one in middle” feel:
  - Drop always inserts at the target tab index, not before/after based on pointer position.
  - No drop zone exists after the last tab or around the `+` button.
  - It probably does not call `requestSaveLayout?.()` after reorder, so order may not persist reliably.
  - CSS uses one generic `.drag-over` style and for vertical tabs even shows a horizontal top line, which is not enough feedback.
- Session persistence already serializes visible sessions in array order via `serializeSessions()` in `src/terminal-tab-manager.ts`, so reordering `this.sessions` plus saving layout should preserve order.

## Proposed approach

Upgrade the existing drag/drop implementation instead of adding a new library.

Use native HTML5 drag events, but make insertion index explicit:

- Track dragged tab id.
- On `dragover` for each tab, calculate whether pointer is in the first or second half of the tab:
  - horizontal tabs: compare `event.clientX` to `rect.left + rect.width / 2`
  - vertical left/right tabs: compare `event.clientY` to `rect.top + rect.height / 2`
- Show directional insertion affordance:
  - `drag-over-before`
  - `drag-over-after`
- On drop, move source session to computed insertion index, adjusted after removing source.
- Call `renderTabBar()` and `requestSaveLayout?.()` after successful move.
- Add a drop target to the `+` button / tab bar tail so dragging to the end works.

## Step-by-step implementation

1. Add reorder helpers in `src/terminal-tab-manager.ts`

   Add small private helpers near existing tab methods:

   - `private getTabBarOrientation(): "horizontal" | "vertical"`
     - Use container classes or `this.tabBarEl.closest(".terminal-view-container")`.
     - Return `vertical` when container has `terminal-tabs-left` or `terminal-tabs-right`; otherwise `horizontal`.

   - `private getDropSide(event: DragEvent, tab: HTMLElement): "before" | "after"`
     - Use orientation to compare pointer against tab midpoint.

   - `private clearTabDragClasses(): void`
     - Remove `drag-over`, `drag-over-before`, `drag-over-after` from all tabs / tail target.

   - `private moveSessionBeforeOrAfter(sourceId: string, targetId: string, side: "before" | "after"): boolean`
     - Find `srcIndex` and `targetIndex` in `this.sessions`.
     - No-op if invalid or same id.
     - Remove source first.
     - Recompute target index after removal by id.
     - Insert at `targetIndex + (side === "after" ? 1 : 0)`.
     - Return true only if order changed.

   - `private moveSessionToEnd(sourceId: string): boolean`
     - For dropping after the final tab / onto the `+` button.

2. Replace inline drop logic in `renderTabBar()`

   Current code at lines 1475-1513 handles drag/drop inline.

   Replace with cleaner handlers:

   - `dragstart`
     - Set `this.dragSrcId = session.id`.
     - Add `dragging` class.
     - `e.dataTransfer.effectAllowed = "move"` if available.
     - `e.dataTransfer.setData("text/plain", session.id)` for browser compatibility.

   - `dragover`
     - `preventDefault()`.
     - If source exists and target differs:
       - compute side.
       - clear previous drag classes.
       - add `drag-over` plus side-specific class to target tab.
       - set `dropEffect = "move"`.

   - `drop`
     - `preventDefault()` and `stopPropagation()`.
     - Compute side again.
     - Call `moveSessionBeforeOrAfter(...)`.
     - If moved: `renderTabBar()` and `requestSaveLayout?.()`.

   - `dragend`
     - Null `dragSrcId`.
     - Clear classes.

3. Add end-of-row/drop-tail support

   Use the existing `terminal-new-tab` `+` button as the natural “drop after all tabs” target, but keep click-to-create behavior.

   In `renderTabBar()` after creating `addBtn`:

   - Add `dragover`:
     - if `dragSrcId`, `preventDefault`, add `drag-over-after` or a new `terminal-new-tab--drop-target` class.
   - Add `dragleave` / `dragend` cleanup.
   - Add `drop`:
     - if `dragSrcId`, prevent default, call `moveSessionToEnd`, render, request save.
     - if not dragging, leave existing click behavior untouched.

   This makes “move far-left tab to far-right / after last tab” possible without weird target precision.

4. Improve CSS insertion indicators in `styles.css`

   Around current `.drag-over` CSS at lines 469-473:

   - For horizontal tab bar:
     - `.terminal-tab.drag-over-before { box-shadow: inset 2px 0 0 var(--interactive-accent); }`
     - `.terminal-tab.drag-over-after { box-shadow: inset -2px 0 0 var(--interactive-accent); }`
   - For vertical left/right tab bars:
     - `.terminal-tabs-left .terminal-tab.drag-over-before, .terminal-tabs-right ... { box-shadow: inset 0 2px 0 var(--interactive-accent); }`
     - `.terminal-tabs-left .terminal-tab.drag-over-after, .terminal-tabs-right ... { box-shadow: inset 0 -2px 0 var(--interactive-accent); }`
   - Keep theme-native variables only.
   - Add subtle `opacity` or `background` for `.terminal-tab.dragging` if not already present.
   - Style `terminal-new-tab--drop-target` with a clear accent line/outline, not loud web-app color.

5. Persist reorder immediately

   In successful reorder paths call:

   - `this.requestSaveLayout?.();`

   This is important because `TerminalView.getState()` serializes current order into workspace state, but Obsidian only saves when asked / on periodic workspace save.

6. Add tests for reorder logic

   Current tests don’t instantiate `TerminalTabManager`; full xterm/PTY DOM setup may be heavy.

   Best low-balagan path:

   - Extract pure reorder helpers into new file:
     - `src/tab-order.ts`
   - Export:
     - `moveItemBeforeOrAfter<T extends { id: string }>(items, sourceId, targetId, side)` or immutable `reorderIds(...)` helper.
   - Unit test in `src/tab-order.test.ts`.

   Test cases:

   - move first tab after second: `[A,B,C] -> [B,A,C]`
   - move first tab after third: `[A,B,C] -> [B,C,A]`
   - move third tab before second: `[A,B,C] -> [A,C,B]`
   - drop same tab on itself: no-op
   - missing source/target: no-op
   - move to end from middle: `[A,B,C] -> [A,C,B]`
   - move already-last to end: no-op

   Then `TerminalTabManager` uses this helper, keeping tests fast and not coupled to Obsidian/xterm internals.

7. Manual QA in Obsidian

   After implementation/build:

   - Run `npm test`.
   - Run `npm run build`.
   - If installing into live vault, copy built `main.js`, `styles.css`, `manifest.json` into live plugin dir and reload plugin.
   - Open Hermes Console with at least 3 tabs: `A`, `B`, `C`.
   - Drag `A` between `B` and `C`; expected order: `B`, `A`, `C`.
   - Drag `A` after `C` using `+` button/tail; expected order: `B`, `C`, `A`.
   - Drag `C` before `B`; expected order changes correctly.
   - Test both horizontal tabs and configured left/right vertical tabs.
   - Switch active tabs after reorder; active terminal content stays attached to correct tab.
   - Restart Obsidian / reload workspace; tab order persists.
   - Confirm rename/color/edit buttons still work and dragging on close/edit controls does not accidentally close/edit.

## Files likely to change

- `src/terminal-tab-manager.ts`
  - Replace inline drag/drop splice logic with computed before/after reorder.
  - Add helper calls and layout save after reorder.

- `src/tab-order.ts` (new)
  - Pure reorder helper(s), if we choose testable extraction.

- `src/tab-order.test.ts` (new)
  - Unit coverage for reorder behavior.

- `styles.css`
  - Directional insertion indicators for horizontal and vertical tabs.
  - Tail drop target style.

## Tests / validation commands

From `/Users/danny/dev/lean-obsidian-terminal`:

```bash
npm test
npm run build
git diff --check
```

Optional live install verification after build:

```bash
# Find live plugin dir first; do not guess if multiple vaults exist.
# Then copy main.js, styles.css, manifest.json to that plugin dir and reload Obsidian plugin.
```

## Risks / tradeoffs

- Native HTML5 drag/drop inside Electron can be finicky when dragging from nested buttons/spans. Keep draggable on the tab container only and stop propagation on edit/close buttons.
- If `this.sessions` contains hidden/removed sessions, reordering the full array by visible ids must preserve hidden session objects. The helper should only move actual source/target sessions and not resurrect `removedFromTabs` sessions.
- The current code calls `this.getVisibleSessions()` repeatedly inside render loop; we can compute once for clarity, but avoid broad refactor.
- Touch/trackpad drag support is limited with native drag/drop. Fine for desktop Obsidian; don’t add pointer-event custom DnD unless native proves bad.
- Pinned tabs: current code allows pinned tabs to be dragged. Decide in implementation whether pinned means “not closeable” only or also “fixed position.” Existing behavior suggests only not closeable, so preserve draggable pinned tabs unless user says otherwise.

## Open questions

- Should pinned tabs be immovable? Default plan: no, pinned only prevents close.
- Should tab order be saved immediately to plugin settings too? Default plan: no, workspace state already owns per-view tab order; just call `requestSaveLayout?.()`.

## Acceptance criteria

- User can drag the leftmost tab into the middle of three tabs.
- User can drag any tab before/after any other visible tab with clear insertion feedback.
- User can drag a tab to the end using the tab bar tail / `+` area.
- Reordered tabs keep correct terminal sessions/content.
- Reordered order persists after Obsidian workspace reload.
- Tests and build pass.
