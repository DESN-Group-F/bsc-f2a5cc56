# Mobile Inventory and Mapping implementation

12 October 2026. This is local implementation evidence for the dedicated phone Inventory view. No publication, deployment or production-data change was performed.

## Integration

`InventoryScreen` accepts the authoritative shared snapshot, account and dataset; fixed owner, holder, room or group scope; detail, reviewed-operation, export, edit and group callbacks; and an optional `active` flag. The parent owns business operations, dedicated battery details, server calls and durable workflow recovery. This screen never commits a movement or captures a location.

The list reuses `shared/lib/inventory-query.js` for filtering, sorting, pagination counts and export scope. It keeps presentation state in memory per account, dataset and fixed view. Selection survives ordinary criteria and page changes; leaving the fixed boundary produces a visible warning and blocks operations and exports until the selection is cleared. Personal exports retain authenticated owner/holder boundaries. Group exports include the current own active group version. Export `pageSize` uses the shared string contract.

Opening New arrivals clears ordinary criteria, shows all active loan states ordered by registration time descending, and retains selections. The parent acknowledges the captured server cursor. Removing the Applied criterion does not acknowledge arrivals. Recent totals and Newly registered row badges use the server's 48-hour projection; unread indicators use its unread count and item flags independently, without inferring unread status from the creator.

Normal row taps open details; selection-mode row taps toggle selection. The checkbox and independent detail action remain keyboard accessible. A selection review routes eligible checkout, check-in and retirement requests to the parent reviewed workflow. No action here is an immediate-save path. Operation batches are limited to 100; complete download selections are not truncated to the visible page.

The parent must give the inventory container a definite height for internal list scrolling. Pass `active=false` while hidden behind other areas, details or a workflow. Device-local view memory is presentation continuity only; it does not establish process-restart recovery or cross-device synchronization.

## Mapping

Mapping uses a custom WebGL volume renderer with shaded room boxes, orthographic orbit camera, two-pointer pinch/pan, ray-box room picking, reset controls and optional selective background blur. The geometry is an explicitly labeled schematic arrangement derived from selectable directory rooms. It is not surveyed, has no battery coordinates, and does not infer observations from registered storage.

Counts and room-list boundaries reuse `mappingBucket` and the server's latest observation projection. Unknown covers missing/unusable observations and rooms outside the supported map. Saved observation labels, times and sources remain separate from current directory labels. Invalid observation times are shown as unavailable. Placeholder rooms remain identified as placeholders.

The selected scene has a crisp foreground. After blur compositing, the renderer reconstructs background depth before drawing the selected room; visible foreground occlusion and nearest-volume picking therefore use coherent depth. A direct searchable room list and room summaries work independently of gestures, and the room-list fallback remains available if WebGL is unavailable. Room-scoped list views have independent filter, selection, page and scroll memory.

Selection feedback uses a compact fixed summary above the phone navigation, so the room name, recorded counts, Close and View details remain visible without scrolling. Recent saved evidence is an expandable section in the ordinary Mapping content. Selection still does not open the complete room list automatically.

Rendering is requested after input or scene changes rather than running a continuous idle loop. Hidden/document-background scenes cancel rendering and focus transitions. Reduced motion suppresses focus animation and blur. Simpler effects removes the extra blur/depth pass. Canvas density is capped at 1.5 device pixels per CSS pixel. GPU resources are disposed on unmount.

## Actual checks and limits

`node --test tests/mobile-mapping-model.test.mjs tests/mobile-mapping-geometry.test.mjs` passed 12 tests. They cover personal/group/room export bounds, Unknown/latest-observation semantics, all-page counts, sort order with unknown values last, fixed-scope presentation memory, New arrivals criteria normalization without clearing selections, movement eligibility, projection/picking, low-angle overlap and controlled WebGL depth-command ordering. JSX transpilation syntax checks passed for both phone components.

These are logic and controlled rendering checks. They are not measured phone frame rate, real multi-touch acceptance, native GPU pixel validation or staff-efficiency evidence. The 60 fps hardware target, large text, actual room picking and device blur cost still require the coordinating browser/device review. The implementation agent did not start a build or preview server; build and visual review belong to the coordinating integration pass.
