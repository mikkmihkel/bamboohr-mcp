# Changelog

## 4.1.0 (2026-09-22)

### Fixed

- **The connector never asked for the API key.** Installed as a Claude Desktop extension it had no way to obtain one: the manifest declared no `user_config`, so the install dialog asked for nothing and every tool answered with an enrolment command to paste into a terminal. Worse, that command could not work as printed — under Claude Desktop `process.execPath` is Claude's own Electron helper, which opens a window and ignores the script unless `ELECTRON_RUN_AS_NODE=1` is set. The manifest now declares the subdomain, the API key (as a `sensitive` field, so Claude Desktop keeps it in the OS credential store rather than in a config file) and an optional vacation type, and passes them to the server in the environment. The printed enrolment command now sets `ELECTRON_RUN_AS_NODE=1` when the runtime is not plain `node`.
- A missing or malformed subdomain no longer exits the process at start-up. Like a missing key, it now leaves the server running and reports itself on every tool call, instead of leaving Claude Desktop with a connector that failed to start.

### Changed

- `BAMBOOHR_API_KEY` is read at start-up, and only that name. A key supplied that way is copied into this machine's OS credential store on the first start, so one pass through the install dialog also enrols the `status`, `doctor` and `logs` commands. A key from the dialog takes precedence over a stored one, so changing it in Claude Desktop takes effect. Failure to write the store is a warning on stderr, never a failed start.
- A start-up that has a key writes the subdomain to `config.json`, so the command line reports the install the user actually has.
- An unsubstituted `${user_config.x}` placeholder is ignored rather than taken for a value.

## 4.0.1 (2026-09-22)

### Fixed

- The server did not answer Claude Desktop's `initialize` request: the bootstrap only ran when `require.main === module`, which is false under Claude Desktop's built-in Node runtime, so the process stayed idle until the client timed out. `main()` now always runs; the not-enrolled stand-in moved to its own module for tests. Version 4.0.0 is revoked.

## 4.0.0

Security hardening release. Upgrading from 3.x requires running `enroll` once; see the README.

### Breaking changes

- The API key is no longer read from the environment or from the Claude Desktop config. Run the one-time `enroll` command, which stores the key in the operating system credential store (macOS Keychain, Windows DPAPI, Linux Secret Service). The `.mcpb` bundle no longer asks for a key or subdomain in the install dialog.
- `bamboohr_get_employee` and `bamboohr_employee_report` accept only allow-listed fields. Pay, bank, tax, national id, date of birth, gender, home contact and similar fields are refused before any request is made.
- `bamboohr_table_rows` requires an employee id and refuses compensation, bonus, commission, bank and similar tables. `bamboohr_list_tables` hides them.
- `bamboohr_employee_report` requires `employeeIds` or a `department`, `location` or `division` filter. `bamboohr_list_employees` requires `search`, `department` or `location`. `bamboohr_vacation_overview` requires `department` or `employeeIds`.
- Every tool that returns personal data is capped at a configurable number of records per call (default 25). Results above the cap are rejected with instructions to narrow the query, never truncated silently.
- `bamboohr_employee_dependents` and `bamboohr_employee_files` are disabled unless `enroll --enable-sensitive-tools` is set.
- Sick-leave requests are reduced to a generic absence: the type reads `absent`, the type id and notes are removed. Sick-leave balances are omitted from `bamboohr_time_off_balances`.
- Tool results are wrapped in a labelled data envelope, and free-text fields from BambooHR are marked as untrusted text.

### Added

- `enroll`, `unenroll`, `status`, `logs`, `doctor` and `version` commands.
- Post-response scrub pass that removes blocked keys from every payload, including fields BambooHR may add later.
- Local JSON-lines audit log with owner-only permissions, 5 MiB rotation, five files, 90-day retention and HMAC-hashed employee ids. Never logs values, names or response bodies.
- Start-up self-check against a version revocation list (`revocations.json`); a revoked version refuses to start.
- Signed releases: the GitHub Actions release workflow builds the bundle, signs it with Sigstore and attaches SLSA build provenance and SHA-256 checksums. Third-party actions are pinned to commit SHAs.
- Plugin icon and use cases in the extension manifest.
- Optional explicit custom-field allow-list (`enroll --allow-custom-field`, `--no-custom-fields`), plus a field-type check that refuses currency, national id, bank and protected-characteristic types.

### Fixed after security review

- Blocked-name patterns were anchored and English-only; they are now unanchored and cover Estonian vocabulary (töötasu, palk, pangakonto, sünniaeg and others).
- Health-related time-off types could be selected by id; they are now hidden from the type list and refused as a filter, and reduced requests also drop the amount. Detection includes `töövõimetusleht`.
- `bamboohr_changed_employees` had no record cap.
- Envelope markers now carry a per-call nonce and look-alikes inside data are neutralised; error texts that can carry BambooHR content are enveloped too.
- The macOS enrolment passed the key on the `security` command line; it is now sent on standard input via `security -i`. Helper binaries are called by absolute path, PowerShell uses `-LiteralPath`.
- The bundler is an exact-pinned devDependency instead of an `npx` download, release permissions are job-scoped, source maps are fully stripped, and release binaries are no longer committed.
- Whitespace-only filters no longer satisfy the filter requirement; free-form parameters are validated and truncated before they reach the audit log; a non-https revocation URL is ignored.

## 3.0.0

Initial public release: read-only BambooHR MCP server with time off, employee fields and tables, reports, training, holidays and user accounts.
