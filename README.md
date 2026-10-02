# Battery Inventory 0.5.0 — OpenBayes deployment

Application source is pinned to `ddac6320daf36f677605667f329f031a10b1f813`. The source directory is the frozen application; deployment adds a native staff-authentication gateway and a pinned portable Linux runtime.

The bundle excludes credentials, bootstrap configuration and existing databases. Vendor license notices are retained. Native integration verification passed ten groups covering authentication, staff permissions, borrowing, export and restart persistence.

Run on the existing 2-core CPU service with an explicit manual-stop policy. The new database is stored under `/openbayes/home/battery-inventory/data-v0.5.0`; the earlier database directory is retained. The private launcher fetches this Git snapshot through a short-lived archive URL and verifies every part and the complete bundle. This deployment branch is not intended to merge into the application release.
