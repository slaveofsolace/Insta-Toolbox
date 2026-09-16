# Native Stay connected inputs

`extension/presence-native-inputs.js` prepares review inputs from the original Mutual Checker response, not from saved captures or imports. It makes no additional requests and performs no account actions.

## Runtime connection

Create one private `createPresenceNativeInputs({ fetchFollowerComparison, inspectViewer, now })` instance inside the trusted userscript closure. Bind the original inspector's `fetchFollowerComparison` and the native viewer's `inspect`; do not accept either dependency from page messages or stored configuration.

In `userscripts/src/toolbox-shell.js`, `checkAccountRelationships()` now calls `presenceInputs.captureComparison(...)`, retaining its existing progress, Stop, result-save and error handling. The wrapper returns the original result unchanged. It privately records a normalized snapshot in a WeakMap only when the same verified viewer is observed before and after the call, the requested and returned username match that viewer, and the response carries an observed numeric `subjectInstagramId` and current capture time.

After success, the original result reference stays only in the shell closure. The Stay connected panel calls `prepareProductionInputs({ capture: result, profile })`. Saved `state.capture` and serialized results are never substituted. Starting a new check, clearing the checker, navigation, pagehide, freeze, or retiring the duplicate shell invalidates the private receipt. Preparation and review also recheck the current viewer and expiry.

The current native viewer requires the visible DM account picker and corroborating navigation profile link. Profile-only pages do not supply that proof and therefore cannot create these inputs. Ordinary Mutual Checker still returns its result normally. This is an explicit layout limitation, not permission to treat any checked profile as the viewer.

## Evidence and limits

- The numeric account ID comes only from the same fresh checker response for the corroborated viewer username. The username-bound Ghost key is not converted into an ID.
- Followers present in that response are positive follow-back evidence, including when the follower list is partial.
- Missing from Following becomes `not-following` only when that list is complete and has no unresolved IDs. Otherwise the relationship remains unknown. Cross-list identity conflicts are omitted and reported.
- Current checker rows do not retain privacy fields. Privacy stays unknown. Default `skipPrivate` therefore holds those candidates; an explicit preference allowing private accounts can produce review suggestions, still requiring native inspection before execution.
- Missing or conflicting IDs are omitted. No usernames, synthetic IDs, or imported provenance are promoted to trusted identity.
- Candidate input is bounded to the planner's 2,000-row contract; truncation and omitted count are explicit. No full-inventory claim is made.
- Only Stay connected is supported. Topics and trusted managed follow history are not available for Find my people or Make room.

Every prepared result is `executable: false` and `live: false`. The WeakMap proves only that this adapter observed its trusted runtime call; it is not external-action authority. A caller that controls injected dependencies is outside that trust boundary. The existing batch review bridge, shared arbiter, fresh account/target resolution, and confirmation remain necessary before a production execution path can be enabled.

## Acceptance

`node --test tests/presence-native-inputs.test.js` covers original-object provenance, imports/clones, viewer changes, expiry, overlapping calls, cancellation, partial evidence, unknown privacy, conflicting IDs, and immutable snapshots. These are synthetic source tests, not current authenticated Instagram acceptance. Integration must still verify the exact runtime wrapper, supported visible viewer layout, account switching, and no extra network requests before marking native input collection usable in the product.
