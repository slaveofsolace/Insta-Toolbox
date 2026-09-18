# Presence userscript integration

## Available in the development build

Presence is the primary account tab in the generated userscript. It has five
direct choices:

- View stories
- React to stories
- Like posts
- Follow people
- Accept incoming requests

One session has a finite maximum from 1 to 50. **Live like me** has a reviewed
30-minute to 12-hour window, a finite 500-action ceiling, and selected burst and
rest lengths. Start opens one review naming the verified signed-in account and
exact choices. Pause, Resume, and Stop operate on the same in-memory session.

The session controller processes one candidate at a time. Before each click it
rechecks the signed-in account, Instagram restriction signals, expiry, the
exact DOM target, and the current action choice. It stops on an uncertain
outcome and does not blindly retry that target.

Presence and Ghost use the same account-scoped Web Lock in the userscript.
Only one may hold that lane at a time, and the lock stays held until the active
operation settles. Starting the other tool while the lane is occupied is
rejected without a click. Each tool still requires its own review and action
authority.

The current native adapter supports exact visible controls for Instagram
navigation, post likes,
profile follows, incoming request confirmation, story links, and story likes.
A private-profile Follow may verify as Requested. Story reaction automatically
includes story viewing. This adapter does not collect credentials, call private
endpoints, bypass restrictions, or restore authority after a reload.

## Data boundary

- Selected activities and finite run choices are stored locally in
  `instaToolboxPresenceSessionV1`.
- Verified and non-success outcomes are copied to a bounded per-account local
  log. The separate log window is read-only except for Download and Clear and
  contains no action controls.
- Reviews and action authority exist only in the current runtime, are one-use,
  are account-bound, and expire within 15 minutes.
- Imported files, saved comparisons, and old Presence planner preferences
  cannot create action authority.
- Page freeze, pagehide, Stop, account change, session restriction, expiry, or
  an uncertain result prevents another dispatch.
- The generated userscript is rebuilt from repository source and loads no
  remote code.

## Evidence and remaining work

Focused controller and log tests cover finite scope, account binding, expiry,
replay rejection, uncertainty, Pause/Resume, Stop, and restrictions. Generated
userscript acceptance covers all five visible choices, Live like me controls,
native navigation, trusted confirmation
before the first click, exact post/follow/request/story postconditions,
cancellation, the separate log window, narrow and short layouts, light and dark
themes, and true 200% zoom.

Those checks use deterministic Instagram-shaped fixtures. They do not establish
current authenticated compatibility. Before release, verify each enabled
adapter against a specifically approved disposable target. The same-tab
account lane is implemented and fixture-tested. Ghost has a separate reviewed
userscript worker-tab coordinator, but Presence remains in its loaded tab.
Frozen, discarded, closed, or signed-out tabs must stop or require attention;
browser-closed operation is not available.
