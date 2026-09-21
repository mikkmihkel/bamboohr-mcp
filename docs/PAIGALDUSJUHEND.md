# BambooHR Claude'is

Küsi Claude'ilt puhkuste, töötajate andmete, kohandatud väljade ja tabelite ning koolituste kohta. Tööriist ainult loeb, BambooHR-is ei muutu midagi. Töötasu, pangaandmeid, isikukoode ja koduaadresse tööriist ei näita, isegi kui sinu BambooHR-i õigused seda lubaksid, ja iga vastus on piiratud väikese arvu kirjetega korraga.

## Vajad

- Claude Desktop (Windows või Mac) ja tasulist Claude'i kontot
- BambooHR-i kasutajat
- faili `bamboohr-mcp.mcpb`: laadi alla [siit](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb) või küsi IT-lt
- umbes viis minutit ja üht korda terminali avamist (allpool on täpselt kirjas, mida sinna kleepida)

## 1. Paigalda laiendus

1. Tee failil `bamboohr-mcp.mcpb` topeltklõps. Avaneb Claude Desktop.
2. Vajuta **Install**. Rohkem see aken midagi ei küsi.

Kui topeltklõps ei tööta: Claude Desktop → **Settings → Extensions → Advanced settings → Install Extension** → vali fail.

## 2. Loo API-võti

BambooHR-is: pilt all vasakul → **API Keys** → **Add New Key** → nimeks `Claude` → **Generate Key**. Kopeeri võti kohe, seda näidatakse ainult korra. Hoia seda nagu parooli: ära saada seda e-kirjaga ega kleebi vestlusesse.

## 3. Leia ettevõtte aadress

BambooHR avaneb aadressil `firma.bamboohr.com`. Vajad ainult esimest osa: `firma`.

## 4. Registreeri võti oma arvutis

Võtit ei kirjutata kuhugi faili ega Claude'i seadetesse. See salvestatakse operatsioonisüsteemi paroolihoidlasse (Macis Keychain, Windowsis kasutajaga seotud krüpteering) ühe käsuga, mille Claude ise sulle ette ütleb.

1. Alusta Claude Desktopis uut vestlust ja küsi: **Kes on sel nädalal puhkusel?** Luba Claude'il tööriista kasutada.
2. Vastus on veateade, mis algab sõnadega `No BambooHR API key is enrolled on this machine. Run:` ja mille järel on pikk käsk jutumärkides. Kopeeri see käsk tervikuna (koos jutumärkidega, kuni sõnani `enroll`).
3. Ava terminal:
   - **Mac**: vajuta `Cmd + tühik`, kirjuta `Terminal`, vajuta Enter.
   - **Windows**: vajuta Windowsi klahvi, kirjuta `PowerShell`, vajuta Enter.
4. Kleebi käsk terminali ja vajuta Enter.
5. Käsk küsib kõigepealt ettevõtte aadressi esimest osa (`firma`). Kirjuta see ja vajuta Enter.
6. Seejärel küsib käsk API-võtit. Kleebi võti ja vajuta Enter. **Võtit ei kuvata ekraanil**, ka mitte tärnidena. See on tahtlik.
7. Terminal kinnitab, et võti on salvestatud paroolihoidlasse, ja näitab, kuhu seaded kirjutati. Terminali võib sulgeda.

## 5. Proovi

Küsi Claude'ilt uuesti: **Kes on sel nädalal puhkusel?** Kui saad nimekirja, kõik töötab.

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
| „No BambooHR API key is enrolled" | Tee samm 4 uuesti: kopeeri teatest käsk ja käivita see terminalis. |
| Viga 401 / API-võti | Võti on vale või tühistatud. Loo BambooHR-is uus võti ja tee samm 4 uuesti. |
| Viga 403 / õigused | Sinu BambooHR-i õigused ei luba neid andmeid näha. Räägi administraatoriga. |
| „excluded by policy" | Küsitud väli või tabel on tundlik ja tööriist ei näita seda kellelegi. |
| „above the per-call limit" | Küsi väiksema osakonna, lühema ajavahemiku või konkreetse inimese kohta. |
| Ei leia puhkuse liiki | Claude näitab valikuid. Küsi IT-lt, et registreerimiskäsule lisataks `--vacation-type "Puhkus"` õige nimega. |
| Osakonnast ei leita kedagi | Osakond pole kataloogis nähtav. Räägi administraatoriga. |
| Terminal ütleb, et käsku ei leitud | Kopeeri käsk uuesti tervikuna, koos mõlema jutumärkides teega. |

## Võti ja eemaldamine

Kui võti on lekkinud, kustuta see BambooHR-is jaotises **API Keys** ja loo uus, seejärel tee samm 4 uuesti. Tööriista eemaldamiseks vajuta Claude Desktopis **Settings → Extensions → BambooHR → Uninstall** ja kustuta võti ka BambooHR-is. Kui soovid võtme arvutist eemaldada, aga laienduse alles jätta, käivita sama käsk, mida kasutasid sammus 4, asendades lõpus sõna `enroll` sõnaga `unenroll`.

## Uuendamine

Tee uuel `.mcpb` failil topeltklõps ja paigalda uuesti. Võti ja seaded jäävad alles; sammu 4 ei ole vaja korrata.

## Kõik tööriistad

Täieliku tööriistade nimekirja, turvameetmete kirjelduse ja rohkem näidisküsimusi leiad failist [../README.et.md](../README.et.md).
