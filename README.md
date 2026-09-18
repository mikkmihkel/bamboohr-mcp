# BambooHR MCP Server

[![MCP server](https://img.shields.io/badge/MCP-server-6f42c1)](https://modelcontextprotocol.io)
[![Claude Desktop extension](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20extension-d97757)](#quick-install-claude-desktop)
[![Read-only](https://img.shields.io/badge/BambooHR-read--only-2ea44f)](#how-access-works)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-vitest-729b1b)](#development)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Eesti keeles: [README.et.md](README.et.md)

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude answer questions from BambooHR. It covers time off (who is out, balances, requests, a company-wide vacation overview), employee fields including custom ones, employee tables including custom tables, bulk reports across the whole company, training types and records, dependents, employee file listings, user accounts, company holidays and recent record changes.

It never writes to BambooHR. Nothing is created, approved, adjusted or deleted. The one `POST` it makes is the custom-report endpoint, which only reads.

## Quick install (Claude Desktop)

No terminal, no Node.js. Claude Desktop ships its own runtime.

1. Download the extension file [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb).
2. Double-click it. Claude Desktop opens an install dialog. Click **Install**.
3. Fill in two fields:
   - **BambooHR API key**: in BambooHR click your photo (bottom left) > **API Keys** > **Add New Key**, name it `Claude`, copy the key.
   - **Company subdomain**: the first part of your BambooHR address. For `acme.bamboohr.com` enter `acme`.
4. Click **Save**, start a new chat and ask *"Who is out of office this week?"*

If double-clicking does nothing, use **Settings > Extensions > Advanced settings > Install Extension** and pick the file. On a Team or Enterprise plan an admin may first need to allow custom extensions. To update later, download the new file and install it again; your settings stay.

Developers who prefer a source checkout or Claude Code: see [Manual setup](#manual-setup).

## How access works

The server uses **your own BambooHR API key**. You see exactly what you can see in BambooHR itself. An HR administrator's key sees the whole company; an employee's key sees only themselves and possibly their direct reports. Results are silently limited by BambooHR, so an incomplete report usually means the key's access level, not a bug. Where a tool can tell, it says so: `missingFields` in the output of `bamboohr_get_employee` and `bamboohr_employee_report` lists the fields that came back empty or that the key could not see. The vacation overview and `bamboohr_list_employees` cover employees who appear in the published company directory, which is not always the full roster. If someone is missing, or a department filter returns nobody, check Settings > Company Directory sharing in BambooHR.

## Manual setup

For developers, or for Claude Code. HR users should use the [quick install](#quick-install-claude-desktop) above.

### 1. Create an API key

1. Log in to BambooHR.
2. Click your photo in the bottom-left corner and choose **API Keys**.
3. Click **Add New Key**, name it `Claude MCP`, and click **Generate Key**.
4. Copy the key now. It is shown only once.

### 2. Install

Requires Node.js 20 or newer.

```sh
git clone https://github.com/mikkmihkel/bamboohr-mcp.git
cd bamboohr-mcp
npm ci
npm run build
```

### 3. Add to Claude Desktop

Open **Settings > Developer > Edit Config** and add the server. Replace the path, key and subdomain.

```json
{
  "mcpServers": {
    "bamboohr": {
      "command": "node",
      "args": ["/absolute/path/to/bamboohr-mcp/dist/index.js"],
      "env": {
        "BAMBOOHR_TOKEN": "your-api-key",
        "BAMBOOHR_COMPANY_DOMAIN": "yourcompany",
        "BAMBOOHR_VACATION_TYPE": "Vacation"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the tools icon in the chat box.

### 3b. Or add to Claude Code

```sh
claude mcp add bamboohr -e BAMBOOHR_TOKEN=your-api-key -e BAMBOOHR_COMPANY_DOMAIN=yourcompany -- node /absolute/path/to/bamboohr-mcp/dist/index.js
```

### 4. Smoke test

Ask Claude: *"List the employee fields that contain 'shoe'."* You should get the field's name, alias and type back, or an empty list if your account has no such field. If you get a permissions error, check the key and its access level. If the vacation overview says it cannot identify the vacation type, ask *"List the time-off types"* and set `BAMBOOHR_VACATION_TYPE` to the right name. Also pick one employee who is on vacation today and compare their unplanned days with the balance shown in BambooHR. The tool assumes BambooHR deducts a request from the balance once it starts; if the numbers disagree by the remaining days of that vacation, report it so the calculation can be adjusted.

## Distributing to HR

Send HR users the link to the [latest release](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest) or the `.mcpb` file itself, plus the install guide. The dialog stores the API key in the operating system's credential store, not in a text file.

- Install guide for HR (Estonian): [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md)
- Rebuild the bundle after code changes: `npm run bundle`. Attach the result to a GitHub release so the download link above stays valid. It compiles, stages production dependencies under `.bundle/`, validates `manifest.json` and writes `release/bamboohr-mcp.mcpb`.
- Bump `version` in both `package.json` and `manifest.json` when you ship a new bundle so Claude Desktop shows the update.

## Example questions

The tool Claude reaches for is named in parentheses.

### Time off

- *Who is out next week?* (`bamboohr_whos_out`)
- *Show Anna Tamm's vacation balance.* (`bamboohr_list_employees` to find her id, then `bamboohr_time_off_balances`)
- *Which vacation requests are still waiting for approval in October?* (`bamboohr_time_off_requests` with status `requested`)
- *Who in Engineering has not taken a 14-day continuous vacation this year?* (`bamboohr_vacation_overview` with `department` and `onlyMissingFourteenDayBlock`)
- *How many unplanned vacation days does each employee still have as of today?* (`bamboohr_vacation_overview`)

### People data and custom fields

- *What is Anna Tamm's shoe size?* (`bamboohr_list_fields` with search `shoe` to find the alias, then `bamboohr_get_employee`)
- *When did Mart Mets start?* (`bamboohr_get_employee` with `hireDate`)
- *Shoe sizes of everyone in Tallinn for the winter boots order.* (`bamboohr_employee_report` with `location` and the custom shoe-size field)
- *Who has been with us more than 10 years?* (`bamboohr_employee_report` with `hireDate`)
- *Who has a work anniversary this month?* (`bamboohr_employee_report` with `hireDate`)

### Tables

- *Show Anna's job history.* (`bamboohr_table_rows` with table `jobInfo`)
- *List all laptops in the equipment table.* (`bamboohr_list_tables` to find the alias, then `bamboohr_table_rows` for all employees)

### Training

- *Which trainings are required?* (`bamboohr_training_types`)
- *Has Anna done first-aid training?* (`bamboohr_training_records`)

### Admin and audit

- *Which public holidays are left this year?* (`bamboohr_company_holidays`)
- *Who joined or left since 1 September?* (`bamboohr_changed_employees`)
- *Which BambooHR accounts are disabled?* (`bamboohr_list_users` with status `disabled`)
- *Which documents are on Anna's record?* (`bamboohr_employee_files`)
- *Which dependents are recorded for Anna?* (`bamboohr_employee_dependents`)

## Tools

### Time off

| Tool | What it does |
|---|---|
| `bamboohr_whos_out` | Employees out and holidays in a range. Default today + 14 days. |
| `bamboohr_list_employees` | Current employees with id, name, department, location, supervisor, email. |
| `bamboohr_list_time_off_types` | The company's time-off types and ids. |
| `bamboohr_time_off_balances` | All balances for one employee as of a date. |
| `bamboohr_time_off_requests` | Requests overlapping a range, with filters. |
| `bamboohr_vacation_overview` | Per-employee vacation report for a year with the 14-day check. |

### Employees and fields

| Tool | What it does |
|---|---|
| `bamboohr_list_fields` | Every employee field, standard and custom, with id, name, alias and type. `includeOptions` adds the values of list fields. |
| `bamboohr_list_tables` | Every employee table with its alias and columns, including custom tables. |
| `bamboohr_get_employee` | One employee's field values, plus `missingFields`. Omit `employeeId` for the key owner's own record. |
| `bamboohr_employee_report` | Chosen fields for every employee in one call. Always includes id, displayName and status. |
| `bamboohr_table_rows` | Rows of one table for one employee or for everyone. |
| `bamboohr_changed_employees` | Records inserted, updated or deleted since a timestamp, newest first. |

### People and company

| Tool | What it does |
|---|---|
| `bamboohr_training_types` | Training types and categories, with required, renewable and renewal frequency. |
| `bamboohr_training_records` | One employee's completed trainings with date, instructor, hours, credits and cost. |
| `bamboohr_employee_dependents` | Dependents for one employee or for everyone. Needs Benefits Administration permission. |
| `bamboohr_employee_files` | Document categories and file metadata on an employee's record. No downloads. |
| `bamboohr_list_users` | BambooHR login accounts with linked employee id, status and last login. |
| `bamboohr_company_holidays` | Company holidays overlapping a range. Default: the current calendar year. |

### How the vacation overview is calculated

- **Vacation type**: the `timeOffType` argument, else `BAMBOOHR_VACATION_TYPE`, else the one type named like "vacation", "annual leave" or "puhkus". If more than one time-off type looks like vacation, the tool refuses to guess and lists the candidates. Set `BAMBOOHR_VACATION_TYPE` to the right name.
- **Planned**: approved or requested vacation starting after the as-of date, within the year.
- **Unplanned**: balance as of the date minus planned. Negative means overbooked.
- **Blocks**: approved or requested vacation requests, clipped to the year, merged when adjacent or overlapping. Length is calendar days, end minus start plus one.
- **14-day rule**: true when any block is 14 calendar days or longer.
- **Year boundary**: blocks are measured per calendar year. A vacation from 25 December to 7 January counts as 7 days in each year, not 14.
- **Gaps**: only back-to-back or overlapping requests merge. Two Monday-to-Friday requests with a weekend between them count as two 5-day blocks. Book the whole period as one request to have it counted as one block.
- **Performance**: the overview makes one balance call per employee, five at a time, and retries once on rate limiting. For several hundred employees it can take a minute.

## Tips for good answers

- Ask for the field list first. Custom fields have aliases such as `customShoeSize`, and `bamboohr_list_fields` with a search word is the fastest way to find the right one before reading or reporting on it.
- The report excludes inactive people by default. `bamboohr_employee_report` drops employees whose status is not `Active` unless you ask for `includeInactive`.
- Table rows come back unsorted. Job history and other tables are returned in BambooHR's own order; sort by date when you want the latest row.
- The vacation overview is the slow one. In a company with several hundred employees it can take about a minute, because it asks BambooHR for one balance per employee.
- An empty answer is usually a permission. Check `missingFields` and the key's access level before assuming the data is absent.

## Privacy and data flow

- Data moves from BambooHR to the connector on your machine, and from there into your Claude conversation. Nothing is stored by the connector; there is no database, cache on disk or log of results. Metadata such as field and table names is kept in memory for ten minutes.
- What you paste into a chat is subject to your organisation's Claude plan and data policy. Employee data is personal data. Ask only what you need, and prefer aggregate questions over dumping whole records.
- The API key never leaves your machine except in requests to `https://<subdomain>.bamboohr.com`. Tools never accept a key or domain as an argument, so Claude cannot be talked into using someone else's.
- Revoke a key in BambooHR under **API Keys** if it leaks or when a person leaves.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `401` or "Check that BAMBOOHR_TOKEN is a valid API key" | The key is wrong or revoked. Create a new one and re-enter it in **Settings > Extensions > BambooHR > Configure**. |
| `403` or "access level does not allow this data" | Your BambooHR access level does not include that data. Ask a BambooHR administrator. |
| A field you know exists is listed in `missingFields` | Either the key may not see it or the name is off. Run `bamboohr_list_fields` with a search word and use the returned alias. |
| The vacation overview cannot identify the vacation type | More than one time-off type looks like vacation. Set **Vacation time-off type** in the extension settings to the exact name. |
| A department filter returns nobody | The directory is not shared for that department. Check **Settings > Company Directory** in BambooHR. |
| The overview is slow | One balance request per employee. A few hundred employees take about a minute. |

## Environment variables

See `.env.example`.

## Development

```sh
npm test          # unit and integration tests
npm run typecheck
npm run build
```

Source layout: `src/client.ts` (HTTP `get` and `post`), `src/bamboohr.ts` (endpoint wrappers), `src/fields.ts` (pure field helpers), `src/metaCache.ts` (10-minute metadata cache), `src/analysis.ts` (pure vacation maths), `src/overview.ts` (report orchestration), `src/server.ts` (registrar), `src/tools/shared.ts` (annotations and helpers), `src/tools/timeOff.ts`, `src/tools/meta.ts`, `src/tools/employees.ts`, `src/tools/people.ts` (tool definitions), `src/index.ts` (stdio bootstrap).

## License

MIT License, see `LICENSE`.
