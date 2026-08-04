# Plan testów manualnych — Scientific Context Notes

_Wersja pod testy: **v1.2.2** · plan z 2026-08-04. Aktualizuj razem z funkcjami; testy
automatyczne (363 unit + 33 e2e) pokrywają logikę — ten plan pokrywa to, czego automat nie
może: natywne uprawnienia Chrome, prawdziwe strony wydawców, gesty użytkownika i odczucie
całej podróży._

---

## 0. Przygotowanie środowiska

1. **Świeży profil Chrome** (`chrome://settings` → nowy profil albo `--user-data-dir=/tmp/cn-test`),
   żeby zaczynać od zera: bez uprawnień, bez IndexedDB, bez flag onboardingu.
2. Zbuduj i załaduj: `npm ci && npm run build`, potem `chrome://extensions` → Developer mode →
   _Load unpacked_ → `dist/`. Alternatywnie zip z release'a.
3. Przypnij ikonę (puzzle → pin), będzie potrzebna do testów `activeTab`.

### Konsole DevTools — gdzie co widać

| Powierzchnia | Jak otworzyć konsolę | Co tam trafia |
| --- | --- | --- |
| **Service worker** (router, migracje, fetch DOI) | `chrome://extensions` → Context Notes → _Inspect views: service worker_ | błędy routera, logi `[context-notes]`, zakładka **Network** pokazuje żądania do `doi.org` |
| **Panel boczny** | prawy klik wewnątrz panelu → _Inspect_ | błędy renderowania panelu, odrzucone `sendMessage` |
| **Dashboard / Samouczek / Czytnik PDF** | zwykłe F12 na karcie | błędy widoków, błędy pdf.js |
| **Annotator (content script)** | F12 na stronie artykułu → Console → selektor kontekstu u góry → **Scientific Context Notes** | błędy kotwiczenia; sprawdź `document.getElementById('context-notes-annotator')` |

### Komendy diagnostyczne (wklejaj w konsoli service workera)

```js
// Stan uprawnień — czy jest stała zgoda *://*/* i które originy per-site:
chrome.permissions.getAll().then(console.log)

// Zarejestrowane content scripty (auto-wstrzykiwanie per witryna):
chrome.scripting.getRegisteredContentScripts().then(console.log)

// Flagi onboardingu i aktywny projekt:
chrome.storage.local.get(null).then(console.log)

// Szybki odczyt danych przez router (jak robią to powierzchnie):
chrome.runtime.sendMessage({type: 'projects/list'}).then(console.log)
chrome.runtime.sendMessage({type: 'documents/listByProject', projectId: '<ID>'}).then(console.log)
```

**IndexedDB**: DevTools (na dowolnej stronie rozszerzenia) → Application → IndexedDB →
**`context-notes`** — tabele projects / documents / annotations / references / citationStyles /
customBaseStyles / users / activity / commentThreads / files. To ostateczne źródło prawdy, gdy
UI i toasty się nie zgadzają.

### Dane testowe (sprawdzone na żywo)

| Cel | URL / wartość |
| --- | --- |
| Artykuł z pełnymi tagami + dublujące się `dc.creator` | `https://www.mdpi.com/2072-4292/8/2/153` |
| Artykuł z numerem artykułu zamiast stron | `https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.120.108701` |
| Preprint (pułapka „journal: arXiv.org") | `https://arxiv.org/abs/1705.00504` |
| Strona wyników (guardrail) | `https://scholar.google.com/scholar?q=urban+heat+island` |
| Artykuł SAGE (zgłoszenie terenowe) | `https://journals.sagepub.com/doi/10.1177/18344909211038105` |
| DOI do importu/wzbogacania | `10.1002/wcc.21` |
| PDF do czytnika | `https://arxiv.org/pdf/1705.00504` (pobierz lokalnie) |

---

## Smoke test — 10 minut

Przejdź podróż w naturalnej kolejności; jeśli cokolwiek zgrzyta, wejdź w odpowiednią sekcję niżej.

1. Instalacja → samouczek otwiera się sam (S1.1).
2. Panel na artykule MDPI → podgląd metadanych → **File into project** → toast wzbogacenia (S3.1).
3. Nowa karta (APS) → stan „No access…" → **Allow reading pages** → podgląd wraca (S2.2).
4. Zaznacz zdanie → pasek **Highlight/Note** od razu → Highlight (S4.1).
5. Status źródła → In review (S6.2). 6. **Cite** na wierszu → cytowanie w schowku (S7.1).
7. **Copy bibliography** → wpisy z odwróconymi nazwiskami i volume/pages (S7.2).
8. Dashboard (przycisk w panelu) → liczniki zgadzają się bez przeładowania (S10.1).
9. Team → Sync → Export → Import tego samego pliku → podgląd „all zero" → Apply (S9.3).

---

## S1. Instalacja i onboarding

### S1.1 Pierwsza instalacja otwiera samouczek
- **Kroki**: świeży profil → Load unpacked.
- **Oczekiwane**: automatycznie otwiera się karta „Five moves and it makes sense". Dokładnie raz.
- **Potencjalne problemy**: samouczek otwiera się też przy każdej aktualizacji (ma otwierać się
  tylko przy `reason === 'install'`); pusta karta = błąd ładowania assetów.
- **Debug**: konsola SW — błąd przy `chrome.tabs.create`; sieć karty samouczka (F12) — 404 na
  `onboarding-*.css/js` oznacza problem builda.

### S1.2 Przyciski samouczka
- **Kroki**: kliknij kolejno _Open the side panel_, _Open the dashboard_, _Site access settings_,
  _I'll explore on my own_.
- **Oczekiwane**: panel otwiera się przy bieżącej karcie; dashboard w nowej karcie; strona
  `chrome://extensions/?id=…` z sekcją Site access; ostatni przycisk zamyka kartę.
- **Potencjalne problemy**: _Open the side panel_ nic nie robi → API `sidePanel.open` odrzuciło
  wywołanie (gest?); zamknięcie karty nie działa, gdy kartę otwarto ręcznie z historii.
- **Debug**: konsola karty samouczka — wyjątek z `chrome.sidePanel.open`.

### S1.3 Aktualizacja nie otwiera samouczka
- **Kroki**: `chrome://extensions` → ⟳ (Reload) przy rozszerzeniu.
- **Oczekiwane**: żadna nowa karta się nie otwiera.
- **Debug**: jeśli się otwiera — SW dostał `reason: 'update'|'chrome_update'` i błędnie odpalił
  `tabs.create`; sprawdź warunek w `service-worker.ts`.

### S1.4 Checklista „Getting started"
- **Kroki**: otwórz panel na świeżym profilu; obserwuj listę; kliknij ✕; przeładuj panel.
- **Oczekiwane**: 5 kroków, wszystkie ○, pierwszy pogrubiony z jednozdaniową podpowiedzią;
  po ✕ znika i **nie wraca po przeładowaniu**; po wykonaniu wszystkich kroków znika sama.
- **Potencjalne problemy**: kroki odhaczają się bez wykonania (złe liczenie z danych);
  „Copy a citation" nie odhacza się mimo kopiowania (flaga w storage nie zapisana).
- **Debug**: `chrome.storage.local.get(null)` → `gettingStartedDismissed`, `hasCopiedCitation`;
  liczby wejściowe: `documents/listByProject`, `annotations/listByProject`.

## S2. Dostęp do kart (activeTab / stała zgoda) — sedno zgłoszeń terenowych

### S2.1 Jednorazowy dostęp z ikony
- **Kroki**: świeży profil (bez stałej zgody), otwórz artykuł MDPI, kliknij ikonę → panel.
- **Oczekiwane**: karta „On this page" pokazuje metadane artykułu (activeTab przyznane).
- **Debug**: `chrome.permissions.getAll()` — brak originów; a scan działa → to activeTab.

### S2.2 Nawigacja unieważnia dostęp → uczciwy stan + zgoda
- **Kroki**: nie zamykając panelu przejdź na inną stronę / otwórz nową kartę z artykułem.
- **Oczekiwane**: karta pokazuje **„No access to this tab yet"** z przyciskiem
  **Allow reading pages** (nigdy „No page metadata", gdy artykuł jest otwarty!). Klik →
  natywny prompt Chrome → po zgodzie podgląd ładuje się od razu, toast potwierdza.
- **Potencjalne problemy**: prompt się nie pojawia (wywołanie poza gestem — regresja);
  po zgodzie podgląd nie wraca (brak `refreshPreview` po grancie).
- **Debug**: po zgodzie `chrome.permissions.getAll()` → `origins: ["*://*/*"]`. Konsola panelu —
  `ScanAccessError` przed zgodą to stan oczekiwany, po zgodzie nie może występować.

### S2.3 Odmowa zgody
- **Oczekiwane**: toast tłumaczy zachowanie jednorazowe; przycisk zostaje, można spróbować znowu.

### S2.4 Cofnięcie w Site access
- **Kroki**: `chrome://extensions` → Details → Site access → usuń dostęp / przestaw na
  „On click"; wróć na stronę z zarejestrowanym annotatorem.
- **Oczekiwane**: panel wraca do stanu „No access…"; wpis auto-wstrzykiwania dla cofniętej
  witryny **znika sam** (listener `permissions.onRemoved`).
- **Debug**: `chrome.scripting.getRegisteredContentScripts()` — po cofnięciu nie może zostać
  wpis `annotator-…` dla tej witryny (osierocony wpis = regresja).

## S3. Capture i metadane

### S3.1 Artykuł z DOI + wzbogacenie (MDPI)
- **Kroki**: panel na MDPI → sprawdź podgląd → **File into project**.
- **Oczekiwane**: podgląd „ARTICLE · METADATA EXTRACTED", **3** autorów (nie 6!), rok, DOI;
  po zapisie toast „Filed into project", chwilę później „Metadata completed from the DOI
  registry"; w Dashboard → Documents → Edit widać volume **8**, issue **2**, pages **153**.
- **Potencjalne problemy**: 6 autorów = regresja dedupu `citation_author`/`dc.creator`;
  brak drugiego toastu offline'owo jest OK (wzbogacenie jest best-effort).
- **Debug**: SW Network — żądanie `https://doi.org/10.3390%2Frs8020153` z nagłówkiem
  `Accept: application/vnd.citationstyles.csl+json`; IndexedDB → documents → metadata.

### S3.2 arXiv jako preprint
- **Oczekiwane**: podgląd bez „journal: arXiv.org"; w referencji `genre: preprint`,
  `archive: arXiv` (IndexedDB → references → cslData).

### S3.3 Dedup po DOI
- **Kroki**: po S3.1/S3.2 wejdź na stronę APS (ten sam DOI co arXiv) → File.
- **Oczekiwane**: toast „Already filed — reused existing source"; liczba źródeł bez zmian.

### S3.4 Guardrail stron wyszukiwania
- **Kroki**: panel na SERP-ie Google Scholar.
- **Oczekiwane**: „Search results page — open an article from these results to file it",
  przycisk nieaktywny („Nothing to file here"). To samo dla `google.com/search`, PubMed z
  `?term=`, arXiv `/list/`.
- **Potencjalne problemy**: fałszywy alarm na stronie artykułu z `?q=` w URL — zgłoś, guardrail
  ma przepuszczać strony deklarujące `citation_title`/DOI.

### S3.5 Zwykła strona WWW (bez DOI)
- **Oczekiwane**: typ „Web page", zapis działa, **bez** próby wzbogacania (Network SW pusty).

### S3.6 Edycja metadanych + Refresh from DOI
- **Kroki**: Dashboard → Documents → **Edit** na wierszu → zmień tytuł/rok → Save; ponownie
  Edit → **Refresh from DOI**.
- **Oczekiwane**: zapis widoczny natychmiast w tabeli i w cytowaniach; Refresh nadpisuje pola
  wartościami rejestru, zachowując pola, których rejestr nie ma.
- **Debug**: błąd „No metadata found for that DOI" = literówka w DOI; sprawdź w SW Network
  status odpowiedzi doi.org (404 vs 200-HTML vs 200-JSON).

## S4. Adnotacje na stronach WWW

### S4.1 Kolejność naturalna: zaznacz → aktywuj
- **Kroki**: strona artykułu (ze stałą zgodą annotator aktywuje się sam — patrz S4.2);
  bez stałej zgody: zaznacz zdanie, dopiero potem kliknij **Annotate this page**.
- **Oczekiwane**: pasek **Highlight / Note pojawia się od razu** przy istniejącym zaznaczeniu —
  bez powtarzania zaznaczenia.
- **Debug**: brak paska → w konsoli strony (kontekst Scientific Context Notes) sprawdź
  `document.getElementById('context-notes-annotator')` — `null` znaczy, że wstrzyknięcie nie
  doszło (uprawnienia); element jest, paska brak → zaznaczenie było puste/zwinięte.

### S4.2 Auto-aktywacja przy stałej zgodzie
- **Kroki**: (po S2.2) otwórz dowolny artykuł, po prostu zaznacz tekst.
- **Oczekiwane**: pasek pojawia się bez klikania czegokolwiek; komunikat pustej listy w panelu
  brzmi „select text on the page…" (bez zgody brzmi „press Annotate this page…").

### S4.3 Highlight + trwałość + rejestracja per witryna
- **Kroki**: Highlight zdania → przeładuj stronę.
- **Oczekiwane**: przy pierwszej adnotacji na witrynie może pojawić się prompt per-origin
  (bez stałej zgody); podświetlenie **odmalowuje się po przeładowaniu** w tym samym miejscu;
  `getRegisteredContentScripts()` pokazuje wpis dla originu.
- **Potencjalne problemy**: przesunięte overlaye po zmianie rozmiaru okna → zgłoś z zrzutem;
  podświetlenie „gubi się" po A/B teście treści strony — trafia do sekcji
  „Couldn't place on this page" w panelu (to zachowanie poprawne, nie błąd).

### S4.4 Note, edycja, status, Jump to, usuwanie
- **Kroki**: Note na innym zdaniu → w panelu wpisz treść (autozapis) → zmień status na
  Accepted → **Jump to** → ✕.
- **Oczekiwane**: po **Note** kursor ląduje **od razu** w polu tekstowym świeżej karty w panelu
  (bez klikania — jak w czytniku PDF); treść przeżywa przeładowanie panelu; Jump przewija
  stronę i błyska podświetleniem; ✕ usuwa overlay natychmiast.
- **Debug**: autozapis jest debounced 500 ms — zamknięcie panelu w < 0,5 s od wpisania może
  zgubić ostatnie znaki (znany kompromis).

### S4.5 SPA i strony zakazane
- **Kroki**: strona z nawigacją client-side (np. dokumentacja SPA) — dodaj notatkę, przejdź
  linkiem wewnętrznym i wróć. Osobno: spróbuj **Annotate this page** na `chrome://extensions`.
- **Oczekiwane**: notatki znikają/wracają zgodnie z URL-em bez przeładowania; na stronie
  zakazanej toast „Chrome doesn't allow annotating this page" (nigdy cisza).

## S5. Czytnik PDF

### S5.1 Add PDF i render
- **Kroki**: Dashboard → Documents → **Add PDF** → lokalny plik arXiv.
- **Oczekiwane**: czytnik w nowej karcie, strony renderują się, licznik stron się zgadza.
- **Debug**: pusta strona → F12 czytnika: błędy pdf.js (worker 404 = problem builda).

### S5.2 Zakreślenie tekstu / S5.3 Region / S5.4 trwałość
- **Kroki**: zaznacz tekst → **Highlight**; tryb **Region** → przeciągnij prostokąt →
  **Anchor region**; dopisz notatkę i status w szynie; przeładuj kartę; zmień zoom.
- **Oczekiwane**: obie kotwice odmalowują się po przeładowaniu **i przy innym zoomie**
  (współrzędne to ułamki strony); notatka i status zachowane.
- **Potencjalne problemy**: > 50 MB pliku → odmowa z komunikatem (limit celowy); bardzo duży
  PDF może uderzyć w limit komunikatu (~64 MB po base64) — zgłoś rozmiar.

## S6. Lista czytelnicza i workflow

- **S6.1 Szukajka**: filtruje po tytule/autorze/DOI na żywo.
- **S6.2 Menu statusu**: otwórz z chipa; strzałki ↑↓ + Enter działają (pełna klawiatura);
  wybór wstecz (Analysed → To read) możliwy.
- **S6.3 Wiersz otwiera źródło**: klik w wiersz = nowa karta z artykułem (dla PDF-ów bez URL —
  kopiuje cytowanie); **Cite** to osobny przycisk.
- **S6.4 Kanban**: przeciągnij kartę między kolumnami; potem to samo klawiaturą (fokus na
  karcie, ← →). Licznik kolumn i pasek postępu aktualizują się.
- **Debug**: rozjazd liczników między panelem a dashboardem → patrz S10.

### S6.5 Projekty
- **Kroki**: nagłówek panelu → menu projektu → **+ New project**; zapisz stronę w nowym
  projekcie; przełącz projekt w dashboardzie (przełącznik nad nawigacją); wróć do panelu.
- **Oczekiwane**: zapis ląduje w projekcie widocznym w nagłówku (nigdy „w tle" w innym);
  panel i dashboard **współdzielą** aktywny projekt — zmiana w jednym jest widoczna w drugim;
  listy, Kanban i bibliografia pokazują wyłącznie dane aktywnego projektu.
- **Debug**: `chrome.storage.local.get(null)` → klucz aktywnego projektu; rozjazd = jedna z
  powierzchni nie odczytała wartości po zmianie.

## S7. Cytowania i style

### S7.1 In-text / Bibliography po zapisie
- **Oczekiwane**: przyciski aktywne dopiero po zapisaniu strony; schowek dostaje np.
  `(Azevedo et al., 2016)` — **samo nazwisko**, nie pełne imię.

### S7.2 Poprawność APA (checkpointy z audytu)
- **Kroki**: Copy bibliography przy ≥ 2 źródłach.
- **Oczekiwane**: nazwiska odwrócone (`Azevedo, J.`), sortowanie po nazwisku, `8(2), 153`
  po tytule czasopisma, DOI jako URL. **Czerwone flagi** (regresje): podwójni autorzy,
  „(n.d.)" przy znanym roku, brak volume/pages, sortowanie po imieniu.

### S7.3 Harvard Solent
- **Kroki**: Citation styles → New style / edytor → baza **Harvard — Solent University** →
  ustaw jako domyślny → Copy bibliography.
- **Oczekiwane**: nazwiska WERSALIKAMI: `AZEVEDO, J., L. CHAPMAN and C. MULLER, 2016. …` —
  to cecha stylu, nie błąd.

### S7.4 Edytor stylów + dirty guard
- **Kroki**: Full editor → zmień „Maximum authors" → obserwuj podgląd → **bez zapisu** kliknij
  ← Citation styles.
- **Oczekiwane**: podgląd zmienia się na żywo; przy wyjściu pytanie o porzucenie zmian;
  „OK" **naprawdę przywraca** poprzednie reguły (sprawdź wracając do edytora); Save → brak
  pytania przy wyjściu.

### S7.5 Import/eksport .csl i import DOI
- **Kroki**: Import .csl (dowolny styl z repozytorium CSL) jako baza; Export .csl; References →
  Import → DOI `10.1002/wcc.21`.
- **Oczekiwane**: import DOI pyta o uprawnienie do doi.org (gest!), po zgodzie wiersz referencji
  z pełnymi danymi; eksport pobiera plik `.csl`.
- **Debug**: SW Network dla przebiegu DOI; błędy parsowania .csl wyświetlają się toastem.

## S8. Team

- **S8.1 Invite**: e-mail wymagany (samo imię → walidacja); po zaproszeniu członek na liście
  z rolą; baner „Roles are advisory" widoczny.
- **S8.2 Activity**: każda operacja z S3–S7 zostawia wpis z diffem `stary → nowy`; filtry
  Sources/Annotations/References działają.
- **S8.3 Komentarze**: Annotations → **Discuss** → wpisz → **Post** → wątek w Team → Comments
  (z cytatem kotwicy) → Reply → Resolve. *Znany papercut*: Post bywał przykryty innym
  elementem — jeśli klik nie działa, zgłoś pozycję scrolla i zrzut.
- **S8.4 Kaskada**: usuń dokument mający notatki i wątek → wątek znika z Comments (nie zostaje
  osierocony).

## S9. Sync / snapshoty

- **S9.1 Eksport plain**: plik `nazwa-projektu-RRRR-MM-DD.json`, czytelny JSON; **nie zawiera**
  użytkowników spoza projektu (Application → podejrzyj plik).
- **S9.2 Eksport szyfrowany**: z hasłem → `.enc.json`; w pliku `ciphertext`, brak `payload`.
  Import ze złym hasłem → dokładnie „Wrong password, or the file has been altered".
- **S9.3 Import + idempotencja**: import własnego eksportu → podgląd pokazuje zera/N; drugi
  import tego samego pliku → **wszystkie zera** (nic nie duplikuje).
- **S9.4 Druga maszyna**: drugi profil Chrome → import → projekt kompletny; Twoja nazwa
  użytkownika w profilu docelowym **nie** zostaje nadpisana nazwą eksportera.
- **S9.5 Plik uszkodzony**: zmień ręcznie 1 znak w `ciphertext` → import odrzucony tym samym
  komunikatem co złe hasło; plik z `"iterations": 1000000000` → natychmiastowa odmowa
  („key-derivation header"), bez zawieszenia CPU.
- **Debug**: konsola SW przy imporcie — komunikaty walidatora nazywają dokładnie chore pole
  (`source 3's status is not one of…`).

## S10. Świeżość między powierzchniami

- **S10.1**: panel + dashboard otwarte obok siebie → File w panelu → liczniki i tabele
  dashboardu aktualizują się **bez przeładowania** (≈ 0,5 s).
- **S10.2**: adnotacja w czytniku PDF → badge „Annotations" w dashboardzie rośnie sam.
- **S10.3**: otwarty **edytor stylów** z niezapisanymi zmianami + zapis z innej powierzchni →
  edytor **nie** przeładowuje się i nie gubi zmian (odświeżenie jest wstrzymane na tej trasie).
- **Debug**: w konsoli panelu/dashboardu nasłuch:
  `chrome.runtime.onMessage.addListener(m => m?.control === 'data/changed' && console.log(m))` —
  po każdej mutacji ma przyjść `{control:'data/changed', changedBy:'<typ>'}`.

## S11. Podpowiedzi podróży (nudges)

- **Kroki**: świeży profil, wykonuj kroki checklisty po kolei; obserwuj toasty ~3 s po
  toastach potwierdzenia.
- **Oczekiwane**: po zapisie → podpowiedź o adnotacji; po 1. adnotacji → o statusie; po zmianie
  statusu → o Cite; po 1. cytowaniu → o bibliografii/Sync. Każda **raz na sesję**; po
  zamknięciu checklisty (✕) — **żadna**.

---

## Raportowanie wyniku

Dla każdego testu zapisz: `ID · PASS/FAIL · wersja · profil (świeży/istniejący) · URL strony ·
treść toastu/błędu · zrzut ekranu · wyjątki z odpowiedniej konsoli (sekcja 0)`. Przy błędach
danych dołącz zrzut z IndexedDB (rekord, nie cały store). Regresje cytowań zgłaszaj z pełnym
tekstem skopiowanej bibliografii — to najszybszy artefakt do diagnozy.
