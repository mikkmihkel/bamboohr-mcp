# BambooHR-i MCP-server

[![MCP server](https://img.shields.io/badge/MCP-server-6f42c1)](https://modelcontextprotocol.io)
[![Claude Desktop extension](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20laiendus-d97757)](#kiirpaigaldus-claude-desktop)
[![Read-only](https://img.shields.io/badge/BambooHR-ainult%20lugemine-2ea44f)](#kuidas-ligipääs-töötab)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/litsents-MIT-blue)](LICENSE)

In English: [README.md](README.md)

Ainult lugemiseks mõeldud [Model Context Protocol](https://modelcontextprotocol.io) server, mille abil Claude vastab küsimustele BambooHR-i andmete põhjal. See katab puhkused (kes on eemal, puhkusejäägid, taotlused, kogu ettevõtte puhkuseülevaade), töötajate väljad koos kohandatud väljadega, töötajate tabelid koos kohandatud tabelitega, kogu ettevõtet hõlmavad koondaruanded, koolituste liigid ja läbitud koolitused, ülalpeetavad, töötaja dokumentide loetelu, kasutajakontod, ettevõtte pühad ja hiljutised muudatused.

BambooHR-i andmeid ei muudeta kunagi. Midagi ei looda, ei kinnitata, ei parandata ega kustutata. Ainus `POST`-päring on kohandatud aruande küsimine, mis samuti ainult loeb.

## Kiirpaigaldus (Claude Desktop)

Terminali ega Node.js-i ei ole vaja. Claude Desktopil on oma käituskeskkond kaasas.

1. Laadi alla laienduse fail [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb).
2. Tee failil topeltklõps. Claude Desktop avab paigaldusakna. Vajuta **Install**.
3. Täida kaks välja:
   - **BambooHR API key**: BambooHR-is klõpsa oma profiilipildil (all vasakul) > **API Keys** > **Add New Key**, pane nimeks `Claude` ja kopeeri võti.
   - **Company subdomain**: sinu BambooHR-i aadressi esimene osa. Kui aadress on `firma.bamboohr.com`, kirjuta `firma`.
4. Vajuta **Save**, alusta uut vestlust ja küsi: *„Kes on sel nädalal puhkusel?"*

Kui topeltklõps ei tee midagi, vali **Settings > Extensions > Advanced settings > Install Extension** ja näita fail ette. Teami või Enterprise'i paketi puhul võib olla vaja, et administraator kohandatud laiendused eelnevalt lubab. Uuendamiseks laadi alla uus fail ja paigalda see uuesti, seaded jäävad alles.

Arendajad, kes eelistavad lähtekoodi või Claude Code'i, leiavad juhised peatükist [Käsitsi seadistamine](#käsitsi-seadistamine).

## Kuidas ligipääs töötab

Server kasutab **sinu enda BambooHR-i API-võtit**. Näed täpselt sama, mida näed BambooHR-is. Personaliadministraatori võti näeb kogu ettevõtet, tavatöötaja võti ainult tema enda andmeid ja võimalusel ka otseste alluvate andmeid. BambooHR piirab vastuseid märkamatult: kui aruanne on poolik, on põhjus enamasti võtme õigustes, mitte veas. Kui tööriist saab seda tuvastada, annab ta sellest teada: `bamboohr_get_employee` ja `bamboohr_employee_report` väljundis loetleb `missingFields` väljad, mis tulid tühjana või mida võtme õigused ei luba näha. Puhkuseülevaade ja `bamboohr_list_employees` hõlmavad töötajaid, kes on avaldatud ettevõtte kataloogis, ja see ei ole alati täielik nimekiri. Kui keegi puudub või osakonnafilter ei leia kedagi, kontrolli BambooHR-is seadet **Settings > Company Directory**.

## Käsitsi seadistamine

Arendajatele ja Claude Code'i kasutajatele. Personalitöötajad kasutagu [kiirpaigaldust](#kiirpaigaldus-claude-desktop).

### 1. Loo API-võti

1. Logi BambooHR-i sisse.
2. Klõpsa oma profiilipildil all vasakus nurgas ja vali **API Keys**.
3. Vajuta **Add New Key**, pane nimeks `Claude MCP` ja vajuta **Generate Key**.
4. Kopeeri võti kohe. Seda näidatakse ainult üks kord.

### 2. Paigalda

Vajalik on Node.js 20 või uuem.

```sh
git clone https://github.com/mikkmihkel/bamboohr-mcp.git
cd bamboohr-mcp
npm ci
npm run build
```

### 3. Lisa Claude Desktopi

Ava **Settings > Developer > Edit Config** ja lisa server. Asenda failitee, API-võti ja ettevõtte aadress.

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

Käivita Claude Desktop uuesti. Tööriistad ilmuvad vestlusakna tööriistaikooni alla.

### 3b. Või lisa Claude Code'i

```sh
claude mcp add bamboohr -e BAMBOOHR_TOKEN=your-api-key -e BAMBOOHR_COMPANY_DOMAIN=yourcompany -- node /absolute/path/to/bamboohr-mcp/dist/index.js
```

### 4. Proovi järele

Küsi Claude'ilt: *„Näita töötajate välju, mille nimes on 'shoe'."* Vastuseks peaksid saama välja nime, aliase ja tüübi või tühja nimekirja, kui sellist välja sinu kontol ei ole. Kui saad õiguste veateate, kontrolli võtit ja selle õiguste taset. Kui puhkuseülevaade ütleb, et ei suuda puhkuse liiki tuvastada, küsi *„Näita puhkuse liike"* ja määra `BAMBOOHR_VACATION_TYPE` väärtuseks õige nimi. Vali ka üks täna puhkusel olev töötaja ja võrdle tema planeerimata päevi BambooHR-is näidatava jäägiga. Tööriist eeldab, et BambooHR arvab taotluse jäägist maha puhkuse algamisel. Kui numbrid erinevad täpselt selle puhkuse järelejäänud päevade võrra, anna teada, et arvutust saaks parandada.

## Paketi jagamine personalile

Saada personalitöötajatele link [viimasele väljalaskele](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest) või `.mcpb`-fail koos paigaldusjuhendiga. Paigaldusaken hoiab API-võtit operatsioonisüsteemi paroolihoidlas, mitte tekstifailis.

- Paigaldusjuhend personalile: [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md)
- Ehita pakett pärast koodimuudatusi uuesti: `npm run bundle`. See kompileerib koodi, paigutab kausta `.bundle/` ainult tööks vajalikud sõltuvused, valideerib `manifest.json`-i ja kirjutab faili `release/bamboohr-mcp.mcpb`. Lisa tulemus GitHubi väljalaskele, et allalaadimislink toimiks.
- Uue paketi väljaandmisel tõsta versiooninumbrit nii `package.json`-is kui `manifest.json`-is, et Claude Desktop uuendust pakuks.

## Näidisküsimused

Sulgudes on tööriist, mida Claude vastamiseks kasutab.

### Puhkused

- *Kes on järgmisel nädalal eemal?* (`bamboohr_whos_out`)
- *Näita Anna Tamme puhkusejääki.* (`bamboohr_list_employees` id leidmiseks, seejärel `bamboohr_time_off_balances`)
- *Millised puhkusetaotlused ootavad oktoobris veel kinnitamist?* (`bamboohr_time_off_requests` staatusega `requested`)
- *Kes arendusosakonnas ei ole sel aastal võtnud 14-päevast järjestikust puhkust?* (`bamboohr_vacation_overview` argumentidega `department` ja `onlyMissingFourteenDayBlock`)
- *Mitu planeerimata puhkusepäeva on igal töötajal tänase seisuga alles?* (`bamboohr_vacation_overview`)

### Töötajate andmed ja kohandatud väljad

- *Mis on Anna Tamme jalanumber?* (`bamboohr_list_fields` otsisõnaga `shoe`, et leida alias, seejärel `bamboohr_get_employee`)
- *Millal Mart Mets tööle asus?* (`bamboohr_get_employee` väljaga `hireDate`)
- *Kõigi Tallinna töötajate jalanumbrid talvesaabaste tellimiseks.* (`bamboohr_employee_report` väljaga `location` ja kohandatud jalanumbri väljaga)
- *Kes on meil töötanud üle 10 aasta?* (`bamboohr_employee_report` väljaga `hireDate`)
- *Kellel on sel kuul tööjuubel?* (`bamboohr_employee_report` väljaga `hireDate`)

### Tabelid

- *Näita Anna ametikäiku.* (`bamboohr_table_rows` tabeliga `jobInfo`)
- *Loetle kõik sülearvutid töövahendite tabelist.* (`bamboohr_list_tables` aliase leidmiseks, seejärel `bamboohr_table_rows` kõigi töötajate kohta)

### Koolitused

- *Millised koolitused on kohustuslikud?* (`bamboohr_training_types`)
- *Kas Anna on esmaabikoolituse läbinud?* (`bamboohr_training_records`)

### Haldus ja audit

- *Millised pühad on sel aastal veel ees?* (`bamboohr_company_holidays`)
- *Kes on alates 1. septembrist liitunud või lahkunud?* (`bamboohr_changed_employees`)
- *Millised BambooHR-i kasutajakontod on välja lülitatud?* (`bamboohr_list_users` staatusega `disabled`)
- *Millised dokumendid on Anna töötajakaardil?* (`bamboohr_employee_files`)
- *Millised ülalpeetavad on Annal kirjas?* (`bamboohr_employee_dependents`)

## Tööriistad

### Puhkused

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_whos_out` | Valitud ajavahemikus eemal olevad töötajad ja pühad. Vaikimisi tänasest 14 päeva edasi. |
| `bamboohr_list_employees` | Praegused töötajad koos id, nime, osakonna, asukoha, juhi ja e-posti aadressiga. |
| `bamboohr_list_time_off_types` | Ettevõtte puudumiste liigid ja nende id-d. |
| `bamboohr_time_off_balances` | Ühe töötaja kõik puhkusejäägid valitud kuupäeva seisuga. |
| `bamboohr_time_off_requests` | Ajavahemikuga kattuvad taotlused, filtreeritavad töötaja, staatuse ja liigi järgi. |
| `bamboohr_vacation_overview` | Aasta puhkusearuanne iga töötaja kohta koos 14 päeva kontrolliga. |

### Töötajad ja väljad

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_list_fields` | Kõik töötajaväljad, nii standardsed kui kohandatud, koos id, nime, aliase ja tüübiga. `includeOptions` lisab valikuväljade lubatud väärtused. |
| `bamboohr_list_tables` | Kõik töötajate tabelid koos aliase ja veergudega, sealhulgas kohandatud tabelid. |
| `bamboohr_get_employee` | Ühe töötaja väljade väärtused ja `missingFields`. Jäta `employeeId` ära, et lugeda võtme omaniku enda andmeid. |
| `bamboohr_employee_report` | Valitud väljad kõigi töötajate kohta ühe päringuga. Sisaldab alati välju id, displayName ja status. |
| `bamboohr_table_rows` | Ühe tabeli read ühe töötaja või kõigi töötajate kohta. |
| `bamboohr_changed_employees` | Pärast antud ajahetke lisatud, muudetud või kustutatud töötajakaardid, uusimad ees. |

### Inimesed ja ettevõte

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_training_types` | Koolituste liigid ja kategooriad koos märkega, kas koolitus on kohustuslik ja korduv, ning kordumise sagedusega. |
| `bamboohr_training_records` | Ühe töötaja läbitud koolitused koos kuupäeva, koolitaja, tundide, punktide ja maksumusega. |
| `bamboohr_employee_dependents` | Ühe töötaja või kõigi töötajate ülalpeetavad. Vajab BambooHR-is Benefits Administration õigust. |
| `bamboohr_employee_files` | Dokumendikategooriad ja failide andmed töötajakaardil. Faile alla ei laadita. |
| `bamboohr_list_users` | BambooHR-i kasutajakontod koos seotud töötaja id, staatuse ja viimase sisselogimisega. |
| `bamboohr_company_holidays` | Ajavahemikuga kattuvad ettevõtte pühad. Vaikimisi käesolev kalendriaasta. |

### Kuidas puhkuseülevaadet arvutatakse

- **Puhkuse liik**: argument `timeOffType`, selle puudumisel `BAMBOOHR_VACATION_TYPE`, selle puudumisel ainus liik, mille nimes on „vacation", „annual leave" või „puhkus". Kui puhkusele sarnaneb mitu liiki, ei hakka tööriist arvama, vaid loetleb kandidaadid. Määra siis `BAMBOOHR_VACATION_TYPE` väärtuseks õige nimi.
- **Planeeritud**: kinnitatud või ootel puhkus, mis algab pärast seisukuupäeva ja jääb aasta sisse.
- **Planeerimata**: jääk seisukuupäeval miinus planeeritud. Negatiivne väärtus tähendab, et puhkust on planeeritud rohkem, kui jääk lubab.
- **Plokid**: kinnitatud või ootel puhkusetaotlused, aasta piiridesse lõigatud ja üheks liidetud, kui need järgnevad vahetult üksteisele või kattuvad. Pikkust loetakse kalendripäevades: lõpp miinus algus pluss üks.
- **14 päeva reegel**: täidetud, kui vähemalt üks plokk on 14 kalendripäeva või pikem.
- **Aastavahetus**: plokke mõõdetakse kalendriaasta kaupa. Puhkus 25. detsembrist 7. jaanuarini läheb arvesse mõlemas aastas 7 päevana, mitte 14 päevana.
- **Vahed taotluste vahel**: liidetakse ainult vahetult järgnevad või kattuvad taotlused. Kaks esmaspäevast reedeni taotlust, mille vahele jääb nädalavahetus, on kaks 5-päevast plokki. Kui soovid, et periood loetaks üheks plokiks, esita see ühe taotlusena.
- **Jõudlus**: ülevaade teeb ühe jäägipäringu töötaja kohta, viis korraga, ja päringupiirangu korral proovib ühe korra uuesti. Mõnesaja töötaja puhul võib see võtta umbes minuti.

## Soovitused paremate vastuste saamiseks

- **Küsi kõigepealt väljade nimekirja.** Kohandatud väljadel on aliased nagu `customShoeSize`. `bamboohr_list_fields` koos otsisõnaga on kiireim viis õige välja leidmiseks, enne kui seda loed või aruandesse võtad.
- **Aruanne jätab mitteaktiivsed töötajad vaikimisi välja.** `bamboohr_employee_report` eemaldab töötajad, kelle staatus ei ole `Active`, kui ei küsi `includeInactive`.
- **Tabeli read tulevad sortimata.** Ametikäik ja teised tabelid tulevad BambooHR-i järjekorras. Kui vajad viimast rida, sordi kuupäeva järgi.
- **Puhkuseülevaade on aeglane.** Mõnesaja töötajaga ettevõttes võtab see umbes minuti, sest iga töötaja jääk küsitakse eraldi.
- **Tühi vastus viitab tavaliselt õiguste puudumisele.** Vaata `missingFields`-i ja võtme õiguste taset, enne kui järeldad, et andmeid ei ole.

## Privaatsus ja andmete liikumine

- Andmed liiguvad BambooHR-ist sinu arvutis töötavasse ühendusse ja sealt sinu Claude'i vestlusesse. Ühendus ise midagi ei salvesta: ei ole andmebaasi, kettal vahemälu ega tulemuste logi. Väljade ja tabelite nimesid hoitakse mälus kümme minutit.
- Vestlusesse jõudnud andmetele kehtivad sinu organisatsiooni Claude'i paketi tingimused ja andmekaitsereeglid. Töötajate andmed on isikuandmed. Küsi ainult seda, mida vajad, ja eelista koondküsimusi tervete kaartide väljavõtmisele.
- API-võti ei lahku sinu arvutist mujale kui päringutes aadressile `https://<firma>.bamboohr.com`. Tööriistad ei võta võtit ega aadressi argumendina, seega ei saa Claude'i veenda kasutama kellegi teise võtit.
- Kui võti lekib või inimene lahkub, tühista võti BambooHR-is jaotises **API Keys**.

## Kui midagi ei tööta

| Sümptom | Tõenäoline põhjus ja lahendus |
|---|---|
| `401` või „Check that BAMBOOHR_TOKEN is a valid API key" | Võti on vale või tühistatud. Loo uus ja sisesta see: **Settings > Extensions > BambooHR > Configure**. |
| `403` või „access level does not allow this data" | Sinu BambooHR-i õigused ei hõlma neid andmeid. Pöördu BambooHR-i administraatori poole. |
| Väli, mis kindlasti olemas on, ilmub `missingFields`-is | Võti ei näe seda või nimi on vale. Käivita `bamboohr_list_fields` otsisõnaga ja kasuta tagastatud aliast. |
| Puhkuseülevaade ei suuda puhkuse liiki tuvastada | Puhkusele sarnaneb mitu liiki. Kirjuta laienduse seadetes välja **Vacation time-off type** täpne nimi. |
| Osakonnafilter ei leia kedagi | Kataloog ei ole selle osakonna jaoks jagatud. Kontrolli BambooHR-is **Settings > Company Directory**. |
| Ülevaade on aeglane | Iga töötaja kohta tehakse üks jäägipäring. Paarsada töötajat võtab umbes minuti. |

## Keskkonnamuutujad

Vaata faili `.env.example`.

## Arendus

```sh
npm test          # ühik- ja integratsioonitestid
npm run typecheck
npm run build
```

Lähtekoodi ülesehitus: `src/client.ts` (HTTP `get` ja `post`), `src/bamboohr.ts` (otspunktide ümbrised), `src/fields.ts` (väljade abifunktsioonid), `src/metaCache.ts` (10-minutiline metaandmete vahemälu), `src/analysis.ts` (puhkusearvutus), `src/overview.ts` (aruande koostamine), `src/server.ts` (tööriistade registreerimine), `src/tools/shared.ts` (annotatsioonid ja abifunktsioonid), `src/tools/timeOff.ts`, `src/tools/meta.ts`, `src/tools/employees.ts`, `src/tools/people.ts` (tööriistade definitsioonid), `src/index.ts` (käivitamine stdio kaudu).

## Litsents

MIT-litsents, vt faili `LICENSE`.
