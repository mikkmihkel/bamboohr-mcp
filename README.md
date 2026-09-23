# BambooHR for Claude

[![CI](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml)
[![Read-only](https://img.shields.io/badge/BambooHR-read--only-2ea44f)](#what-it-will-not-show)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<img src="assets/icon.svg" alt="" width="80" align="right">

Eesti keeles: [README.et.md](README.et.md)

Ask Claude about your BambooHR data: who is out, vacation balances, employee fields, training and holidays. **Read-only**: it never creates, approves or changes anything in BambooHR.

## Install (Claude Desktop, 5 minutes)

1. **Create an API key.** In BambooHR: your photo (bottom left) → **API Keys** → **Add New Key**. Copy it; it is shown once.
2. **Download** [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb).
3. **Double-click it.** Claude Desktop asks for:
   - **BambooHR subdomain**: `acme` if your BambooHR is at `acme.bamboohr.com`
   - **BambooHR API key**: the key from step 1
4. Click **Install**, start a new chat and ask: *Who is out this week?*

No Node.js, no terminal. The key is kept in your operating system's credential store, never in a file.
Double-click does nothing? **Settings → Extensions → Advanced settings → Install Extension** and pick the file.
To change the key or subdomain later: **Settings → Extensions → BambooHR → Configure**.

## Try asking

- *Who is out next week?*
- *How many vacation days does Anna Tamm have left?*
- *Who in Engineering has not taken a 14-day vacation this year?*
- *Which time-off requests in October are still waiting for approval?*
- *When did Mart Mets start, and who is their manager?*
- *Shoe sizes of everyone in the Tallinn office.* (custom fields work too)
- *Has Anna done first-aid training?*
- *Which public holidays are left this year?*

Ask per department, office or person. One answer covers at most 25 people; for more, Claude will ask you to narrow it down.

## What it will not show

You see at most what your own BambooHR account can see, and less:

- **Never:** salary, bonuses, bank details, national id numbers, date of birth, home address, gender and similar personal fields.
- **Sick leave** shows only as "absent", without reason or notes.
- **Dependents and employee documents** are off unless an administrator turns them on.

If you ask for any of these, Claude says the field is *excluded by policy*. That is intentional.

## Troubleshooting

| You see | Fix |
|---|---|
| "No BambooHR API key is available" | **Settings → Extensions → BambooHR → Configure**, fill in the key and subdomain. |
| "is not a bare BambooHR subdomain" | Enter only `acme`, not `acme.bamboohr.com`. |
| Error 401 | Wrong or revoked key. Create a new one and paste it in **Configure**. |
| Error 403, or people missing from answers | Your BambooHR account cannot see that data. Ask your BambooHR admin. |
| "above the per-call limit" | Ask about a smaller group: one department, office or person. |
| Vacation type not found | Put the exact name (e.g. `Vacation`) in **Configure → Vacation time-off type**. |
| Installed, but no answers | Quit Claude Desktop completely and reopen it. |

## Privacy and data flow

- Data goes from BambooHR to the extension on your computer, and from there into your Claude chat. No BambooHR data is stored on disk.
- A local audit log records *which* tool ran and *which* fields were asked for, never values or names. It is never sent anywhere.
- The key is only sent to `https://<subdomain>.bamboohr.com`. The only other request is a version check at start-up; it sends only the version number.
- If a key leaks, delete it in BambooHR under **API Keys**. To remove the extension: **Settings → Extensions → BambooHR → Uninstall**.

> **Read-only is enforced by this extension, not by BambooHR.** An API key has the same rights as the account that created it. Use an account with the narrowest access you need. Provided as is under the MIT licence, without warranty or liability; you are responsible for your organisation's data-protection obligations.

## For administrators and developers

Security design, settings, command line, Claude Code setup, release verification and development: [docs/ADMIN.md](docs/ADMIN.md). Report security issues as described in [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE).
