Battery Inventory 0.6.0 - OpenBayes deployment helper

This separate deployment branch starts the frozen application source at
c563823e42832fda1873c9d9f75acb88c8ed2fd0.
It contains a public-source downloader and native-account runtime adapter.
It contains no credentials, database, dependencies or application source.

Restore the saved OpenBayes home containing releases/0.5.0 and data-v0.5.0.
The helper downloads the pinned public GitHub source and verified Node runtime,
builds the application on the server and upgrades a copy to data-v0.6.0.
The original database and release remain available. Existing accounts are
required; no administrator is created or reset.

The default maximum execution duration is two hours including setup.
INVENTORY_MANUAL_STOP=1 explicitly selects manual shutdown.
INVENTORY_PORT defaults to 8081. No scheduler or automatic restart is installed.

This is a portable Miniflare demonstration, not a high-availability service.
The frozen source branch and release tag are independent of this helper.

Deployment revision 2
The runtime is installed in releases/0.6.0-r2. A verified existing 0.6.0 source
build is reused without changing it; otherwise the pinned source is built.
Applied migration files are retained byte-for-byte in a deployment sidecar and
verified against the existing database receipts. The original 0000 CRLF bytes
are retained; only line-ending differences from frozen source are permitted.
The six new migrations remain byte-identical to frozen source. Database
receipts, old migration files and the frozen application release are not edited.

Use a distinct public mapping name when retrying a stopped execution. Previous
console attempts using retained names did not create a new job; the platform
did not confirm the cause. Use the address shown by the new running job.
