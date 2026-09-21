# Changelog

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

## 3.0.0

Initial public release: read-only BambooHR MCP server with time off, employee fields and tables, reports, training, holidays and user accounts.
