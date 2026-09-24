# BambooHR Claude'is

[![CI](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mikkmihkel/bamboohr-mcp/actions/workflows/ci.yml)
[![Ainult lugemine](https://img.shields.io/badge/BambooHR-ainult%20lugemine-2ea44f)](#mida-tööriist-ei-näita)
[![Litsents: MIT](https://img.shields.io/badge/litsents-MIT-blue)](LICENSE)

<img src="assets/icon.svg" alt="" width="80" align="right">

In English: [README.md](README.md)

Küsi Claude'ilt BambooHR-i andmete kohta: kes on eemal, puhkusejäägid, töötajate andmed, koolitused ja pühad. **Ainult lugemine**: BambooHR-is ei looda, kinnitata ega muudeta midagi.

## Paigaldamine (Claude Desktop, 5 minutit)

1. **Loo API-võti.** BambooHR-is: pilt all vasakul → **API Keys** → **Add New Key**. Kopeeri võti kohe, seda näidatakse ainult korra. Hoia seda nagu parooli.
2. **Laadi alla** [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb).
3. **Tee failil topeltklõps.** Claude Desktop küsib:
   - **BambooHR subdomain**: `firma`, kui BambooHR avaneb aadressil `firma.bamboohr.com`
   - **BambooHR API key**: sammus 1 loodud võti
4. Vajuta **Install**, alusta uut vestlust ja küsi: *Kes on sel nädalal puhkusel?*

Node.js-i ega terminali pole vaja. Võti hoitakse operatsioonisüsteemi paroolihoidlas, mitte failis.
Topeltklõps ei tööta? **Settings → Extensions → Advanced settings → Install Extension** ja vali fail.
Võtme või aadressi muutmiseks: **Settings → Extensions → BambooHR → Configure**.

## Näidisküsimused

- *Kes on järgmisel nädalal eemal?*
- *Palju puhkust on Anna Tammel kasutamata?*
- *Kes arendusosakonnas pole sel aastal võtnud 14-päevast järjestikust puhkust?*
- *Millised oktoobri puhkusetaotlused ootavad kinnitamist?*
- *Millal Mart Mets tööle asus ja kes on tema juht?*
- *Tallinna kontori töötajate jalanumbrid.* (kohandatud väljad töötavad ka)
- *Kas Anna on esmaabikoolituse läbinud?*
- *Millised pühad on sel aastal veel ees?*

Küsi osakonna, kontori või inimese kaupa. Üks vastus hõlmab kuni 25 inimest; kui neid on rohkem, palub Claude küsimust kitsendada.

## Mida tööriist ei näita

Näed kõige rohkem seda, mida sinu BambooHR-i konto näeb, ja vähemgi:

- **Mitte kunagi:** töötasu, boonuseid, pangaandmeid, isikukoode, sünnikuupäeva, koduaadressi, sugu ja muid sarnaseid isikuandmeid.
- **Haigusleht** on näha ainult kui „puudub", ilma põhjuse ja märkusteta.
- **Ülalpeetavad ja töötaja dokumendid** on välja lülitatud, kui administraator neid ei luba.

Kui neid küsid, vastab Claude, et väli on reeglitega välistatud („excluded by policy"). See on taotluslik.

## Kui ei tööta

| Näed | Lahendus |
|---|---|
| „No BambooHR API key is available" | **Settings → Extensions → BambooHR → Configure**, täida võti ja alamdomeen. |
| „is not a bare BambooHR subdomain" | Kirjuta ainult `firma`, mitte `firma.bamboohr.com`. |
| Viga 401 | Võti on vale või tühistatud. Loo uus ja kleebi see **Configure**-aknasse. |
| Viga 403 või vastusest puuduvad inimesed | Sinu BambooHR-i konto ei näe neid andmeid. Räägi BambooHR-i administraatoriga. |
| „above the per-call limit" | Küsi väiksema rühma kohta: üks osakond, kontor või inimene. |
| Puhkuse liiki ei leita | Kirjuta täpne nimi (nt `Põhipuhkus`) väljale **Configure → Vacation time-off type**. |
| Paigaldatud, aga vastuseid ei tule | Sulge Claude Desktop täielikult ja ava uuesti. |

## Privaatsus

- Andmed liiguvad BambooHR-ist sinu arvutis olevasse laiendusse ja sealt Claude'i vestlusesse. BambooHR-i andmeid kettale ei salvestata.
- Kohalik auditilogi märgib, *milline* tööriist käivitati ja *milliseid* välju küsiti, aga mitte kunagi väärtusi ega nimesid. Logi ei saadeta kuhugi.
- Võti saadetakse ainult aadressile `https://<alamdomeen>.bamboohr.com`. Ainus teine päring on käivitamisel tehtav versioonikontroll, mis saadab ainult versiooninumbri.
- Kui võti lekib, kustuta see BambooHR-is jaotises **API Keys**. Tööriista eemaldamiseks: **Settings → Extensions → BambooHR → Uninstall**.

> **„Ainult lugemise" tagab see laiendus, mitte BambooHR.** API-võtmel on samad õigused kui kontol, millega see loodi. Kasuta võimalikult kitsaste õigustega kontot. Tarkvara antakse MIT-litsentsi alusel „nagu on", ilma garantii ja vastutuseta; oma organisatsiooni andmekaitsekohustuste eest vastutad sina.

## Administraatorile ja arendajale

Turvalahendus, seaded, käsurida, Claude Code, väljalaske kontrollimine ja arendus (inglise keeles): [docs/ADMIN.md](docs/ADMIN.md). Muudatused: [CHANGELOG.md](CHANGELOG.md).

## Litsents

MIT, vt [LICENSE](LICENSE).
