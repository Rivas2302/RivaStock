# Facebook supervisor decision contract

The supervisor is an advisory recovery mechanism. It can only return one decision from the closed menu below. The extension validates every decision again immediately before applying it; the SQL validator and AI Bridge validator use the same rules.

## Decision object

```json
{
  "action": "click",
  "element_index": 12,
  "confidence": 0.92,
  "observation": "El formulario muestra el campo Categoría.",
  "reason": "La intención del paso pide seleccionar una categoría."
}
```

Allowed actions are `click`, `type`, `select_option`, `scroll_container`, `wait`, `reload`, `skip_destination`, and `abort`. `confidence`, `observation`, and `reason` are required for every decision. Confidence must be between `0.6` and `1`; observation and reason are each at most 300 characters. Unknown properties are rejected.

`element_index` is required for `click`, `type`, `select_option`, and `scroll_container`. It must identify an enabled control in the request's `dom_summary.controls` list, and the summary scope must be the active dialog or form. `type` and `select_option` also require `text` of at most 200 characters. `wait` requires `wait_ms` from 500 through 10000. These conditional properties are rejected on other actions.

For `type` and `select_option`, the request's `intent.target` must contain the exact `element_index`, `role`, and accessible `name` of the field designated by the failed deterministic step. The selected control must still match all three values. Text is never typed into a field based on the model's guess alone.

## Prohibited actions

- Clicking controls that publish, send, or share the final content, including “Publicar”, “Compartir ahora”, “Publish”, and “Share now”.
- Logging out or opening account settings.
- Interacting outside the active dialog or form.
- Typing or selecting a value in a field other than the exact field identified by `intent.target`.

The extension rejects these actions locally even if a server-side validation bug accepts them. A rejected or low-confidence decision is not executed and counts as a failed attempt.

## DOM summary

The extension sends `{ scope, controls, headings, alerts }`. `scope` is `dialog`, `form`, or `page`; page summaries are informational and cannot be used for element actions. Each control has a stable index within that one summary, a role, accessible name, visible text, state, and bounds. Element indices are not reusable after the DOM changes; the extension must rebuild the summary and request a new decision.

## Validation agreement

The SQL validator runs when the worker submits an answer, the Bridge validator runs before its answer RPC, and the extension validator runs immediately before execution. All three reject malformed objects, out-of-range indices, disabled controls, prohibited names, actions outside an active form/dialog, field actions without an exact intent target, confidence below `0.6`, and conditional fields used with the wrong action.
