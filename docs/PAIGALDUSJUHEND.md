# BambooHR Claude'is

Küsi Claude'ilt töötajate andmete, kohandatud väljade ja tabelite, koolituste ning puhkuste kohta. Tööriist ainult loeb, BambooHR-is ei muutu midagi.

## Vajad

- Claude Desktop (Windows või Mac) ja tasulist Claude'i kontot
- BambooHR-i kasutajat
- faili `bamboohr-mcp.mcpb`: laadi alla [siit](https://github.com/mikkmihkel/bamboohr-mcp/releases/latest/download/bamboohr-mcp.mcpb) või küsi IT-lt

## 1. Loo API-võti

BambooHR-is: pilt all vasakul → **API Keys** → **Add New Key** → nimeks `Claude` → **Generate Key**. Kopeeri võti kohe, seda näidatakse ainult korra. Hoia seda nagu parooli.

## 2. Leia ettevõtte aadress

BambooHR avaneb aadressil `firma.bamboohr.com`. Vajad ainult esimest osa: `firma`.

## 3. Paigalda

1. Tee failil `bamboohr-mcp.mcpb` topeltklõps. Avaneb Claude Desktop.
2. Vajuta **Install**.
3. Paigaldusaken on ingliskeelne ja küsib kolme asja:
   - **BambooHR API key** — kleebi siia API-võti.
   - **Company subdomain** — ettevõtte aadressi esimene osa, näiteks `firma`.
   - **Vacation time-off type (optional)** — puhkuse liigi nimi, jäta tühjaks.
4. Vajuta **Save**.

Kui topeltklõps ei tööta: Claude Desktop → **Settings → Extensions → Advanced settings → Install Extension** → vali fail.

## 4. Proovi

Alusta uut vestlust ja küsi: **Kes on sel nädalal puhkusel?** Luba Claude'il tööriista kasutada. Kui saad nimekirja, kõik töötab.

## Näidisküsimused

- Kes on järgmisel nädalal eemal?
- Palju puhkust on Mari Maasikal kasutamata?
- Kellel on puhkust veel planeerimata?
- Kes pole sel aastal võtnud 14-päevast järjestikust puhkust?
- Millised taotlused ootavad oktoobris kinnitamist?
- Sama ülevaade eelmise aasta kohta.
- Mis on Anna Tamme jalanumber?
- Millal Mart Mets tööle asus?
- Kõigi Tallinna töötajate jalanumbrid talvesaabaste tellimiseks.
- Kes on meil töötanud üle 10 aasta?
- Kas Anna on esmaabikoolituse läbinud?
- Millised pühad on sel aastal veel ees?

## Hea teada

- Näed sama, mida BambooHR-is. Kui keegi puudub, on põhjus sinu õigustes.
- Kõigi töötajate ülevaade võtab kuni minuti.
- 14 päeva loetakse kalendripäevades ühe aasta sees. Nädalavahetusega eraldatud taotlused on kaks puhkust.

## Kui ei tööta

| Probleem | Lahendus |
|---|---|
| Seadistus puudub | **Settings → Extensions → BambooHR → Configure**, täida väljad |
| Viga 401 / API-võti | Võti on vale. Loo uus ja sisesta uuesti |
| Viga 403 / õigused | Sinu BambooHR-i õigused ei luba neid andmeid näha. Räägi administraatoriga |
| Ei leia puhkuse liiki | Claude näitab valikuid. Kirjuta õige nimi seadetes väljale **Vacation time-off type** |
| Osakonnast ei leita kedagi | Osakond pole kataloogis nähtav. Räägi administraatoriga |

## Võti ja eemaldamine

Seaded: **Settings → Extensions → BambooHR**. Kui võti on lekkinud, kustuta see BambooHR-is ja loo uus. Eemaldamiseks vajuta **Uninstall** ja kustuta võti ka BambooHR-is.

## Uuendamine

Tee uuel `.mcpb` failil topeltklõps ja paigalda uuesti. Seaded jäävad alles.

## Kõik tööriistad

Täieliku tööriistade nimekirja ja rohkem näidisküsimusi leiad failist [../README.et.md](../README.et.md).
