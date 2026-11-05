# Management console in a Teams tab (5 November 2026)

Deployment `2026-11-05-teams-embedding-1.0.0`. Application version remains 1.0.0. GitHub release `battery-inventory-v1.0.0-teams-20261105`.

## What changes for staff

- The management console (`/console`) can be opened inside a Microsoft Teams website tab and signed in there with the battery inventory account. It is not a UNSW sign-in; the sign-in page says so.
- The Teams tab and the browser sign in separately. Sign out of the tab from My account → Sign out.
- Inside Teams, a notice says that edits not yet confirmed stay with the tab and offers to open the console in the browser if a download does not start. If Teams does not keep the sign-in (some clients refuse the tab's cookie), the sign-in page says so and links to the browser.
- Nothing else changes: the console, the web application and the phone apps work as before.

## What does not change

Business rules, permissions, the 25 migrations, the schema and stored data. Ordinary browser sign-in keeps its existing session cookie. Every write still requires the exact same origin. No migration is appended; the update serves an independent verified copy of the current database and leaves the wrap-up data unchanged.

## Details

`docs/teams-pc-client.md` (Embedding in Teams) and `deploy/openbayes/2026-11-05-teams/README.md` (cutover, rollback and resume). Predecessor: `2026-11-05-web-console-wrapup-1.0.0` (`dcb1256`).

## Going back

`cutover.py revert` while nothing was written; afterwards `cutover.py rollback` serves the current data through the wrap-up application (tabs already signed in keep working; new tab sign-ins fail, the browser works), and `cutover.py restore` returns to this update.
