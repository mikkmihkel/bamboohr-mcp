# BambooHR-i MCP-server

[![MCP server](https://img.shields.io/badge/MCP-server-6f42c1)](https://modelcontextprotocol.io)
[![Claude Desktop extension](https://img.shields.io/badge/Claude%20Desktop-.mcpb%20laiendus-d97757)](#kiirpaigaldus-claude-desktop)
[![Read-only](https://img.shields.io/badge/BambooHR-ainult%20lugemine-2ea44f)](#kuidas-ligipääs-töötab)
[![Hardened](https://img.shields.io/badge/andmed-lubatud%20loend%20%2B%20auditilogi-1f6feb)](#turvameetmed)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/litsents-MIT-blue)](LICENSE)

<img src="assets/icon.svg" alt="" width="96" align="right">

In English: [README.md](README.md)

Ainult lugemiseks mõeldud [Model Context Protocol](https://modelcontextprotocol.io) server, mille abil Claude vastab küsimustele BambooHR-i andmete põhjal: kes on eemal, puhkusejäägid ja taotlused, osakonna puhkuseülevaade, lubatud loendis olevad töötajaväljad koos kohandatud väljadega, töötajate tabelid, väikesed sihitud aruanded, koolitused, ettevõtte pühad, kasutajakontod ja hiljutised muudatused.

BambooHR-i andmeid ei muudeta kunagi. Midagi ei looda, ei kinnitata, ei parandata ega kustutata. Ainus `POST`-päring on kohandatud aruande küsimine, mis samuti ainult loeb.

> **Hoiatus: „ainult lugemine" tagab see tööriist, mitte BambooHR.**
> Server kutsub välja ainult lugemisotspunkte, kontrollib iga välja lubatud loendi vastu ja puhastab igast vastusest tundlikud võtmed. Kuid BambooHR-i API-võti pärib täielikult selle konto õigused, millega võti loodi. Kui konto saab andmeid muuta, saab seda ka võti, ja iga teine programm, kes võtme kätte saab, saab seda samuti. Loo võti kontol, mille õigused on sinu küsimustele vastamiseks võimalikult kitsad, tühista võti, kui tööriista enam ei kasuta, ja arvesta, et sinu arvuti kuulub usalduspiiri sisse.
>
> Tarkvara antakse üle „nagu on", MIT-litsentsi alusel. Hoidla omanik ei võta mingit vastutust ühegi kasutuse, kasutusjuhu, andmete avaldumise ega tagajärje eest, mis selle käitamisest tuleneb. Oma organisatsiooni andmekaitsekohustuste ja BambooHR-i kasutustingimuste täitmise eest vastutad sina.

## Kiirpaigaldus (Claude Desktop)

Node.js-i paigaldada ei ole vaja. Claude Desktopil on oma käituskeskkond kaasas.

1. Laadi viimasest väljalaskest alla fail [`bamboohr-mcp.mcpb`](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb). Soovi korral [kontrolli allalaaditud faili](#väljalaske-kontrollimine).
2. Tee failil topeltklõps. Claude Desktop avab paigaldusakna. Vajuta **Install**. Aken ei küsi midagi muud: ei võtit ega aadressi.
3. Alusta uut vestlust ja küsi: *„Kes on sel nädalal puhkusel?"*. Esimene vastus on veateade, milles on sinu arvuti jaoks täpne registreerimiskäsk, umbes selline:

   ```
   No BambooHR API key is enrolled on this machine. Run:
   "/Applications/Claude.app/.../node" "/Users/sina/Library/Application Support/Claude/Claude Extensions/.../dist/index.js" enroll
   ```

4. Ava terminal (macOS: Terminal, Windows: PowerShell), kleebi käsk ja vajuta Enter. Käsk küsib ettevõtte aadressi esimest osa (`firma`, kui aadress on `firma.bamboohr.com`) ja seejärel API-võtit. Võtit sisestamisel ei kuvata ja see salvestatakse operatsioonisüsteemi paroolihoidlasse. BambooHR-is leiad võtme oma profiilipildi alt (all vasakul) > **API Keys** > **Add New Key**.
5. Küsi sama küsimus uuesti.

Kui topeltklõps ei tee midagi, vali **Settings > Extensions > Advanced settings > Install Extension** ja näita fail ette. Teami või Enterprise'i paketi puhul võib olla vaja, et administraator kohandatud laiendused eelnevalt lubab. Uuendamiseks paigalda uus fail; registreering jääb alles.

Paigaldusjuhend personalitöötajale: [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md).

## Kuidas ligipääs töötab

Server kasutab **sinu enda BambooHR-i API-võtit**. Näed ülimalt seda, mida näed BambooHR-is, ja vähem seal, kus selle tööriista reeglid on rangemad. Personaliadministraatori võti näeb kogu ettevõtet, tavatöötaja võti ainult tema enda andmeid ja võimalusel otseste alluvate andmeid. BambooHR piirab vastuseid märkamatult: kui aruanne on poolik, on põhjus enamasti võtme õigustes, mitte veas. Kui tööriist saab seda tuvastada, annab ta sellest teada: `bamboohr_get_employee` ja `bamboohr_employee_report` väljundis loetleb `missingFields` väljad, mis tulid tühjana või mida võtme õigused ei luba näha, ning `excludedFields` väljad, millest see tööriist reeglite tõttu keeldus.

## Turvameetmed

Kõik allpool loetletu on koodis jõustatud ja testidega kaetud. See on põhjus, miks 4.0 on ühilduvust katkestav väljalase.

| # | Meede | Kus |
|---|---|---|
| 1 | **Saladusi seadistuses ei ole.** Claude Desktopi seadistus käivitab programmi ilma `env`-plokita. API-võti võetakse ühe korra vastu käsuga `enroll` ja hoitakse operatsioonisüsteemi paroolihoidlas: macOS-i Keychain (`security`), Windowsi DPAPI (kasutaja ulatus, fail kaustas `%LOCALAPPDATA%`), Linuxi Secret Service (`secret-tool`). Võti loetakse sealt igal käivitamisel ning seda ei võeta kunagi vastu keskkonnamuutujast, seadistusfailist ega tööriista argumendist. Registreerimisel antakse võti OS-i abiprogrammile standardsisendi kaudu (`security -i`, PowerShell, `secret-tool`), mitte kunagi käsureal, ja abiprogramme kutsutakse absoluutse teega ilma kestata. Kui võtit ei ole, tagastab iga tööriist veateate koos registreerimiskäsuga. | `src/credentialStore.ts`, `src/config.ts`, `src/cli.ts` |
| 2 | **Väljade lubatud loend, mitte keelatud loend.** `bamboohr_get_employee` ja `bamboohr_employee_report` võtavad vastu ainult koodis kirjeldatud loendis olevaid välju (nimi, ametikoht, osakond, üksus, asukoht, juht, tööle asumise ja lahkumise kuupäevad, staatus, töökontaktid, töötaja number). Kohandatud väljad, kuhu ettevõttespetsiifilised palga- või pangaväljad tavaliselt satuvad, peavad läbima kolm kontrolli: BambooHR-i väljatüüp ei ole raha-, isikukoodi-, panga- ega kaitstud tunnuse tüüp; ei alias ega kuvatav nimi ei vasta keelatud mustrile (inglise ja eesti sõnavara, ankurdamata, nii et „Net pay", „Töötasu" või „Pangakonto" jäävad kinni); ja kui administraator on käsuga `enroll --allow-custom-field` määranud selgesõnalise loendi, on alias selles loendis. `--no-custom-fields` keelab kõik kohandatud väljad. Kõigest muust keeldutakse enne HTTP-päringut teatega „excluded by policy". | `src/policy.ts` |
| 3 | **Töötasu on tööriista piiril blokeeritud.** `bamboohr_table_rows` keeldub tabelitest `compensation`, `bonus`, `commission`, pangaandmete, otsemaksete, palgaarvestuse ja kõigist kohandatud tabelitest, mille alias neile mustritele vastab. `bamboohr_list_tables` neid ei näita. Väljad `payRate`, `payRateEffectiveDate`, `payType`, `payPer`, `payGroup`, `paidPer`, `ssn`, `nationalId`, pangaväljad ja teised on igal pool välistatud. | `src/policy.ts`, `src/tools/employees.ts` |
| 4 | **Vastuse järelpuhastus.** Enne iga vastuse tagastamist käiakse kogu vastuseobjekt läbi ja eemaldatakse võtmed, mis vastavad keelatud mustritele (töötasu, palk, boonus, komisjonitasu, pank, IBAN, SWIFT, kontonumber, maksud, isikukood, sotsiaalkindlustusnumber, pass, sünnikuupäev, sugu, perekonnaseis, etniline kuuluvus, rahvus, kodakondsus, usk, puue, meditsiin, kodukontaktid, aadress, hädaabikontakt). Puhastus töötab igas tööriistas, ka vastustel, mida lubatud loend juba filtreeris, nii et BambooHR-i hiljem lisatavad väljad ei leki vaikimisi. | `src/policy.ts`, `src/tools/shared.ts` |
| 5 | **Eriti tundlikud tööriistad on lukus.** `bamboohr_employee_dependents` ja `bamboohr_employee_files` registreeritakse ainult siis, kui registreerimisel on antud `--enable-sensitive-tools`. Haiguslehe taotlused taandatakse üldiseks puudumiseks: liik on `absent`, liigi id, kogus ja märkused eemaldatakse. Tervisega seotud puudumiste liigid peidetakse liikide loendist ja neid ei saa taotluste filtrina kasutada, nii et neid ei saa ka id kaudu välja valida. Haiguslehe jäägid jäetakse välja. „Kes on eemal" ei ole puudumise liiki kunagi näidanud. Tuvastus katab inglise ja eesti nimetused, sealhulgas „töövõimetusleht". | `src/tools/people.ts`, `src/tools/timeOff.ts` |
| 6 | **Hulgipäringud on piiratud.** Iga isikuandmeid tagastav tööriist jõustab kirjete ülempiiri ühe päringu kohta (vaikimisi 25, seadistatav 1 kuni 500). Tööriistad, mis võiksid välja anda kogu ettevõtte, nõuavad konkreetset töötaja id-d või filtrit: `bamboohr_employee_report` vajab `employeeIds` või `department`, `location` või `division`; `bamboohr_list_employees` vajab `search`, `department` või `location`; `bamboohr_vacation_overview` vajab `department` või `employeeIds`; `bamboohr_table_rows` vajab `employeeId`; `bamboohr_changed_employees` on piiratud ja nõuab korrektses vormingus `since`. Piiri ületamisel päring lükatakse tagasi koos soovitusega, mitte ei kärbita vaikselt. | `src/policy.ts`, `src/tools/*.ts` |
| 7 | **Iga päring logitakse, väärtused välja arvatud.** Iga päring kirjutab ühe JSON-rea: ajatempel, tööriist, küsitud väljade nimed, ohutud filtriparameetrid (kuupäevad, staatused, tabeli alias, osakond), kirjete arv, puhastatud võtmete arv, tulemus ja vea klass. Väljade väärtusi, töötajate nimesid, otsisõnu, märkusi ega vastuseid ei kirjutata kunagi; vabas vormis parameetreid kontrollitakse mustri vastu ja kärbitakse enne logimist. Töötajate id-d räsitakse HMAC-SHA256-ga, kasutades juhuslikku soola, mida hoitakse ainult selles arvutis. | `src/audit.ts` |
| 8 | **Ainult kohalik, piiratud logi.** Logi kirjutatakse kasutaja rakendusandmete kausta, millele on ligipääs ainult omanikul (`0700`/`0600`, Windowsis `icacls`), fail roteeritakse 5 MiB juures, hoitakse viis faili ja käivitamisel kustutatakse üle 90 päeva vanad kirjed. Logimoodulis ei ole võrgukoodi. Kaustas on `CACHEDIR.TAG` ja `.nosync` märgis, macOS-is on kaust Time Machine'i varukoopiast välja jäetud, Windowsis asub see kaustas `%LOCALAPPDATA%`, mida OneDrive ei sünkroniseeri. Käsk `logs` näitab kausta teed ja viimaseid kirjeid. | `src/audit.ts`, `src/appPaths.ts` |
| 9 | **Kogu BambooHR-ist tulev tekst on ebausaldusväärne.** Iga tulemus ja iga veateade, mis võib sisaldada BambooHR-ist tulnud teksti, on pakitud märgistatud ümbrisesse, mis ütleb mudelile, et sisu on andmed, mitte juhised. Ümbrise markerid kannavad iga päringu jaoks juhuslikku nonce-väärtust ja markeri sarnased jupid andmete sees neutraliseeritakse, nii et märkus ei saa ümbrist enneaegselt sulgeda. Vabatekstiväljad (märkused, ametinimetused, kirjeldused, failinimed, kommentaarid) on lisaks ümbritsetud markeritega `[UNTRUSTED TEXT FROM BAMBOOHR ...]` ning juhtmärgid eemaldatakse. | `src/policy.ts`, `src/tools/shared.ts` |
| 10 | **Tarneahel on kinnitatud.** Väljalasked ehitab GitHub Actions versioonisildi põhjal, allkirjastab Sigstore'iga (võtmeta, seotud selle hoidlaga), lisab SLSA ehitusandmed ja avaldab koos SHA-256 kontrollsummadega. Kolmandate osapoolte tegevused on kinnitatud commit'i räside külge, paketi ehitaja on lukufailist tulev täpselt kinnitatud arendussõltuvus ja väljalasketöö kirjutusõigused on antud ainult sellele tööle. Pakett käivitatakse absoluutse teega kindlast paigalduskaustast; `npx`-i ei kasutata ei ehitamisel ega käitusajal. Väljalaskefaile hoidlasse ei panda; need on olemas ainult allkirjastatud väljalaskevaradena. Käivitamisel laeb server versioonide tühistusloendi ja keeldub töötamast, kui tema versioon on tühistatud. | `.github/workflows/release.yml`, `src/selfCheck.ts` |

Serveri ulatusest väljas: server ei saa kontrollida, millise Claude'i kontoga kasutaja on sisse logitud. Selle eest vastutavad domeenihaldus, kohustuslik SSO ja hallatud paigaldus. Auditikõlbulik seire tugineb BambooHR-i poolsetele kasutajapõhistele API-logidele, mitte kohalikule logifailile.

### Mida lubatud loend sisaldab

Standardväljad: `id`, `displayName`, `firstName`, `lastName`, `preferredName`, `jobTitle`, `department`, `division`, `location`, `supervisor`, `supervisorId`, `supervisorEId`, `supervisorEmail`, `hireDate`, `originalHireDate`, `terminationDate`, `status`, `employmentHistoryStatus`, `workEmail`, `workPhone`, `workPhoneExtension`, `mobilePhone`, `employeeNumber`, `lastChanged`. Koduaadressi väljad `address1`, `city`, `state`, `zipcode` ja `country` on välistatud, sest need kirjeldavad inimese elukohta; kontori jaoks kasuta välja `location`. Kohandatud väljad: iga alias, mis algab sõnaga `custom`, mille BambooHR-i tüüp ei ole keelatud (`currency`, `ssn`, `sin`, `nin`, `gender`, `marital_status`, palgatüübid jms) ja mille alias ega kuvatav nimi ei vasta keelatud mustrile, seega `customShoeSize` läheb läbi, aga `customBonusPct`, `customNetPay` või väli nimega „Töötasu" mitte. Kuna nimepõhine kontroll ei saa kunagi olla täielik, eelistagu organisatsioonid selgesõnalist loendit: `enroll --allow-custom-field customShoeSize --allow-custom-field customEquipment` lubab ainult need aliased ja `--no-custom-fields` ei luba ühtegi. Standardloendi või mustrite muutmiseks paranda `ALLOWED_STANDARD_FIELDS`, `BLOCKED_FIELD_TYPES` ja `BLOCKED_KEY_PATTERNS` failis `src/policy.ts` ja ehita uuesti; nende jaoks ei ole käitusaegset lülitit teadlikult.

### Käsud

Käivita need sama `node`-i ja `index.js`-i teega, mille registreerimisveateade välja trükib, või lähtekoodist käsuga `node dist/index.js`.

| Käsk | Mida teeb |
|---|---|
| `enroll` | Ühekordne interaktiivne seadistus. Küsib alamdomeeni ja API-võtit (võtit ei kuvata). Valikud: `--subdomain <nimi>`, `--vacation-type <nimi>`, `--max-records <1-500>`, `--enable-sensitive-tools` / `--disable-sensitive-tools`, `--revocation-url <https-aadress>`, `--strict-self-check` / `--no-strict-self-check`, `--allow-custom-field <alias>` (korratav; piirab kohandatud väljad selle loendiga), `--no-custom-fields`, `--key-stdin` (loeb võtme standardsisendist skriptitud paigalduseks; argumendina võtit kunagi vastu ei võeta). |
| `unenroll` | Eemaldab võtme paroolihoidlast. Seaded jäävad alles. |
| `status` | Kasutatav hoidla, kas võti on registreeritud (jah või ei, kunagi mitte võti ise), teed ja seaded. |
| `logs [--tail N]` | Näitab auditilogi kausta ja viimaseid N kirjet (vaikimisi 50). |
| `doctor` | Kontrollib registreeringut ja käivitab versioonikontrolli ilma ühendumata. |
| `version` | Näitab versiooni. |

### Seaded

Mittesalajased seaded asuvad rakendusandmete kaustas failis `config.json` ja neid kirjutab `enroll`. Keskkonnamuutujad kirjutavad need arendajate jaoks üle; ükski neist ei saa kanda API-võtit.

| Seade | Keskkonnamuutuja | Vaikimisi | Tähendus |
|---|---|---|---|
| `companyDomain` | `BAMBOOHR_COMPANY_DOMAIN` | kohustuslik | Ainult alamdomeen, `firma` aadressi `firma.bamboohr.com` puhul. |
| `vacationType` | `BAMBOOHR_VACATION_TYPE` | automaatne | Puhkusena loetava puudumise liigi nimi või id. |
| `maxRecords` | `BAMBOOHR_MAX_RECORDS` | `25` | Kirjete ülempiir päringu kohta, 1 kuni 500. |
| `enableSensitiveTools` | `BAMBOOHR_ENABLE_SENSITIVE_TOOLS` | `false` | Registreerib ülalpeetavate ja failide tööriistad. |
| `allowedCustomFields` | `BAMBOOHR_ALLOWED_CUSTOM_FIELDS` (komadega eraldatud) | määramata | Kui on määratud, võib lugeda ainult neid kohandatud väljade aliaseid. Tühi loend: ühtegi kohandatud välja. Määramata: otsustavad tüübi- ja nimekontroll. |
| `revocationUrl` | `BAMBOOHR_REVOCATION_URL` | selle hoidla `revocations.json` | Versioonide tühistusloendi HTTPS-aadress. Suuna see ettevõttesisesele otspunktile. |
| `strictSelfCheck` | `BAMBOOHR_STRICT_SELF_CHECK` | `false` | Keeldu käivitumast, kui tühistusloend ei ole kättesaadav. |
| andmekaust | `BAMBOOHR_MCP_DATA_DIR` | sõltub OS-ist | Määrab, kus asuvad `config.json`, auditisool ja logid. |

Vaikimisi asukohad: macOS `~/Library/Application Support/bamboohr-mcp`, logid kaustas `~/Library/Logs/bamboohr-mcp`; Windows `%LOCALAPPDATA%\bamboohr-mcp`, logid selle alamkaustas `logs`; Linux `~/.local/state/bamboohr-mcp` (või `$XDG_STATE_HOME`), logid alamkaustas `logs`. Käsk `status` näitab täpseid teid.

### Väljalaske kontrollimine

Iga väljalaskega on kaasas `SHA256SUMS`, Sigstore'i allkirjapaketid ja ehitusandmete tõend.

```sh
sha256sum -c SHA256SUMS
cosign verify-blob --bundle bamboohr-mcp.mcpb.sigstore.json \
  --certificate-identity-regexp '^https://github.com/mikkmihkel/bamboohr-mcp/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  bamboohr-mcp.mcpb
gh attestation verify bamboohr-mcp.mcpb --repo mikkmihkel/bamboohr-mcp
```

### Versioonide tühistusloend

Hoidla juurkaustas olev `revocations.json` on vaikimisi loend. Ettevõttesiseselt paigaldades hoia oma koopiat sisemisel HTTPS-otspunktil ja määra registreerimisel `--revocation-url`, siis saab ohtu sattunud või tagasi kutsutud versiooni järgmisel käivitamisel igas arvutis peatada. Vorming:

```json
{ "schemaVersion": 1, "minimumVersion": "4.0.0", "revokedVersions": ["3.0.0"], "message": "põhjus" }
```

Vaikimisi annab kättesaamatu loend ainult hoiatuse, et sülearvutid töötaksid ka võrguta. `--strict-self-check` sunnib sel juhul käivitumisest keelduma.

### Teadaolevad piirangud

- **Osakonnafiltrid laevad ikkagi kogu aruande.** BambooHR-il ei ole serveripoolset osakonna, asukoha ega üksuse filtrit, seega `bamboohr_employee_report` sellise filtriga ja `bamboohr_vacation_overview` laevad kogu ettevõtte aruande või kataloogi protsessi mällu ja kitsendavad seda kohapeal, enne kui piir rakendub. Vestlusesse ei jõua midagi üle piiri ja kettale ei kirjutata midagi, aga andmed läbivad arvuti. `employeeIds` filtrit rakendab BambooHR serveripoolselt ja see väldib seda.
- **Nimepõhised kontrollid on heuristilised.** Keelatud mustrite loend tabab tundlike väljade levinud inglise- ja eestikeelsed nimetused, aga ei saa tunda iga ettevõtte sõnavara. Kus see on oluline, määra registreerimisel selgesõnaline kohandatud väljade loend.
- **Tühistuskontroll on vaikimisi leebe** (kättesaamatu loend ei peata käivitumist), et sülearvutid töötaksid võrguta. Hallatud paigaldustes lülita sisse `--strict-self-check`.
- **Server ei näe, kes on Claude'i sisse logitud.** Vaata eespool märkust domeenihalduse ja SSO kohta.

## Käsitsi seadistamine

Arendajatele ja Claude Code'i kasutajatele. Vajalik on Node.js 20 või uuem.

```sh
git clone https://github.com/mikkmihkel/bamboohr-mcp.git
cd bamboohr-mcp
npm ci
npm run build
node dist/index.js enroll          # küsib alamdomeeni ja võtit
node dist/index.js status
```

Lisa server Claude Desktopi: **Settings > Developer > Edit Config**. Pane tähele, et `env`-plokki ei ole.

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

Või Claude Code'i:

```sh
claude mcp add bamboohr -- node /absolute/path/to/bamboohr-mcp/dist/index.js
```

Proovi järele: küsi Claude'ilt *„Näita töötajate välju, mille nimes on 'shoe'."* Vastuseks peaksid saama välja nime, aliase ja tüübi või tühja nimekirja. Küsi *„Kes on sel nädalal eemal?"*, et veenduda võtme toimimises. Kui puhkuseülevaade ütleb, et ei suuda puhkuse liiki tuvastada, küsi *„Näita puhkuse liike"* ja käivita uuesti `enroll --vacation-type "<nimi>"`.

## Paketi jagamine personalile

Saada personalitöötajatele link [viimasele väljalaskele](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest) koos paigaldusjuhendiga. Iga kasutaja registreerib oma võtme; midagi ei jagata.

- Paigaldusjuhend personalile: [docs/PAIGALDUSJUHEND.md](docs/PAIGALDUSJUHEND.md)
- Skriptitud paigaldus: `echo "$KEY" | node dist/index.js enroll --subdomain firma --key-stdin` loeb võtme standardsisendist, nii et see ei satu käsureale ega käsuajalukku.
- Uue versiooni väljaandmiseks tõsta `version` failides `package.json` ja `manifest.json`, lisa `CHANGELOG.md`-sse jaotis, loo silt `vX.Y.Z` ja lükka see üles, või käivita **Release**-töövoog käsitsi, andes versiooni sisendina. Mõlemal juhul töövoog ehitab, allkirjastab ja avaldab paketi ning käsitsi käivitamisel loob ka sildi. `npm run bundle` ehitab kohapeal testimiseks allkirjastamata koopia; see on teadlikult git-ignoreeritud.

## Näidisküsimused

Sulgudes on tööriist, mida Claude vastamiseks kasutab.

### Puhkused

- *Kes on järgmisel nädalal eemal?* (`bamboohr_whos_out`)
- *Näita Anna Tamme puhkusejääki.* (`bamboohr_list_employees` argumendiga `search`, seejärel `bamboohr_time_off_balances`)
- *Millised puhkusetaotlused ootavad oktoobris veel kinnitamist?* (`bamboohr_time_off_requests` staatusega `requested`)
- *Kes arendusosakonnas ei ole sel aastal võtnud 14-päevast järjestikust puhkust?* (`bamboohr_vacation_overview` argumentidega `department` ja `onlyMissingFourteenDayBlock`)

### Töötajate andmed ja kohandatud väljad

- *Mis on Anna Tamme jalanumber?* (`bamboohr_list_fields` otsisõnaga `shoe`, seejärel `bamboohr_get_employee`)
- *Millal Mart Mets tööle asus?* (`bamboohr_get_employee` väljaga `hireDate`)
- *Tallinna kontori töötajate jalanumbrid talvesaabaste tellimiseks.* (`bamboohr_employee_report` väljaga `location` ja kohandatud väljaga)
- *Kellel müügiosakonnas on sel kuul tööjuubel?* (`bamboohr_employee_report` argumendiga `department` ja väljaga `hireDate`)

### Tabelid, koolitused, haldus

- *Näita Anna ametikäiku.* (`bamboohr_table_rows` tabeliga `jobInfo` ja tema id-ga)
- *Millised koolitused on kohustuslikud?* (`bamboohr_training_types`)
- *Kas Anna on esmaabikoolituse läbinud?* (`bamboohr_training_records`)
- *Millised pühad on sel aastal veel ees?* (`bamboohr_company_holidays`)
- *Kelle andmed on alates 1. septembrist muutunud?* (`bamboohr_changed_employees`)
- *Millised BambooHR-i kasutajakontod on välja lülitatud?* (`bamboohr_list_users` staatusega `disabled`)

## Tööriistad

### Puhkused

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_whos_out` | Valitud ajavahemikus eemal olevad töötajad ja pühad. Vaikimisi tänasest 14 päeva edasi. Puudumise liiki ei näidata. Piiratud. |
| `bamboohr_list_employees` | Praegused töötajad, kes vastavad filtrile `search`, `department` või `location`, koos id, nime, ametikoha, osakonna, asukoha, juhi ja töö-e-postiga. Üks filter on kohustuslik. Piiratud. |
| `bamboohr_list_time_off_types` | Ettevõtte puudumiste liigid ja nende id-d, ilma tervisega seotud liikideta. |
| `bamboohr_time_off_balances` | Ühe töötaja jäägid valitud kuupäeva seisuga. Haiguslehe liigid jäetakse välja. |
| `bamboohr_time_off_requests` | Ajavahemikuga kattuvad taotlused koos filtritega. Haigusleht näidatakse kui `absent` ilma liigi, koguse ja märkusteta; tervisega seotud liigi filtrist keeldutakse. Piiratud. |
| `bamboohr_vacation_overview` | Aasta puhkusearuanne ühe osakonna või id-loendi töötajate kohta koos 14 päeva kontrolliga. Piiratud. |

### Töötajad ja väljad

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_list_fields` | Kõik töötajaväljad koos id, nime, aliase ja tüübiga ning märkega, kas see tööriist välja lubab. `includeOptions` lisab valikuväljade väärtused. |
| `bamboohr_list_tables` | Töötajate tabelid koos aliase ja veergudega. Töötasuga seotud tabelid on peidetud. |
| `bamboohr_get_employee` | Ühe töötaja lubatud loendis olevate väljade väärtused ning `missingFields` ja `excludedFields`. Jäta `employeeId` ära, et lugeda võtme omaniku enda andmeid. |
| `bamboohr_employee_report` | Lubatud loendis olevad väljad töötajate kohta, kes on valitud argumendiga `employeeIds`, `department`, `location` või `division`. Sisaldab alati id, displayName ja status. Piiratud. |
| `bamboohr_table_rows` | Ühe lubatud tabeli read ühe töötaja kohta. |
| `bamboohr_changed_employees` | Pärast antud ajahetke lisatud, muudetud või kustutatud töötajate id-d, uusimad ees. Piiratud. |

### Inimesed ja ettevõte

| Tööriist | Mida teeb |
|---|---|
| `bamboohr_training_types` | Koolituste liigid ja kategooriad koos märkega, kas koolitus on kohustuslik ja korduv, ning kordumise sagedusega. |
| `bamboohr_training_records` | Ühe töötaja läbitud koolitused. |
| `bamboohr_employee_dependents` | Ühe töötaja ülalpeetavad. Vaikimisi välja lülitatud. |
| `bamboohr_employee_files` | Dokumendikategooriad ja failide andmed töötajakaardil. Faile alla ei laadita. Vaikimisi välja lülitatud. |
| `bamboohr_list_users` | BambooHR-i kasutajakontod koos seotud töötaja id, staatuse ja viimase sisselogimisega. Piiratud. |
| `bamboohr_company_holidays` | Ajavahemikuga kattuvad ettevõtte pühad. Vaikimisi käesolev kalendriaasta. |

### Kuidas puhkuseülevaadet arvutatakse

- **Puhkuse liik**: argument `timeOffType`, selle puudumisel seade `vacationType`, selle puudumisel ainus liik, mille nimes on „vacation", „annual leave" või „puhkus". Kui puhkusele sarnaneb mitu liiki, ei hakka tööriist arvama, vaid loetleb kandidaadid.
- **Planeeritud**: kinnitatud või ootel puhkus, mis algab pärast seisukuupäeva ja jääb aasta sisse.
- **Planeerimata**: jääk seisukuupäeval miinus planeeritud. Negatiivne väärtus tähendab, et puhkust on planeeritud rohkem, kui jääk lubab.
- **Plokid**: kinnitatud või ootel puhkusetaotlused, aasta piiridesse lõigatud ja üheks liidetud, kui need järgnevad vahetult üksteisele või kattuvad. Pikkust loetakse kalendripäevades: lõpp miinus algus pluss üks.
- **14 päeva reegel**: täidetud, kui vähemalt üks plokk on 14 kalendripäeva või pikem.
- **Aastavahetus**: plokke mõõdetakse kalendriaasta kaupa. Puhkus 25. detsembrist 7. jaanuarini läheb arvesse mõlemas aastas 7 päevana.
- **Vahed taotluste vahel**: liidetakse ainult vahetult järgnevad või kattuvad taotlused. Kaks esmaspäevast reedeni taotlust, mille vahele jääb nädalavahetus, on kaks 5-päevast plokki.
- **Jõudlus**: üks jäägipäring töötaja kohta, viis korraga, päringupiirangu korral üks kordus.

## Soovitused paremate vastuste saamiseks

- **Küsi kõigepealt väljade nimekirja.** Kohandatud väljadel on aliased nagu `customShoeSize`. `bamboohr_list_fields` koos otsisõnaga on kiireim viis õige välja leidmiseks ja näitab ka, kas reeglid seda lubavad.
- **Kitsenda enne küsimist.** Iga inimesi puudutav tööriist vajab osakonda, asukohta, otsisõna või id-loendit ja tagastab ülimalt seadistatud piiri jagu kirjeid. Küsi osakonna kaupa, mitte kogu ettevõtte kohta.
- **Aruanne jätab mitteaktiivsed töötajad vaikimisi välja**, kui ei küsi `includeInactive`.
- **Tabeli read tulevad sortimata.** Kui vajad viimast rida, sordi kuupäeva järgi.
- **Tühi vastus viitab tavaliselt õiguste puudumisele.** Vaata `missingFields`-i, `excludedFields`-i ja võtme õiguste taset, enne kui järeldad, et andmeid ei ole.

## Privaatsus ja andmete liikumine

- Andmed liiguvad BambooHR-ist sinu arvutis töötavasse ühendusse ja sealt sinu Claude'i vestlusesse. Ühendus BambooHR-i andmeid ei salvesta: ei ole andmebaasi ega kettal vahemälu. Väljade ja tabelite metaandmeid hoitakse mälus kümme minutit. Auditilogi sisaldab päringute metaandmeid, kunagi mitte väärtusi ega nimesid.
- Vestlusesse jõudnud andmetele kehtivad sinu organisatsiooni Claude'i paketi tingimused ja andmekaitsereeglid. Töötajate andmed on isikuandmed. Küsi ainult seda, mida vajad, ja eelista koondküsimusi tervete kaartide väljavõtmisele.
- API-võti ei lahku sinu arvutist mujale kui päringutes aadressile `https://<firma>.bamboohr.com`. Võti loetakse operatsioonisüsteemi paroolihoidlast, kunagi mitte failist ega argumendist, seega ei saa Claude'i veenda kasutama kellegi teise võtit.
- Ainus muu võrgupäring on käivitamisel tühistusloendi laadimine, mis saadab ainult versiooninumbri.
- Kui võti lekib või inimene lahkub, tühista võti BambooHR-is jaotises **API Keys** ja käivita arvutis `unenroll`.

## Kui midagi ei tööta

| Sümptom | Tõenäoline põhjus ja lahendus |
|---|---|
| „No BambooHR API key is enrolled on this machine" | Käivita teates näidatud `enroll`-käsk. |
| `401` või „Check that the enrolled API key is valid" | Võti on vale või tühistatud. Loo uus ja käivita `enroll` uuesti. |
| `403` või „access level does not allow this data" | Sinu BambooHR-i õigused ei hõlma neid andmeid. Pöördu BambooHR-i administraatori poole. |
| „excluded by policy" | Väli või tabel on lubatud loendist väljas. See on taotluslik, vt [Mida lubatud loend sisaldab](#mida-lubatud-loend-sisaldab). |
| „above the per-call limit" | Kitsenda päringut osakonna, asukoha, otsisõna, lühema ajavahemiku või id-loendiga või tõsta registreerimisel `maxRecords`. |
| „requires employeeIds or a filter" | Lisa osakond, asukoht, üksus, otsisõna või id-loend. |
| Väli, mis kindlasti olemas on, ilmub `missingFields`-is | Võti ei näe seda või nimi on vale. Käivita `bamboohr_list_fields` otsisõnaga ja kasuta tagastatud aliast. |
| „This version has been revoked" | Paigalda viimane väljalase. |
| Puhkuseülevaade ei suuda puhkuse liiki tuvastada | Käivita `enroll --vacation-type "<täpne nimi>"`. |
| `secret-tool` puudub (Linux) | Paigalda `libsecret-tools` ja veendu, et Secret Service (GNOME Keyring, KWallet) töötab. |

## Arendus

```sh
npm test          # ühik- ja integratsioonitestid
npm run typecheck
npm run build
npm run bundle    # kohalik .mcpb + SHA256SUMS
```

Lähtekoodi ülesehitus: `src/client.ts` (HTTP `get` ja `post`), `src/bamboohr.ts` (otspunktide ümbrised), `src/policy.ts` (lubatud loend, keelatud mustrid, puhastus, haiguslehe taandamine, ebausaldusväärse teksti märgistus, piirid), `src/audit.ts` (kohalik auditilogi), `src/credentialStore.ts` (paroolihoidla liidesed), `src/settings.ts` ja `src/appPaths.ts` (mittesalajased seaded ja OS-i teed), `src/selfCheck.ts` (versiooni tühistuskontroll), `src/cli.ts` (käsud), `src/fields.ts`, `src/metaCache.ts`, `src/analysis.ts`, `src/overview.ts` (puhkusearvutus ja aruanne), `src/server.ts` (tööriistade registreerimine), `src/tools/*.ts` (tööriistade definitsioonid), `src/index.ts` (käivitamine).

Töö Claude Code'iga selles hoidlas: 4.0 turvameetmed planeeris ja vaatas üle tipptaseme mudel, üksikud moodulid teostasid väiksemate mudelitega alamagendid kirjaliku spetsifikatsiooni ja range failide omandijaotuse alusel, misjärel need liideti ja vaadati üle. Selline jaotus hoiab turvaotsused ühes kohas ja teostuse korratavana.

## Litsents

MIT-litsents, vt faili `LICENSE`.
