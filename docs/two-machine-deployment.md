# Two-machine deployment: License Server + Entity server

This is the map for a real rollout across two separate machines. See
`docs/license-server-deployment.md` for Machine B's own step-by-step, and
`docs/fresh-deployment.md` for Machine A's — this page just says which goes where and in
what order.

## Machine B — License Manager (the vendor's own server)

Installed **once**, ever — not per customer. Every Machine A talks to this same Machine B.

| Package | What it is |
|---|---|
| `packages/license-server` | Backend API |
| `packages/license-console` | Admin UI (now served *by* license-server itself, same origin) |
| SQL Server + `LicenseServerDb` | Its own database |

Build: `cd packages/license-server && npm run package` → `dist-installer/LicenseServerInstaller.zip`.
On Machine B: unzip, run `Setup.bat`, note the URL it prints.

## Machine A — Entity/customer server (one per customer)

| Package | What it is |
|---|---|
| `packages/server` | Backend API — the product itself |
| `packages/console` | Admin UI (served *by* packages/server itself, same origin) |
| SQL Server + `EndpointManagerDb` | This entity's own database |

Build: `cd packages/server && npm run package` → `dist-installer/EndpointManagerServerInstaller.zip`.
On Machine A: unzip, run `Setup.bat`.

## `packages/agent` — neither A nor B

Installs on each end-user endpoint being managed (not on A or B themselves, unless one of
them is also to be monitored as an endpoint). Build: `cd packages/agent && npm run package`.

## The actual order

1. **On Machine B**: run `Setup.bat`. Log in to its console. Create an `Entity` for the
   customer, issue a `LicenseKey` (agent cap, validity, and which modules they've
   purchased). Give the customer Machine B's URL and the key.
2. **On Machine A**: run `Setup.bat`. Log in to its console → Licensing → Licence API →
   enter Machine B's URL → Connect → enter the License Key from step 1 → Activate.
3. On Machine A's console (Endpoint Manager → Enrollment Tokens), download the agent
   installer once, create an enrollment token per batch of endpoints (optionally scoped
   to an asset group), download that token's setup script, and run both together on each
   endpoint — see `docs/fresh-deployment.md` step 6 for the full walkthrough.

Neither machine needs the other's source code or packages — B never runs
`packages/server`/`console`/`agent`, and A never runs `packages/license-server`/
`license-console`. The only connection between them is the HTTP calls Machine A makes to
Machine B's URL once the admin enters it (`/api/activate`, `/api/revalidate`,
`/api/unlock-request`).
