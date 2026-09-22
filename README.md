# BambooHR MCP Server

[![MCP server](https://img.shields.io/badge/MCP-server-6f42c1)](https://modelcontextprotocol.io)
[![Claude Desktop extension](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20extension-d97757)](#quick-install-claude-desktop)
[![Read-only](https://img.shields.io/badge/BambooHR-read--only-2ea44f)](#how-access-works)
[![Hardened](https://img.shields.io/badge/data-allow--listed%20%2B%20audited-1f6feb)](#security-hardening)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![CI](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="assets/icon.svg" alt="" width="96" align="right">

Eesti keeles: [README.et.md](README.et.md)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude answer questions from BambooHR: who is out, vacation balances and requests, a per-department vacation overview, allow-listed employee fields including custom ones, employee tables, small targeted reports, training, company holidays, user accounts and recent record changes.

It never writes to BambooHR. Nothing is created, approved, adjusted or deleted. The one `POST` it makes is the custom-report endpoint, which only reads.

> **Warning: read-only is enforced by this tool, not by BambooHR.**
> The server only ever calls read endpoints, checks every field against an allow-list and scrubs sensitive keys from every response. But a BambooHR API key inherits the full access level of the account that created it. If that account can write, the key can write, and any other program holding it could do so. Create the key on an account with the narrowest access level that answers your questions, revoke it when you stop using the tool, and treat the local machine as part of the trust boundary.
>
> This software is provided as is, under the MIT licence. The repository owner takes no responsibility for any use, use case, data exposure or consequence arising from running it. You are responsible for complying with your organisation's data-protection obligations and BambooHR's terms.

## Quick install (Claude Desktop)

No Node.js installation is needed. Claude Desktop ships its own runtime.

1. Download [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb) from the latest release. Optionally [verify the download](#verifying-a-release).
2. Double-click it. Claude Desktop opens an install dialog. Click **Install**. The dialog asks for nothing else: no key, no subdomain.
3. Start a new chat and ask *"Who is out of office this week?"*. The first answer is an error that contains the exact enrolment command for your machine, something like:

   ```
   No BambooHR API key is enrolled on this machine. Run:
   "/Applications/Claude.app/.../node" "/Users/you/Library/Application Support/Claude/Claude Extensions/.../dist/index.js" enroll
   ```

4. Open a terminal (macOS: Terminal, Windows: PowerShell), paste that command and press Enter. It asks for your company subdomain (`acme` for `acme.bamboohr.com`) and then for your API key, which is typed without echo and stored in the operating system credential store. In BambooHR the key is under your photo (bottom left) > **API Keys** > **Add New Key**.
5. Ask the question again.

If double-clicking does nothing, use **Settings > Extensions > Advanced settings > Install Extension** and pick the file. On a Team or Enterprise plan an admin may first need to allow custom extensions. To update later, install the new file; your enrolment stays.

Estonian install guide for HR users: [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md).

## How access works

The server uses **your own BambooHR API key**. You see at most what you can see in BambooHR itself, and less where this tool's policy is stricter. An HR administrator's key sees the whole company; an employee's key sees only themselves and possibly their direct reports. Results are silently limited by BambooHR, so an incomplete report usually means the key's access level, not a bug. Where a tool can tell, it says so: `missingFields` in the output of `bamboohr_get_employee` and `bamboohr_employee_report` lists fields that came back empty or that the key could not see, and `excludedFields` lists fields this tool refused by policy.

## Security hardening

Everything below is enforced in code and covered by tests. It is the reason 4.0 is a breaking release.

| # | Measure | Where |
|---|---|---|
| 1 | **No secrets in config.** The Claude Desktop config launches the binary with no `env` block. The API key is captured once by `enroll` and lives in the OS credential store: macOS Keychain (`security`), Windows DPAPI (current-user scope, file under `%LOCALAPPDATA%`), Linux Secret Service (`secret-tool`). The key is read from there at every start and is never accepted from an environment variable, a config file or a tool argument. During enrolment it is handed to the OS helper on standard input (`security -i`, PowerShell, `secret-tool`), never on a command line, and helpers are called by absolute path without a shell. Without a key every tool returns an error with the enrolment command. | `src/credentialStore.ts`, `src/config.ts`, `src/cli.ts` |
| 2 | **Field allow-list, not deny-list.** `bamboohr_get_employee` and `bamboohr_employee_report` accept only fields on an explicit set defined in code (name, job, department, division, location, supervisor, hire and termination dates, status, work contact, employee number). Custom fields, where company-specific salary or bank fields usually live, must pass three checks: the BambooHR field type is not a money, id, bank or protected-characteristic type; neither alias nor display name matches a blocked pattern (English and Estonian vocabulary, unanchored, so "Net pay", "Töötasu" or "Pangakonto" are caught); and, when the administrator has set an explicit list with `enroll --allow-custom-field`, the alias is on that list. `--no-custom-fields` refuses every custom field. Anything else is refused before the HTTP call with an "excluded by policy" message. | `src/policy.ts` |
| 3 | **Compensation blocked at the tool boundary.** `bamboohr_table_rows` refuses `compensation`, `bonus`, `commission`, bank, direct deposit, payroll and any custom table whose alias matches. `bamboohr_list_tables` does not list them. `payRate`, `payRateEffectiveDate`, `payType`, `payPer`, `payGroup`, `paidPer`, `ssn`, `nationalId`, bank fields and more are excluded everywhere. | `src/policy.ts`, `src/tools/employees.ts` |
| 4 | **Post-response scrub pass.** Before any payload is returned, the whole response object is walked and keys matching the blocked patterns (pay, salary, bonus, commission, wage, bank, IBAN, SWIFT, routing, account number, tax, SSN, national id, passport, date of birth, gender, marital status, ethnicity, nationality, citizenship, religion, disability, medical, home contact, address, emergency contact) are removed. It runs on every tool, including responses the allow-list already filtered, so fields BambooHR adds later do not leak by default. | `src/policy.ts`, `src/tools/shared.ts` |
| 5 | **High-sensitivity tools gated.** `bamboohr_employee_dependents` and `bamboohr_employee_files` are not registered unless enrolment sets `--enable-sensitive-tools`. Sick-leave requests are reduced to a generic `absent` entry with type id, amount and notes removed. Health-related time-off types are hidden from the type list and refused as a request filter, so they cannot be selected by id either. Sick-leave balances are omitted. Who's out never carried a leave type. Detection covers English and Estonian names, including `töövõimetusleht`. | `src/tools/people.ts`, `src/tools/timeOff.ts` |
| 6 | **Bulk retrieval capped.** Every tool that returns personal data enforces a per-call maximum (default 25, configurable 1 to 500). Tools that could dump the whole company require an explicit employee id or a filter: `bamboohr_employee_report` needs `employeeIds` or `department`, `location` or `division`; `bamboohr_list_employees` needs `search`, `department` or `location`; `bamboohr_vacation_overview` needs `department` or `employeeIds`; `bamboohr_table_rows` needs `employeeId`; `bamboohr_changed_employees` is capped and needs a well-formed `since`. Over the cap, the call is rejected with a hint, never truncated silently. | `src/policy.ts`, `src/tools/*.ts` |
| 7 | **Every call logged, values excluded.** Each call writes one JSON line: timestamp, tool, requested field names, safe filter parameters (dates, statuses, table alias, department), record count, number of scrubbed keys, outcome and error class. Field values, employee names, search strings, notes and response bodies are never written; free-form parameters are validated by pattern and truncated before logging. Employee ids are HMAC-SHA256 hashed with a random salt stored only on this machine. | `src/audit.ts` |
| 8 | **Local-only, bounded logging.** Logs go to a per-user app data directory with owner-only permissions (`0700`/`0600`, `icacls` on Windows), rotate at 5 MiB, keep five files and purge entries older than 90 days at start-up. The logging module has no network code. The directory carries a `CACHEDIR.TAG` and `.nosync` marker and is excluded from Time Machine on macOS; on Windows it lives under `%LOCALAPPDATA%`, which OneDrive does not sync. `logs` prints the path and tails recent entries. | `src/audit.ts`, `src/appPaths.ts` |
| 9 | **All BambooHR text treated as untrusted.** Every result, and every error that can carry BambooHR text, is wrapped in a labelled envelope that tells the model the content is data, not instructions. The envelope markers carry a per-call random nonce, and any marker look-alike inside the data is neutralised, so a note cannot close the envelope early. Free-text fields (notes, job titles, descriptions, file names, comments) are additionally wrapped in `[UNTRUSTED TEXT FROM BAMBOOHR ...]` markers, and control characters are stripped. | `src/policy.ts`, `src/tools/shared.ts` |
| 10 | **Supply chain pinned.** Releases are built by GitHub Actions from a version tag, signed with Sigstore (keyless, bound to this repository), attested with SLSA build provenance and published with SHA-256 checksums. Third-party actions are pinned to commit SHAs, the bundler is an exact-pinned devDependency resolved from the lockfile, and the release job's write permissions are job-scoped. The bundle is invoked by absolute path from a fixed install directory; there is no `npx` at build or run time. Release binaries are not committed to the repository; they exist only as signed release assets. At start-up the server fetches a version revocation list and refuses to run if its version is revoked. | `.github/workflows/release.yml`, `src/selfCheck.ts` |

Out of scope for the server: it cannot verify which Claude account is logged in. That is handled by domain capture, enforced SSO and managed deployment. Audit-grade monitoring relies on BambooHR-side per-user API logs, not on the local log file.

### What the allow-list contains

Standard fields: `id`, `displayName`, `firstName`, `lastName`, `preferredName`, `jobTitle`, `department`, `division`, `location`, `supervisor`, `supervisorId`, `supervisorEId`, `supervisorEmail`, `hireDate`, `originalHireDate`, `terminationDate`, `status`, `employmentHistoryStatus`, `workEmail`, `workPhone`, `workPhoneExtension`, `mobilePhone`, `employeeNumber`, `lastChanged`. The home-address fields `address1`, `city`, `state`, `zipcode` and `country` are excluded because they describe where a person lives; use `location` for the office. Custom fields: any alias starting with `custom` whose BambooHR type is not blocked (`currency`, `ssn`, `sin`, `nin`, `gender`, `marital_status`, pay types and similar) and whose alias and display name do not match a blocked pattern, so `customShoeSize` passes and `customBonusPct`, `customNetPay` or a field named "Töötasu" do not. Because a name-based check can never be complete, organisations should prefer the explicit list: `enroll --allow-custom-field customShoeSize --allow-custom-field customEquipment` admits only those aliases, and `--no-custom-fields` admits none. To change the standard list or the patterns, edit `ALLOWED_STANDARD_FIELDS`, `BLOCKED_FIELD_TYPES` and `BLOCKED_KEY_PATTERNS` in `src/policy.ts` and rebuild; there is deliberately no runtime switch for those.

### Commands

Run these with the same `node` and `index.js` path that the enrolment error prints, or with `node dist/index.js` from a source checkout.

| Command | What it does |
|---|---|
| `enroll` | Interactive one-time set-up. Asks for the subdomain and the API key (no echo). Options: `--subdomain <name>`, `--vacation-type <name>`, `--max-records <1-500>`, `--enable-sensitive-tools` / `--disable-sensitive-tools`, `--revocation-url <https url>`, `--strict-self-check` / `--no-strict-self-check`, `--allow-custom-field <alias>` (repeatable; restricts custom fields to this list), `--no-custom-fields`, `--key-stdin` (read the key from standard input for scripted rollout; the key is never accepted as an argument). |
| `unenroll` | Removes the key from the credential store. Settings stay. |
| `status` | Backend in use, whether a key is enrolled (yes or no, never the key), paths and settings. |
| `logs [--tail N]` | Prints the audit log directory and the last N entries (default 50). |
| `doctor` | Checks enrolment and runs the version self-check without connecting. |
| `version` | Prints the version. |

### Settings

Non-secret settings live in `config.json` in the app data directory and are written by `enroll`. Environment variables override them for developers; none of them can carry the API key.

| Setting | Env override | Default | Meaning |
|---|---|---|---|
| `companyDomain` | `BAMBOOHR_COMPANY_DOMAIN` | required | Bare subdomain, `acme` for `acme.bamboohr.com`. |
| `vacationType` | `BAMBOOHR_VACATION_TYPE` | auto | Name or id of the time-off type that counts as vacation. |
| `maxRecords` | `BAMBOOHR_MAX_RECORDS` | `25` | Per-call record cap, 1 to 500. |
| `enableSensitiveTools` | `BAMBOOHR_ENABLE_SENSITIVE_TOOLS` | `false` | Registers the dependents and files tools. |
| `allowedCustomFields` | `BAMBOOHR_ALLOWED_CUSTOM_FIELDS` (comma-separated) | unset | When set, only these custom-field aliases may be read. Empty list: no custom fields at all. Unset: type and name checks decide. |
| `revocationUrl` | `BAMBOOHR_REVOCATION_URL` | this repo's `revocations.json` | HTTPS endpoint of the version revocation list. Point it at an internal endpoint. |
| `strictSelfCheck` | `BAMBOOHR_STRICT_SELF_CHECK` | `false` | Refuse to start when the revocation list is unreachable. |
| data directory | `BAMBOOHR_MCP_DATA_DIR` | per OS | Overrides where `config.json`, the audit salt and logs live. |

Default locations: macOS `~/Library/Application Support/bamboohr-mcp` with logs in `~/Library/Logs/bamboohr-mcp`; Windows `%LOCALAPPDATA%\bamboohr-mcp` with logs in its `logs` subfolder; Linux `~/.local/state/bamboohr-mcp` (or `$XDG_STATE_HOME`) with logs in its `logs` subfolder. `status` prints the exact paths.

### Verifying a release

Every release carries `SHA256SUMS`, Sigstore bundles and a build-provenance attestation.

```sh
sha256sum -c SHA256SUMS
cosign verify-blob --bundle bamboohr-mcp.mcpb.sigstore.json \
  --certificate-identity-regexp '^https://github.com/mikkmihkel/bamboohr-mcp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  bamboohr-mcp.mcpb
gh attestation verify bamboohr-mcp.mcpb --repo mikkmihkel/bamboohr-mcp
```

### Version revocation list

`revocations.json` at the repository root is the default list. Organisations deploying internally should host their own copy on an internal HTTPS endpoint and set `--revocation-url` at enrolment, so a compromised or withdrawn version can be stopped on every machine at the next start. Format:

```json
{ "schemaVersion": 1, "minimumVersion": "4.0.0", "revokedVersions": ["3.0.0"], "message": "why" }
```

By default an unreachable list only prints a warning, so laptops work offline. `--strict-self-check` makes it refuse to start instead.

### Known limitations

- **Department filters still fetch the whole report.** BambooHR has no server-side department, location or division filter, so `bamboohr_employee_report` with such a filter and `bamboohr_vacation_overview` fetch the company-wide report or directory into process memory and narrow it locally before the cap is applied. Nothing beyond the cap reaches the conversation and nothing is written to disk, but the data does transit the machine. `employeeIds` filters are applied by BambooHR server-side and avoid this.
- **Name-based checks are heuristics.** The blocked-pattern list catches common English and Estonian names for sensitive fields; it cannot know every company's vocabulary. Set an explicit custom-field list at enrolment where that matters.
- **The revocation check fails open by default** so laptops work offline. Turn on `--strict-self-check` in managed deployments.
- **The server cannot see who is logged in to Claude.** See the note above on domain capture and SSO.

## Manual setup

For developers, or for Claude Code. Requires Node.js 20 or newer.

```sh
git clone https://github.com/mikkmihkel/bamboohr-mcp.git
cd bamboohr-mcp
npm ci
npm run build
node dist/index.js enroll          # asks for subdomain and key
node dist/index.js status
```

Add the server to Claude Desktop under **Settings > Developer > Edit Config**. Note the absence of an `env` block.

```json
{
  "mcpServers": {
    "bamboohr": {
      "command": "node",
      "args": ["/absolute/path/to/bamboohr-mcp/dist/index.js"]
    }
  }
}
```

Or to Claude Code:

```sh
claude mcp add bamboohr -- node /absolute/path/to/bamboohr-mcp/dist/index.js
```

Smoke test: ask Claude *"List the employee fields that contain 'shoe'."* You should get the field's name, alias and type back, or an empty list. Ask *"Who is out this week?"* to confirm the key works. If the vacation overview says it cannot identify the vacation type, ask *"List the time-off types"* and re-run `enroll --vacation-type "<name>"`.

## Distributing to HR

Send HR users the link to the [latest release](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest) plus the install guide. Each user enrols their own key; nothing is shared.

- Install guide for HR (Estonian): [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md)
- Scripted rollout: `echo "$KEY" | node dist/index.js enroll --subdomain acme --key-stdin` reads the key from standard input so it never appears in a command line or shell history.
- Releases are cut from `main` only: merge the change, then either tag `vX.Y.Z` on `main` and push the tag, or run the **Release** workflow manually on `main` with the version as input (it creates the tag). The workflow refuses any commit that `main` does not contain, checks that the version matches `package.json` and `manifest.json`, and builds, signs and publishes the bundle. `npm run bundle` builds an unsigned copy locally for testing; it is git-ignored on purpose.

## Example questions

The tool Claude reaches for is named in parentheses.

### Time off

- *Who is out next week?* (`bamboohr_whos_out`)
- *Show Anna Tamm's vacation balance.* (`bamboohr_list_employees` with `search`, then `bamboohr_time_off_balances`)
- *Which vacation requests are still waiting for approval in October?* (`bamboohr_time_off_requests` with status `requested`)
- *Who in Engineering has not taken a 14-day continuous vacation this year?* (`bamboohr_vacation_overview` with `department` and `onlyMissingFourteenDayBlock`)

### People data and custom fields

- *What is Anna Tamm's shoe size?* (`bamboohr_list_fields` with search `shoe`, then `bamboohr_get_employee`)
- *When did Mart Mets start?* (`bamboohr_get_employee` with `hireDate`)
- *Shoe sizes of everyone in the Tallinn office for the winter boots order.* (`bamboohr_employee_report` with `location` and the custom field)
- *Who in Sales has a work anniversary this month?* (`bamboohr_employee_report` with `department` and `hireDate`)

### Tables, training, admin

- *Show Anna's job history.* (`bamboohr_table_rows` with table `jobInfo` and her id)
- *Which trainings are required?* (`bamboohr_training_types`)
- *Has Anna done first-aid training?* (`bamboohr_training_records`)
- *Which public holidays are left this year?* (`bamboohr_company_holidays`)
- *Whose record changed since 1 September?* (`bamboohr_changed_employees`)
- *Which BambooHR accounts are disabled?* (`bamboohr_list_users` with status `disabled`)

## Tools

### Time off

| Tool | What it does |
|---|---|
| `bamboohr_whos_out` | Employees out and holidays in a range. Default today + 14 days. No leave type. Capped. |
| `bamboohr_list_employees` | Current employees matching `search`, `department` or `location`, with id, name, job, department, location, supervisor, work email. One filter required. Capped. |
| `bamboohr_list_time_off_types` | The company's time-off types and ids, without health-related types. |
| `bamboohr_time_off_balances` | Balances for one employee as of a date. Sick-leave types omitted. |
| `bamboohr_time_off_requests` | Requests overlapping a range, with filters. Sick leave shown as `absent` without type, amount or notes; a health-related type filter is refused. Capped. |
| `bamboohr_vacation_overview` | Per-employee vacation report for a year for one department or a list of ids, with the 14-day check. Capped. |

### Employees and fields

| Tool | What it does |
|---|---|
| `bamboohr_list_fields` | Every employee field with id, name, alias and type, and whether this tool allows it. `includeOptions` adds list values. |
| `bamboohr_list_tables` | Employee tables with alias and columns. Compensation-type tables are hidden. |
| `bamboohr_get_employee` | One employee's allow-listed field values, plus `missingFields` and `excludedFields`. Omit `employeeId` for the key owner's own record. |
| `bamboohr_employee_report` | Allow-listed fields for employees selected by `employeeIds`, `department`, `location` or `division`. Always includes id, displayName and status. Capped. |
| `bamboohr_table_rows` | Rows of one allowed table for one employee. |
| `bamboohr_changed_employees` | Employee ids inserted, updated or deleted since a timestamp, newest first. Capped. |

### People and company

| Tool | What it does |
|---|---|
| `bamboohr_training_types` | Training types and categories, with required, renewable and renewal frequency. |
| `bamboohr_training_records` | One employee's completed trainings. |
| `bamboohr_employee_dependents` | Dependents for one employee. Disabled by default. |
| `bamboohr_employee_files` | Document categories and file metadata on an employee's record. No downloads. Disabled by default. |
| `bamboohr_list_users` | BambooHR login accounts with linked employee id, status and last login. Capped. |
| `bamboohr_company_holidays` | Company holidays overlapping a range. Default: the current calendar year. |

### How the vacation overview is calculated

- **Vacation type**: the `timeOffType` argument, else the `vacationType` setting, else the one type named like "vacation", "annual leave" or "puhkus". If more than one type looks like vacation, the tool refuses to guess and lists the candidates.
- **Planned**: approved or requested vacation starting after the as-of date, within the year.
- **Unplanned**: balance as of the date minus planned. Negative means overbooked.
- **Blocks**: approved or requested vacation requests, clipped to the year, merged when adjacent or overlapping. Length is calendar days, end minus start plus one.
- **14-day rule**: true when any block is 14 calendar days or longer.
- **Year boundary**: blocks are measured per calendar year. A vacation from 25 December to 7 January counts as 7 days in each year.
- **Gaps**: only back-to-back or overlapping requests merge. Two Monday-to-Friday requests with a weekend between them count as two 5-day blocks.
- **Performance**: one balance call per employee, five at a time, one retry on rate limiting.

## Tips for good answers

- Ask for the field list first. Custom fields have aliases such as `customShoeSize`, and `bamboohr_list_fields` with a search word is the fastest way to find the right one and to see whether policy allows it.
- Narrow before you ask. Every people tool needs a department, location, search word or list of ids, and returns at most the configured cap. Ask per department rather than for the whole company.
- The report excludes inactive people by default unless you ask for `includeInactive`.
- Table rows come back unsorted. Sort by date when you want the latest row.
- An empty answer is usually a permission. Check `missingFields`, `excludedFields` and the key's access level before assuming the data is absent.

## Privacy and data flow

- Data moves from BambooHR to the connector on your machine, and from there into your Claude conversation. The connector stores no BambooHR data: there is no database or cache on disk. Field and table metadata is kept in memory for ten minutes. The audit log holds metadata about calls, never values or names.
- What you paste into a chat is subject to your organisation's Claude plan and data policy. Employee data is personal data. Ask only what you need, and prefer aggregate questions over dumping whole records.
- The API key never leaves your machine except in requests to `https://<subdomain>.bamboohr.com`. It is read from the OS credential store, never from a file or an argument, so Claude cannot be talked into using someone else's.
- The only other network call is the start-up fetch of the revocation list, which sends the version number and nothing else.
- Revoke a key in BambooHR under **API Keys** if it leaks or when a person leaves, and run `unenroll` on the machine.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "No BambooHR API key is enrolled on this machine" | Run the `enroll` command shown in the message. |
| `401` or "Check that the enrolled API key is valid" | The key is wrong or revoked. Create a new one and run `enroll` again. |
| `403` or "access level does not allow this data" | Your BambooHR access level does not include that data. Ask a BambooHR administrator. |
| "excluded by policy" | The field or table is outside the allow-list. This is intentional; see [What the allow-list contains](#what-the-allow-list-contains). |
| "above the per-call limit" | Narrow the query with a department, location, search word, shorter date range or list of ids, or raise `maxRecords` at enrolment. |
| "requires employeeIds or a filter" | Add a department, location, division, search word or list of ids. |
| A field you know exists is listed in `missingFields` | Either the key may not see it or the name is off. Run `bamboohr_list_fields` with a search word and use the returned alias. |
| "This version has been revoked" | Install the latest release. |
| The vacation overview cannot identify the vacation type | Run `enroll --vacation-type "<exact name>"`. |
| `secret-tool` not found (Linux) | Install `libsecret-tools` and make sure a Secret Service (GNOME Keyring, KWallet) is running. |

## Development

```sh
npm test          # unit and integration tests
npm run typecheck
npm run build
npm run bundle    # local .mcpb + SHA256SUMS
```

Source layout: `src/client.ts` (HTTP `get` and `post`), `src/bamboohr.ts` (endpoint wrappers), `src/policy.ts` (allow-list, blocked patterns, scrub, sick-type reduction, untrusted-text wrapping, caps), `src/audit.ts` (local audit log), `src/credentialStore.ts` (OS credential store backends), `src/settings.ts` and `src/appPaths.ts` (non-secret settings and per-OS paths), `src/selfCheck.ts` (version revocation check), `src/cli.ts` (commands), `src/fields.ts`, `src/metaCache.ts`, `src/analysis.ts`, `src/overview.ts` (vacation maths and report), `src/server.ts` (registrar), `src/tools/*.ts` (tool definitions), `src/index.ts` (bootstrap).

Working with Claude Code on this repository: the hardening in 4.0 was planned and reviewed with a frontier model, while the individual modules were implemented by smaller-model subagents working from a written spec with strict file ownership, then integrated and reviewed. This split keeps the security-relevant decisions in one place and the implementation reproducible.

## License

MIT License, see `LICENSE`.
