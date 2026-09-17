# Presence userscript integration

## Available in the development build

Presence is the primary account tab in the generated userscript. It has five
direct choices:

- View stories
- React to stories
- Like posts
- Follow people
- Accept incoming requests

The only numeric choice is a finite maximum from 1 to 50. Start opens one
review naming the verified signed-in account, selected activities, and maximum.
Pause, Resume, and Stop operate on the same in-memory session. Manual Follow /
Unfollow remains available in one secondary disclosure.

The session controller processes one candidate at a time. Before each click it
rechecks the signed-in account, Instagram restriction signals, expiry, the
exact DOM target, and the current action choice. It stops on an uncertain
outcome and does not blindly retry that target.

The current native adapter supports exact visible controls for post likes,
profile follows, incoming request confirmation, story links, and story likes.
A private-profile Follow may verify as Requested. Story reaction automatically
includes story viewing. This adapter does not collect credentials, call private
endpoints, bypass restrictions, or restore authority after a reload.

## Data boundary

- Selected activities and the maximum are stored locally in
  `instaToolboxPresenceSessionV1`.
- Reviews and action authority exist only in the current runtime, are one-use,
  are account-bound, and expire within 15 minutes.
- Imported files, saved comparisons, and old Presence planner preferences
  cannot create action authority.
- Page freeze, pagehide, Stop, account change, session restriction, expiry, or
  an uncertain result prevents another dispatch.
- The generated userscript is rebuilt from repository source and loads no
  remote code.

## Evidence and remaining work

Seven focused controller tests cover finite scope, account binding, expiry,
replay rejection, uncertainty, Pause/Resume, Stop, and restrictions. Generated
userscript acceptance covers all five visible choices, trusted confirmation
before the first click, exact post/follow/request/story postconditions,
cancellation, narrow and short layouts, light and dark themes, and true 200%
zoom.

Those checks use deterministic Instagram-shaped fixtures. They do not establish
current authenticated compatibility. Before release, verify each enabled
adapter against a specifically approved disposable target. Also connect the
existing trusted account-activity owner so Presence and Ghost cannot overlap,
then test account switches, stale documents, expiry, restart, lost
acknowledgments, and an inactive-but-loaded tab. Frozen, discarded, closed, or
signed-out tabs must stop or require attention; no browser-closed operation is
claimed.
