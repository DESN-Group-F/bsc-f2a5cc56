OpenBayes CPU demonstration

Scope
This adapter runs the existing production Worker bundle on a Linux CPU container.
It is a bounded demonstration, using Miniflare/workerd as a portable runtime.
It has not been assessed as a permanent, high-availability production deployment.
The existing hosted application and its database are independent of this adapter.

Account and access
The username is admin. Build preparation creates a random demonstration password.
Only its salted scrypt hash is uploaded; the plaintext stays in ignored work/.
The HTTP gateway issues HttpOnly, Secure, SameSite=Strict session cookies.
Incoming hosting identity headers cannot authenticate a client.
The administrator identity is stable across restarts of this deployment.
This demonstration account must not be used for real student or school data.

Build
Build the application with its existing dependency lock before preparing the bundle.
Run build-bundle.py with the local Node executable and the installed npm-cli.js path.
The builder installs the separately locked Linux runtime under work/openbayes/.
It downloads a Node 24 LTS binary from nodejs.org and verifies the vendor checksum.
It packages the built application, committed migrations, Linux dependencies and
the vendor runtime in a self-contained work/openbayes/deploy.py upload.
All dependency and runtime license notices are retained.
The source dependency catalog and root lockfile are unchanged.
Run verify.mjs with Node to verify access protection, writes and persistence locally.

Alternative transfer through the authorized private GitHub repository
When direct upload is slow, prepare-github-artifacts.py stages source and an offline
runtime under work/openbayes/github. Authentication files are excluded from Git.
The binary archive is split into 64 MiB parts below GitHub's 100 MiB file limit.
Push a separate deployment snapshot branch to DESN-Group-F/bsc-f2a5cc56.
prepare-github-link.py uses the existing local Git login only with GitHub's API.
It creates a private bootstrap containing a five-minute archive link and the demo
password hash. The GitHub account credential is never sent to OpenBayes.
Upload deploy-from-github.py promptly and use it in the same bounded task command.
The server verifies each artifact hash, reconstructs the bundle and starts it.

Account prerequisite and continuation
The inspected account displayed an unverified real-name status on 2026-10-01.
The platform documentation requires real-name verification for public port mapping.
The server started successfully, but its public browser workflow remains unverified.
The account holder must complete the platform's identity-verification flow personally.
After verification, bind the saved execution home directory and upload resume.py.
Use the bounded command:
timeout --signal=TERM --kill-after=20s 7200s python3 resume.py
The resume launcher requires the saved release, administrator configuration and
one saved inventory database with migration receipts. It will not silently replace
a missing or uninitialized database. Its preflight checks passed locally, but the
resume launcher has not yet been executed on OpenBayes.
Verify the actual public URL, sign-in and movement workflow after restarting.
See deployment-2026-10-01.json for the observed execution and billing results.

OpenBayes configuration
Create a separate container named DESN2000-battery-inventory.
Use the cpu resource (2 CPU cores, 4 GB RAM) billed at CNY 0.30 per hour.
Select the PyTorch 2.8-2204 CPU image and task submission mode.
Upload deploy.py; do not bind unrelated datasets, models or former projects.
Use this execution command:
timeout --signal=TERM --kill-after=20s 7200s python3 deploy.py
The container must expose its default port 8080 through the platform HTTPS API URL.
The application listens on 0.0.0.0:8080; the underlying Worker runtime is loopback-only.

Cost and lifecycle
This demonstration is authorized up to CNY 1, without topping up the account.
Two hours of CPU execution is approximately CNY 0.60 before any platform storage fees.
The shell timeout, Python supervisor and application timer all bound the execution.
The application must stop approximately two hours after task execution begins.
There is no automatic restart or recurring job.
Do not start another execution without checking the remaining authorized budget.

Database
The independent database is stored below /openbayes/home/battery-inventory/data/d1.
Migration names and SHA-256 hashes are tracked and committed with each migration.
Changed, already-applied migration files are rejected.
Runtime restart tests confirm record and audit-history persistence on local disk.
OpenBayes saves /openbayes/home after a task stops; that remote snapshot behavior
was observed in this execution's stopped-job file browser: the inventory SQLite
file was retained. Restoring that snapshot in another execution remains untested.
A future execution must bind or copy the saved home directory to retain its database.
The default dataset contains fictional batteries; the working dataset starts empty.
RFID ingestion and school identity integration remain outside this release.

References
https://openbayes.com/docs/gear/expose-service/
https://openbayes.com/docs/gear/output/
https://openbayes.com/docs/gear/storage-persistence/
