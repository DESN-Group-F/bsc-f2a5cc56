Battery Inventory 0.6.1 - OpenBayes application update

Application commit: 14e18151e52184b24d4b941f1057c78c34a88b09
Application branch: battery-staff-platform-v0.6.1
The version 0.6.0 frozen application remains unchanged. This deployment branch
contains only the public source downloader and native runtime adapter.
No credentials, databases, dependencies or application source are included.

Stop execution unectzwzehn3 and wait for its saved home to synchronize.
Continue from that latest saved /openbayes/home, retaining every directory.
Set INVENTORY_RESTORED_FROM_EXECUTION=unectzwzehn3 for the initial upgrade.
The helper copies current data-v0.6.0 into data-v0.6.1 after the new source
build succeeds. Never restore an older job or data-v0.5.0: those snapshots
predate the current staff accounts and later transactions.

All sixteen migration source files must remain identical to the previous
application. Applied migration sidecar bytes and receipts are preserved,
including the original 0000 CRLF bytes. No SQL migration or account bootstrap
runs. Typed hashes verify every existing database cell across the backup and
Worker startup. At least eight existing accounts and an active administrator
are required. The original database is retained. A completed new database is
reused on restart; newer records are never overwritten by copying old data.

The new release lives in releases/0.6.1. Source is downloaded from its fixed
public Git commit, checksum-verified and built on the server. Existing Linux
dependencies are reused only when the package catalog and lock match except
for the root version and all direct installed package versions are verified.
Otherwise npm ci installs the locked dependencies. The new application is
always rebuilt. Preserve prior releases and tools: runtime dependencies and
Node may be referenced from those saved directories.

INVENTORY_PORT defaults to 8081. INVENTORY_MANUAL_STOP=1 selects manual stop;
without it the entire execution is bounded to two hours including setup.
After this deployment, resume only from the latest execution holding
data-v0.6.1. Use the new public mapping address shown by that execution.
There is no automatic restart or high-availability guarantee.
