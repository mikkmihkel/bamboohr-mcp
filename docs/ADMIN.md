# Administrator and developer reference

User guide: [README.md](../README.md) · [README.et.md](../README.et.md)

## How access works

Each user runs the extension with **their own BambooHR API key**. A key inherits the access level of the account that created it: an HR admin key sees the company, an employee key sees only that employee (and perhaps direct reports). BambooHR trims results silently, so a short answer usually means access level, not a bug. `bamboohr_get_employee` and `bamboohr_employee_report` return `missingFields` (empty or not visible to the key) and `excludedFields` (refused by this tool's policy).

The server only calls read endpoints. The one `POST` is the custom-report endpoint, which reads. BambooHR does not offer read-only keys, so **the key can write if its account can**; any other program holding it could.

## Security design

Enforced in code and covered by tests.

| Measure | Code |
|---|---|
| **Key never in a file.** The install dialog takes it as a `sensitive` field; Claude Desktop keeps it in the OS credential store and passes it only in `BAMBOOHR_API_KEY`. On start the server copies it into the store under service `bamboohr-mcp`, account `api-key` (macOS Keychain, Windows DPAPI under `%LOCALAPPDATA%`, Linux Secret Service), so the CLI works too. Helpers get the key on stdin, by absolute path, without a shell. | `credentialStore.ts`, `config.ts` |
| **Field allow-list.** Standard fields: `id`, names, `jobTitle`, `department`, `division`, `location`, supervisor fields, hire/termination dates, status, work email/phones, `mobilePhone`, `employeeNumber`, `lastChanged`. Custom fields pass only if their BambooHR type is not money/id/bank/protected, and neither alias nor name matches a blocked pattern (English and Estonian). | `policy.ts` |
| **Compensation blocked.** Compensation, bonus, commission, bank, direct deposit and payroll tables are refused and hidden. Pay, SSN, national id and bank fields are excluded everywhere. | `policy.ts` |
| **Response scrub.** Every payload is walked and keys matching blocked patterns (pay, bank, tax, national id, date of birth, gender, nationality, medical, home address, emergency contact and more) are removed, including fields BambooHR adds later. | `policy.ts`, `tools/shared.ts` |
| **Sensitive tools off.** Dependents and files tools are not registered unless enabled. Sick leave is reduced to `absent`; health-related types are hidden and refused as filters; sick balances are omitted. | `tools/people.ts`, `tools/timeOff.ts` |
| **Bulk capped.** Default 25 records per call (1–500). Company-wide tools need an id or a filter. Over the cap the call is refused, never truncated silently. | `policy.ts` |
| **Audit log without values.** One JSON line per call: time, tool, field names, safe filters, count, outcome. Never values, names, search strings or bodies. Employee ids are HMAC-hashed with a local salt. Owner-only permissions, 5 MiB rotation × 5 files, 90-day retention, excluded from Time Machine/OneDrive. No network code. | `audit.ts`, `appPaths.ts` |
| **Untrusted text.** Results are wrapped in a nonce-marked data envelope; free-text fields are marked as untrusted, control characters stripped. | `policy.ts`, `tools/shared.ts` |
| **Supply chain.** Releases are built by GitHub Actions from `main`, signed with Sigstore, attested with SLSA provenance, published with SHA-256 sums. Actions pinned by SHA; no `npx` at build or run time. A revoked version refuses to start. | `.github/workflows/release.yml`, `selfCheck.ts` |

Out of scope: the server cannot see which Claude account is signed in (use SSO, domain capture and managed deployment), and the local log is not an audit-grade record (use BambooHR's own API logs).

## Settings

Stored in `config.json` in the data directory (`status` prints the path). Environment variables override. The key is never a setting.

| Setting | Env | Default | Meaning |
|---|---|---|---|
| `companyDomain` | `BAMBOOHR_COMPANY_DOMAIN` | required | `acme` for `acme.bamboohr.com` |
| `vacationType` | `BAMBOOHR_VACATION_TYPE` | auto | Time-off type counted as vacation |
| `maxRecords` | `BAMBOOHR_MAX_RECORDS` | `25` | Per-call cap, 1–500 |
| `enableSensitiveTools` | `BAMBOOHR_ENABLE_SENSITIVE_TOOLS` | `false` | Registers dependents and files tools |
| `allowedCustomFields` | `BAMBOOHR_ALLOWED_CUSTOM_FIELDS` | unset | Comma list: only these custom aliases. Empty: none |
| `revocationUrl` | `BAMBOOHR_REVOCATION_URL` | this repo | HTTPS URL of the revocation list |
| `strictSelfCheck` | `BAMBOOHR_STRICT_SELF_CHECK` | `false` | Refuse to start if the list is unreachable |
| data directory | `BAMBOOHR_MCP_DATA_DIR` | per OS | macOS `~/Library/Application Support/bamboohr-mcp`, Windows `%LOCALAPPDATA%\bamboohr-mcp`, Linux `~/.local/state/bamboohr-mcp` |

Name-based field checks are heuristics. Where it matters, pin an explicit list:

```sh
node dist/index.js enroll --allow-custom-field customShoeSize --allow-custom-field customEquipment
node dist/index.js enroll --no-custom-fields
```

## Command line

Needed only outside Claude Desktop or to inspect an install. From a checkout run `node dist/index.js <command>`; for an installed bundle use the exact command the "no key" error prints (under Claude Desktop it sets `ELECTRON_RUN_AS_NODE=1`).

| Command | Does |
|---|---|
| `enroll` | Asks for subdomain and key (no echo). Flags: `--subdomain`, `--vacation-type`, `--max-records`, `--enable-sensitive-tools`, `--allow-custom-field` (repeatable), `--no-custom-fields`, `--revocation-url`, `--strict-self-check`, `--key-stdin` |
| `unenroll` | Removes the key from the credential store |
| `status` | Key present (yes/no), backend, paths, settings |
| `logs [--tail N]` | Audit log path and last N entries |
| `doctor` | Checks enrolment and the version self-check |
| `version` | Prints the version |

Scripted rollout, key never on a command line: `printf %s "$KEY" | node dist/index.js enroll --subdomain acme --key-stdin`

## Claude Code or manual Claude Desktop config

Requires Node.js 20+.

```sh
git clone https://github.com/mikkmihkel/bamboohr-mcp.git && cd bamboohr-mcp
npm ci && npm run build
node dist/index.js enroll
claude mcp add bamboohr -- node "$PWD/dist/index.js"
```

For Claude Desktop without the bundle, add to **Settings → Developer → Edit Config** (no `env` needed after `enroll`):

```json
{ "mcpServers": { "bamboohr": { "command": "node", "args": ["/absolute/path/to/bamboohr-mcp/dist/index.js"] } } }
```

## Verifying a release

```sh
sha256sum -c SHA256SUMS
cosign verify-blob --bundle bamboohr-mcp.mcpb.sigstore.json \
  --certificate-identity-regexp '^https://github.com/mikkmihkel/bamboohr-mcp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  bamboohr-mcp.mcpb
gh attestation verify bamboohr-mcp.mcpb --repo mikkmihkel/bamboohr-mcp
```

## Version revocation list

At start-up the server fetches [`revocations.json`](../revocations.json) and refuses to run if its version is listed or below `minimumVersion`. Organisations can host their own copy and set `--revocation-url`. Unreachable list: warning only, unless `--strict-self-check`.

```json
{ "schemaVersion": 1, "minimumVersion": "4.0.1", "revokedVersions": ["4.0.0"], "message": "why" }
```

## Tools

| Tool | Returns |
|---|---|
| `bamboohr_whos_out` | Who is out and holidays in a range (default: next 14 days), no leave type |
| `bamboohr_list_employees` | Employees by `search`, `department` or `location` |
| `bamboohr_list_time_off_types` | Time-off types, health-related ones hidden |
| `bamboohr_time_off_balances` | One employee's balances on a date |
| `bamboohr_time_off_requests` | Requests in a range; sick leave as `absent` |
| `bamboohr_vacation_overview` | Planned/unplanned vacation and 14-day check for a department or ids |
| `bamboohr_list_fields` / `bamboohr_list_tables` | Field and table metadata, with policy status |
| `bamboohr_get_employee` | One employee's allowed fields (own record if no id) |
| `bamboohr_employee_report` | Allowed fields for ids, department, location or division |
| `bamboohr_table_rows` | One allowed table for one employee |
| `bamboohr_changed_employees` | Ids changed since a timestamp |
| `bamboohr_training_types` / `bamboohr_training_records` | Training catalogue; one employee's trainings |
| `bamboohr_list_users` | BambooHR login accounts, status, last login |
| `bamboohr_company_holidays` | Holidays in a range (default: this year) |
| `bamboohr_employee_dependents` / `bamboohr_employee_files` | Off by default; files are metadata only |

**Vacation overview maths.** Vacation type: argument, else setting, else the single type named like "vacation", "annual leave" or "puhkus" (ambiguous → refuses and lists candidates). *Planned* = approved or requested vacation after the as-of date within the year. *Unplanned* = balance minus planned. *Blocks* = requests merged when adjacent or overlapping, in calendar days, clipped per calendar year; a weekend gap splits a block. 14-day rule: any block ≥ 14 days.

## Known limitations

- BambooHR has no server-side department filter, so department/location/division queries fetch the company report into memory and filter locally. Only capped results reach the chat and nothing is written to disk. `employeeIds` filters are applied by BambooHR.
- Blocked-name patterns cannot know every company's vocabulary; use an explicit custom-field list.
- The revocation check fails open by default so laptops work offline.

## Development

```sh
npm ci
npm test && npm run typecheck
npm run bundle     # unsigned local .mcpb for testing (git-ignored)
```

Layout: `src/client.ts` HTTP, `src/bamboohr.ts` endpoints, `src/policy.ts` allow-list/scrub/caps, `src/audit.ts` log, `src/credentialStore.ts` key storage, `src/settings.ts` settings, `src/selfCheck.ts` revocation, `src/cli.ts` commands, `src/overview.ts` + `src/analysis.ts` vacation maths, `src/tools/*.ts` tools, `src/index.ts` start-up.

**Releasing.** Bump `version` in `package.json` and `manifest.json`, add a `CHANGELOG.md` section, merge to `main`, then push tag `vX.Y.Z` or run the **Release** workflow with the version. Commits not on `main` are refused.
