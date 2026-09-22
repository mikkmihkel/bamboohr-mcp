# BambooHR Claude'is

Küsi Claude'ilt puhkuste, töötajate andmete, kohandatud väljade ja tabelite ning koolituste kohta. Tööriist ainult loeb, BambooHR-is ei muutu midagi. Töötasu, pangaandmeid, isikukoode ja koduaadresse tööriist ei näita, isegi kui sinu BambooHR-i õigused seda lubaksid, ja iga vastus on piiratud väikese arvu kirjetega korraga.

## Vajad

- Claude Desktop (Windows või Mac) ja tasulist Claude'i kontot
- BambooHR-i kasutajat
- faili `bamboohr-mcp.mcpb`: laadi alla [siit](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb) või küsi IT-lt
- umbes viis minutit. Terminali avama ei pea.

## 1. Loo API-võti

BambooHR-is: pilt all vasakul → **API Keys** → **Add New Key** → nimeks `Claude` → **Generate Key**. Kopeeri võti kohe, seda näidatakse ainult korra. Hoia seda nagu parooli: ära saada seda e-kirjaga ega kleebi vestlusesse.

## 2. Leia ettevõtte aadress

BambooHR avaneb aadressil `firma.bamboohr.com`. Vajad ainult esimest osa: `firma`.

## 3. Paigalda laiendus

1. Tee failil `bamboohr-mcp.mcpb` topeltklõps. Avaneb Claude Desktop.
2. Aken küsib kahte asja:
   - **BambooHR subdomain** — kirjuta sinna ainult `firma`, mitte tervet aadressi.
   - **BambooHR API key** — kleebi siia sammus 1 loodud võti.
   - **Vacation time-off type** on vabatahtlik. Jäta tühjaks; tööriist tuvastab puhkuse liigi ise.
3. Vajuta **Install**.

Kui topeltklõps ei tööta: Claude Desktop → **Settings → Extensions → Advanced settings → Install Extension** → vali fail.

Võtit ei kirjutata ühtegi faili. Claude Desktop hoiab seda operatsioonisüsteemi paroolihoidlas (Macis Keychain, Windowsis kasutajaga seotud krüpteering) ja annab selle edasi ainult sellele tööriistale.

## 4. Proovi

Alusta Claude Desktopis uut vestlust ja küsi: **Kes on sel nädalal puhkusel?** Luba Claude'il tööriista kasutada. Kui saad nimekirja, kõik töötab.

## Kui vahetad võtit või aadressi

Claude Desktop → **Settings → Extensions → BambooHR → Configure**. Muuda väljad ära ja salvesta; uued väärtused hakkavad kehtima kohe, kui Claude tööriista uuesti käivitab.

## Näidisküsimused

- Kes on järgmisel nädalal eemal?
- Palju puhkust on Mari Maasikal kasutamata?
- Kellel arendusosakonnas on puhkust veel planeerimata?
- Kes müügiosakonnas pole sel aastal võtnud 14-päevast järjestikust puhkust?
- Millised taotlused ootavad oktoobris kinnitamist?
- Mis on Anna Tamme jalanumber?
- Millal Mart Mets tööle asus?
- Tallinna kontori töötajate jalanumbrid talvesaabaste tellimiseks.
- Kas Anna on esmaabikoolituse läbinud?
- Millised pühad on sel aastal veel ees?

## Hea teada

- **Näed ülimalt sama, mida BambooHR-is.** Kui keegi puudub, on põhjus sinu õigustes.
- **Küsi osakonna või inimese kaupa, mitte kogu ettevõtte kohta.** Tööriist tagastab korraga kuni 25 kirjet ja nõuab osakonda, asukohta, nime või töötaja id-d. Kui Claude ütleb, et tulemus on üle piiri, kitsenda küsimust.
- **Töötasu, boonuseid, pangaandmeid, isikukoode, sünnikuupäevi ja koduaadresse ei näidata.** Kui küsid, vastab Claude, et väli on reeglitega välistatud („excluded by policy"). See on taotluslik.
- **Haiguslehte näidatakse lihtsalt puudumisena**, ilma põhjuse ja märkusteta.
- **Kõigi osakonna töötajate puhkuseülevaade võtab kuni minuti.**
- **14 päeva loetakse kalendripäevades ühe aasta sees.** Nädalavahetusega eraldatud taotlused on kaks puhkust.
- **Iga päring jääb sinu arvutisse logisse**, kus on kirjas millal, milline tööriist ja millised väljad, aga mitte kunagi andmete väärtused ega nimed. Logi ei saadeta kuhugi.

## Kui ei tööta

| Probleem | Lahendus |
|---|---|
| „No BambooHR API key is available" | Ava **Settings → Extensions → BambooHR → Configure** ja täida API-võtme ja alamdomeeni väli. |
| „is not a bare BambooHR subdomain" | Alamdomeeni väljal on terve aadress. Kirjuta sinna ainult `firma`, mitte `firma.bamboohr.com`. |
| Viga 401 / API-võti | Võti on vale või tühistatud. Loo BambooHR-is uus võti ja sisesta see **Configure**-aknas. |
| Viga 403 / õigused | Sinu BambooHR-i õigused ei luba neid andmeid näha. Räägi administraatoriga. |
| „excluded by policy" | Küsitud väli või tabel on tundlik ja tööriist ei näita seda kellelegi. |
| „above the per-call limit" | Küsi väiksema osakonna, lühema ajavahemiku või konkreetse inimese kohta. |
| Ei leia puhkuse liiki | Claude näitab valikuid. Kirjuta õige nimi **Configure**-akna väljale **Vacation time-off type**. |
| Osakonnast ei leita kedagi | Osakond pole kataloogis nähtav. Räägi administraatoriga. |
| Laiendus on nimekirjas, aga vastuseid ei tule | Sulge Claude Desktop täiesti ja ava uuesti. Kui ikka ei tööta, vaata **Configure**-aknast üle, kas võti ja alamdomeen on täidetud. |

## Võti ja eemaldamine

Kui võti on lekkinud, kustuta see BambooHR-is jaotises **API Keys**, loo uus ja sisesta see **Settings → Extensions → BambooHR → Configure**. Tööriista eemaldamiseks vajuta **Settings → Extensions → BambooHR → Uninstall** ja kustuta võti ka BambooHR-is.

## Uuendamine

Tee uuel `.mcpb` failil topeltklõps ja paigalda uuesti. Võti ja seaded jäävad alles.

## Kõik tööriistad

Täieliku tööriistade nimekirja, turvameetmete kirjelduse ja rohkem näidisküsimusi leiad failist [../README.et.md](../README.et.md).
