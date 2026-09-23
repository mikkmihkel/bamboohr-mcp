# Security policy

## Reporting a vulnerability

Please do not open a public issue. Use **Security → Report a vulnerability** on this repository's GitHub page to send a private report. Include the version (`version` command or the release name), what you did and what happened.

The maintainer aims to reply within a week. Confirmed issues are fixed in a new release, and affected versions are added to [`revocations.json`](revocations.json) so they stop serving data and tell the user to update.

## Supported versions

Only the latest release is supported. Versions listed in `revocations.json` stop serving data.

## Scope

How the extension protects data is described in [docs/ADMIN.md](docs/ADMIN.md#security-design). A BambooHR API key has the rights of the account that created it; limiting that account is outside this project's control.
