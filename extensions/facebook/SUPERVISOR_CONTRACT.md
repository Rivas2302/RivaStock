# Facebook supervisor recovery protocol

The extension keeps form preparation deterministic. Supervision starts only after an eligible `one()`, `wait()`, `button()`, `combo()`, or `field()` lookup fails in a Marketplace, group-post, or group-sale preparation step. Existing-content conflicts, drafts with different content, account restrictions, permissions, destination checks, audience checks, CAPTCHA, and final-send validation remain hard stops.

## Request lifecycle

1. The content script records a `failed` trace step with the same DOM summary that it returns to the adapter. The service worker waits for the trace queue to persist that step and returns its `trace_id` and `seq`.
2. The adapter queries learned hints for the failed step. It retries the deterministic form action with only hints whose `step` and `intent_key` match. A hint must match role, accessible name, visible text, and nearby heading when those fields exist; duplicate matches are rejected.
3. If a hint does not resolve the step, the worker calls `facebook_supervision(request)` with that trace, sequence, intent, and exact stored DOM summary. It polls every 1.5 seconds for at most 90 seconds. The existing 20-second attempt heartbeat continues throughout the wait.
4. The adapter accepts at most three decisions per step and eight per attempt. Element decisions must target the single control named by the intent. The injected page recomputes and compares the entire DOM summary before applying the action. A changed DOM is not acted on; deterministic preparation is rerun to collect a fresh step.
5. The complete preparation action runs again. It is safe to resume because exact approved values are preserved, conflicting values are never overwritten, already selected options are recognized, and photos are attached only when the file list is empty or already matches exactly.
6. A success is recorded only after the original deterministic preparation checks pass. `report_outcome` stores the exact role/name/text match for future runs. A failed or stale decision is reported as unsuccessful and cannot become a positive learned hint.

## Actions and send boundary

The supervisor cannot authorize `checkpoint`, `validate_submit`, or the final `Publicar` click. The extension revalidates all form fields, photos, destination, and existing safety checks after a repair. The only automatic element action is scoped to the exact target for the current step; the page blocks publish/send controls even if a response passes the server validator.

`click`, `type`, `select_option`, `scroll_container`, and bounded `wait` can be applied when they target the active form and pass the shared contract. `type` must equal the approved expected value and may not overwrite a different value; `select_option` is limited to a native select with one exact option. `reload` is revalidated against the request DOM, reloads only the active preparation tab, and restarts the deterministic action from the approved payload; it never creates a learned hint by itself. `skip_destination` stops preparation and routes the delivery through the existing owner-review (`attention`) path without submitting or cancelling it automatically, because the worker API has no explicit skip outcome. This is a deliberate safe deviation from an automatic queue skip. `abort` preserves the current deterministic failure and adds the observation and trace ID when available.

If the Bridge is off, the request expires, the trace cannot be persisted, or the reply is invalid, preparation follows its previous failure path. No submission is authorized from the supervision protocol.
