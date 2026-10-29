# FridgePolice

FridgePolice is a local-only roommate fridge prototype. It tracks household food, portion requests, owner approvals, consumption, spoilage, and physical inventory corrections. It uses browser local storage rather than a database or real authentication. The roommate selector is a demo identity switch, not an access-control boundary.

## What to try

Run `npm test` for the domain tests. To launch the UI, serve this folder from a local web server (for example, `python -m http.server 8000`) and open `http://localhost:8000`. The demo starts with a pizza at 25%, two separately identified ketchup bottles, pasta, and orange juice. Use **Reset demo** at any time to restore those examples.

## The four failure scenarios

1. **Concurrency collision:** a portion request immediately reserves its amount, before owner approval. Available quantity is calculated as physical stock minus active reservations. The synchronous state transition checks and creates the reservation as one operation, so a second request sees the reduced availability and cannot reserve the same final portion. The UI also renders each request against the item's unique ID.
2. **Spoilage and stale approvals:** pending and approved requests expire after 24 hours; overdue requests are swept when the app opens, every 30 seconds, and before state-changing operations. Owners can simulate that timeout for a quick demo. Marking an item spoiled expires all its open requests, releases reservations, and sets its physical stock to zero.
3. **Identical items:** every logged item receives its own immutable ID, shown on its card. Requests and inventory actions refer to that ID, not the item name, so same-name ketchup bottles remain separate.
4. **Reality desync:** the owner can correct an item's physical quantity, including to zero. Reconciliation expires open requests because their reservations can no longer be trusted against the corrected physical stock. The updated quantity and the correction are visible in inventory and the activity log.

## Other decisions

- Quantities are percentages from 0 to 100 to keep the prototype easy to demo. The value in the fridge includes reserved portions; available stock is shown separately.
- Only the owner can approve, decline, revoke, spoil, or reconcile their item. Only the approved requester can mark their portion consumed.
- Consuming a portion decreases the physical quantity. Declining, revoking, expiry, spoilage, and reconciliation release open reservations.
- State changes are applied to a copy, validated, and persisted before updating the UI. A failed operation is surfaced as an error instead of appearing successful.
- The app does not calculate payments; the assignment asks for fair portion tracking, and explicitly excludes real payment integration.

## Coverage

`tests/model.test.js` checks last-portion allocation, spoilage cleanup, same-name item identity, inventory reconciliation, timed expiry, requester-only consumption, and item creation validation.
