# Wywiad z developerem — Scientific Context Notes

> Odpowiedzi oparte na faktycznym kodzie, architekturze i historii projektu (stan: gałąź `main`
> v0.26.0 + gałąź `feat/web-annotation`, merge-ready jako v0.27.0). Decyzje redakcyjne i osobiste
> zostały podjęte i wkomponowane. Świadomie otwarte pozostają tylko dwa elementy: **weryfikacja
> szkicu anegdoty** (sekcja 1, oznaczony `DO WERYFIKACJI`) oraz **opcjonalny case study z realnym
> projektem** (sekcja 16), do dodania po pierwszych testach.

---

## 1. Geneza projektu
Projekt powstał z **własnego bólu badawczego**. Jako student **kierunku Computer Science na Solent
University**, zbierając materiały do swojej pracy, zauważyłem konkretną potrzebę: przy dużej liczbie
źródeł ginie powiązanie między *tym, co zaznaczyłem*, a *skąd to pochodzi* i *po co mi to było*.
Zakładki, osobne notatki i menedżer bibliografii to trzy oddzielne światy, które trzeba ręcznie
spinać — a przy powrocie do materiału po czasie kontekst zwyczajnie wyparowuje. Narzędzie wyrosło
wprost z mojego procesu pracy z dużą liczbą źródeł.

_Spójne z architekturą:_ cała domena jest zbudowana tak, by notatka nigdy nie „odkleiła się" od
miejsca, z którego pochodzi — kotwiczenie do fragmentu, referencja CSL powiązana z dokumentem, feed
aktywności rejestrujący drogę. To bezpośrednie odwzorowanie tego bólu w kodzie.

**Anegdota otwierająca (`DO WERYFIKACJI`):** Przy jednym z przeglądów literatury wróciłem po dwóch
tygodniach do zapisanego cytatu i nie potrafiłem odtworzyć, z której z kilkunastu otwartych kart
pochodził ani dlaczego wydał mi się ważny — spędziłem pół wieczora na ponownym wyszukiwaniu tego
samego fragmentu w źródle. Wtedy dotarło do mnie, że problemem nie jest brak notatek, tylko utrata
połączenia notatki ze źródłem.
_(❗ DO WERYFIKACJI — podmień na własną, prawdziwą sytuację lub potwierdź ten szkic.)_

## 2. Główny problem użytkownika
- **Jednym zdaniem:** narzędzie utrzymuje **kontekst i pochodzenie** każdego cytatu — od zaznaczonego
  fragmentu strony/PDF-a, przez status w procesie, po gotowe cytowanie — w jednym, lokalnym miejscu.
- **Co się traci przy zakładkach + osobnych notatkach + menedżerze bibliografii:** rozjazd trzech
  światów. Zakładka nie wie, *co* w źródle było ważne; notatka nie wie, *skąd* pochodzi; menedżer
  bibliografii nie wie, *czy* i *jak* źródło zostało wykorzystane. Powrót do „dlaczego to
  zaznaczyłem" po tygodniach bywa niemożliwy.
- **Najważniejszy problem:** utrata kontekstu/pochodzenia (provenance). Rozproszenie narzędzi, brak
  kontroli statusu i błędy cytowań to problemy **wtórne**, wynikające z tego samego korzenia — brak
  jednego obiektu, który trzyma wszystko razem.
- **Konsekwencje:** strata czasu na odtwarzanie kontekstu, błędne/nieodtwarzalne cytaty, trudny
  powrót do projektu, a w efekcie niższa wiarygodność wniosków (nie da się prześledzić, na czym się
  opierają).

## 3. Docelowy użytkownik
**Główny odbiorca: studenci** oraz — szerzej — **osoby pracujące intensywnie na cudzych źródłach**
(kwerendy, prace dyplomowe, przeglądy literatury, research oparty na wielu cytowaniach). To grupa, do
której sam należę i której problem znam z pierwszej ręki.

_Spójne z produktem:_ statusy procesu przeglądu, prawdziwy CSL, obsługa nietypowych typów (dokumenty
prawne, wnioski FOI) i czytnik PDF pasują do **pojedynczego badacza pracującego z literaturą**;
naturalnie rozszerza się to na dziennikarzy, analityków/OSINT i prawników, którzy również żyją z
cudzych źródeł. Zespół jest wspierany, ale **asynchronicznie** — przez przenośny snapshot, nie serwer
(patrz sekcja 11). Na start celuję w pojedynczego użytkownika (siebie i kolegów ze studiów).
- **Próg wartości:** narzędzie zaczyna się opłacać, gdy projekt ma ~kilkanaście+ źródeł i trwa na
  tyle długo, że powrót do niego wymaga odtworzenia kontekstu.
- **Doświadczenie z menedżerami bibliografii:** nie jest wymagane — import DOI i gotowe style CSL
  działają bez znajomości XML; edytor reguł jest dla zaawansowanych, ale opcjonalny.

## 4. Najważniejszy workflow
Idealny przebieg (zakotwiczony w faktycznym UI):
1. **Instalacja** → kliknięcie ikony otwiera **panel boczny** (główna powierzchnia). Automatycznie
   zakładany jest projekt „My Research".
2. **Dodanie strony:** na artykule panel pokazuje „On this page" → **File into project** archiwizuje
   ją jako dokument + referencję (metadane wyciągane ze strony; deduplikacja).
3. **Dodanie PDF-a:** w dashboardzie **Add PDF** (upload) lub **Open in reader** dla PDF-a z URL →
   otwiera wbudowany czytnik.
4. **Adnotacja (web):** zaznaczasz tekst na stronie → pasek **Highlight/Note**; notatka kotwiczy się
   do fragmentu i edytujesz ją w panelu bocznym („Notes on this page"). **Adnotacja (PDF):**
   zaznaczenie tekstu lub region → Highlight/Note w czytniku.
5. **Powrót do fragmentu:** klik notatki → przewinięcie i podświetlenie zakotwiczonego miejsca
   (web i PDF). Jeśli treść się zmieniła i kotwica nie trafia — dostajesz sygnał (patrz sekcja 7).
6. **Status źródła:** zmieniasz go w panelu/na Kanbanie (To Read → In Review → Analysed → Used in
   Output); każda zmiana ląduje w feedzie aktywności.
7. **Cytowanie/bibliografia:** w dowolnym momencie kopiujesz cytat in-text lub kompilujesz
   bibliografię przez prawdziwy citeproc (styl konfigurowalny).
8. **Powrót po tygodniach:** dashboard pokazuje stan projektu (Kanban, feed aktywności, liczniki),
   a każda notatka wciąż wskazuje swój dokładny fragment źródła — kontekst nie wyparował.

## 5. Zakres obecnej wersji (ważne — bez przeceniania)
- **W pełni gotowe (na `main`, v0.26.0):**
  - Archiwizacja stron do projektów + ekstrakcja metadanych + deduplikacja.
  - **Adnotacje PDF** (highlight tekstu, region, notatka, status, usuwanie) w wbudowanym czytniku;
    weryfikacja cytatu względem warstwy tekstowej i oznaczanie „Moved?" po podmianie PDF-a.
  - **Cytowania i bibliografia** przez prawdziwy citeproc-js, style CSL (patrz sekcja 9).
  - **Edytor stylów CSL** z silnikiem reguł + import własnego `.csl` jako stylu bazowego.
  - **Snapshot** eksport/import/scalanie z opcjonalnym szyfrowaniem.
  - Dashboard: Kanban, dokumenty, adnotacje, referencje, style, zespół (feed/komentarze/członkowie/sync).
  - Dodawanie/edycja/usuwanie referencji; usuwanie dokumentów z kaskadą (v0.26.0).
- **Właśnie ukończone, wchodzi jako v0.27.0 (gałąź `feat/web-annotation`, merge-ready):**
  - **Adnotacje na zwykłych stronach WWW** — do v0.26.0 logika kotwiczenia istniała, ale **nie była
    podłączona**; teraz działa: zaznacz → highlight/notatka, podświetlenia wracają po ponownej
    wizycie, notatki w panelu bocznym. **Uwaga do artykułu:** w *ostatnim wydaniu* (v0.26.0) ta
    funkcja jeszcze nie była dostępna — prezentuj ją jako „właśnie dostarczoną / w v0.27.0", nie jako
    od dawna obecną.
- **Zaimplementowane, ale świadomie NIEpodłączone do UI / ograniczone:**
  - Import referencji z **Zotero / BibTeX / RIS** — w UI jako „Soon" (działa tylko **import po DOI**).
  - Tryb sync **self-hosted backend** — pokazany jako „Unavailable" (świadomie poza zakresem).
  - Funkcja **sekcji** dokumentu — model ją zna, ale brak UI przypisania (backlog audytu).
  - Dla web-adnotacji: **kolory, tagi, skrót klawiszowy, zarządzanie zaanotowanymi witrynami** —
    odroczone do kolejnych wydań.
- **Czego NIE przedstawiać jako gotowe:** real-time sync / obecność współpracowników (poza zakresem
  z zasady), backend, import z Zotero/BibTeX/RIS, kolory/tagi web-adnotacji.

## 6. Model projektu i danych
- **Dlaczego centralny jest projekt, nie notatka/dokument:** bo jednostką badania jest *dociekanie*,
  nie pojedynczy plik. Projekt spina źródła, adnotacje, referencje, style, ludzi i historię — i jest
  jednostką przenoszenia (snapshot) oraz uprawnień.
- **Kluczowe relacje:** `Document` (źródło) ↔ `Reference` (rekord bibliograficzny CSL) ↔
  `Annotation` (notatka zakotwiczona do fragmentu, wskazująca dokument) → `citations` (formatowanie
  referencji przez CSL). Wszystko należy do jednego `Project`.
- **Czy dokument i rekord bibliograficzny są zawsze powiązane:** przy archiwizacji strony — tak
  (capture tworzy oba, referencja niesie `documentId`). Ale referencję można też dodać samą (import
  DOI / ręcznie), bez dokumentu — dlatego bibliografia kompiluje się z **referencji**, nie dokumentów
  (to była zresztą naprawiona pułapka w v0.26.0).
- **Deduplikacja:** przy archiwizacji stron — po **DOI** w obrębie projektu; dla web-adnotacji
  dodatkowo **po URL** (bo strona bez DOI inaczej tworzyłaby duplikaty).
- **Dwa dokumenty z tym samym DOI:** drugi capture jest deduplikowany — istniejący dokument jest
  ponownie użyty, nie powstaje duplikat (a feed aktywności milczy, bo nic się nie zmieniło).
- **Dane adnotacji:** id, projekt, dokument, **kotwica** (dla web: selektory text-quote →
  text-position → css; dla PDF: strona + prostokąty we frakcjach + cytat), treść notatki, tagi,
  status recenzji, autor, znaczniki czasu.
- **Odtworzenie pełnej drogi notatka→źródło→wynik:** tak — kotwica wskazuje fragment, referencja daje
  cytat, feed aktywności rejestruje zmiany statusu i użycie w wyniku.

## 7. Adnotacje i zachowanie kontekstu
- **Czym różni się od zwykłej notatki:** jest **zakotwiczona** — wskazuje dokładny fragment źródła i
  potrafi tam wrócić, a nie tylko przechowuje oderwany tekst.
- **Kotwiczenie web:** model W3C — trzy strategie po kolei: **text-quote** (cytat + prefiks/sufiks),
  **text-position** (offsety), **css** (selektor strukturalny) jako fallback (biblioteki
  `dom-anchor-text-quote`/`dom-anchor-text-position`). Podświetlenia rysowane jako nakładki liczone z
  `getClientRects()` — **bez modyfikacji DOM strony**.
- **Gdy treść/struktura strony się zmieni:** próbowane są kolejne strategie; jeśli żadna nie trafi,
  kotwica jest „lost" — notatka nie jest malowana i trafia do grupy **„Couldn't place on this page"**
  w panelu (nadal edytowalna). Czyli: **użytkownik dostaje sygnał**, że nie odnaleziono zaznaczenia.
- **Kotwiczenie PDF:** PDF ma stały układ, więc kotwica to numer strony + prostokąty jako **frakcje**
  strony (0–1) → niezmiennicze na zoom/DPR. Highlight tekstowy niesie też **cytat**; przy renderze
  cytat jest porównywany z tekstem pod współrzędnymi i przy niezgodności overlay dostaje etykietę
  **„Moved?"** (uczciwość zamiast cichego, pewnego, ale błędnego trafienia).
- **Co adnotacja zachowuje:** cytowany tekst **i** kontekst wokół (prefiks/sufiks w text-quote),
  pozycję (offsety / frakcje) oraz selektor strukturalny.
- **Ograniczenia:** web — v1 rozwiązuje kotwice przy wczytaniu i repozycjonuje przy scrollu; pełna
  obsługa nawigacji SPA/dynamicznego DOM jest odroczona. PDF — kotwica jest współrzędnościowa
  (weryfikowana cytatem), nie „re-kotwiczy" po realnym przelaniu tekstu, tylko oznacza rozjazd.

## 8. Workflow źródeł
- **Dlaczego statusy To Read / In Review / Analysed / Used in Output:** odwzorowują realny łańcuch
  pracy z literaturą — od „znalezione, nieprzeczytane" po „faktycznie użyte w wyniku". Pipeline jest
  **jednokierunkowy** w intencji, ale menu statusów pozwala też cofnąć (czego samo klik-cyklowanie nie
  umiało).
- **Potwierdzone:** te cztery statusy odzwierciedlają **mój rzeczywisty proces** pracy z dużą liczbą
  źródeł — od „znalezione" po „użyte w wyniku". (Fakt techniczny: obecnie **nie są konfigurowalne**
  przez użytkownika — to stały zestaw; ewentualna personalizacja to temat na przyszłość.)
- **„Used in Output" w praktyce:** źródło zostało realnie wykorzystane w końcowym materiale (cytat/
  argument), więc musi znaleźć się w bibliografii i być odtwarzalne.
- **Odrzucenie źródła:** obecnie brak wprost statusu „rejected/nieprzydatne" dla *dokumentu* (jest za
  to status recenzji **adnotacji**: draft/accepted/rejected/includedInReport). To potencjalna luka do
  omówienia w artykule/rozwoju.
- **Dashboard a stan projektu:** Kanban pokazuje rozkład źródeł po statusach, liczniki i pasek
  postępu; feed aktywności — co i kiedy się działo. Użytkownik po wejściu powinien móc zadać pytanie:
  **„na czym stoję i co zostało do przeanalizowania?"**.

## 9. Cytowania i bibliografia
- **Dlaczego cytowania są rdzeniem:** bo bez poprawnego, odtwarzalnego cytatu cała reszta (kontekst,
  status) nie zamienia się w wiarygodny wynik. Projekt używa **prawdziwego citeproc-js**, nie
  przybliżeń.
- **Style obecnie obsługiwane i przetestowane:** vendored CSL — **APA**, **Chicago author-date**,
  **Chicago notes-bibliography** (są testy „golden" pilnujące zgodności z plikami CSL).
  W artykule wymieniamy **dokładnie te trzy** jako przetestowane golden-testami, a szerszą obsługę
  deklarujemy jako **„dowolny styl przez import `.csl`"** — uczciwie i konkretnie, bez obiecywania
  niesprawdzonego.
- **Import własnego `.csl`:** tak — jako styl bazowy.
- **Co można zmieniać bez XML:** przez **edytor reguł** — m.in. liczbę autorów przed „et al.",
  łącznik nazwisk, DOI jako URI, dołączanie URL/numeru wydania, szablony dla identyfikatorów i
  źródeł specjalnych. Reguły kompilują się **na styl bazowy** (żadnego ręcznego CSL XML).
- **Dla kogo edytor reguł:** dla użytkownika, który chce dostroić styl (np. wymogi wydawcy/uczelni)
  bez grzebania w CSL.
- **Formaty:** **in-text**, **bibliografia**, a system cytowań (author-date vs notes/przypisy) wynika
  z bazowego stylu CSL (np. Chicago notes → przypisy).
- **Nietypowe typy:** przewidziane szablony dla **dokumentów prawnych** i **wniosków FOI**
  (identyfikatory/źródła specjalne w regułach).
- **Ograniczenia generatora:** zależny od poprawności metadanych referencji (śmieciowy DOI → śmieciowy
  cytat — dlatego dodano ręczną edycję referencji); przetestowane golden-testami tylko dla vendored
  stylów; import Zotero/BibTeX/RIS jeszcze niepodłączony.

## 10. Local-first i prywatność
- **Dlaczego local-first:** dane badawcze są wrażliwe i osobiste; MV3 i tak zabrania zdalnego kodu.
  Brak backendu = brak konta, brak wycieku, pełna kontrola użytkownika. To **świadoma decyzja
  produktowa**, nie brak zasobów.
- **Co nigdy nie opuszcza komputera:** wszystkie projekty, dokumenty, bajty PDF, adnotacje,
  referencje, style, historia — wszystko żyje w **IndexedDB** tej przeglądarki.
- **Czy wysyła dane na zewnątrz:** tylko na **wyraźne żądanie** i tylko po metadane cytowań —
  **import DOI** (doi.org / Crossref / DataCite) oraz **pobranie PDF-a z URL** — każdorazowo za
  opcjonalną, per-origin zgodą uprawnień. Poza tym: nic.
- **Konto/serwer/internet:** niewymagane; narzędzie działa w pełni offline (poza opcjonalnym importem
  DOI/PDF).
- **Gdzie projekty:** IndexedDB profilu przeglądarki (schema v5).
- **Kopia zapasowa:** eksport **snapshotu** (plik JSON), opcjonalnie z bajtami PDF.
- **Szyfrowanie eksportu:** puste hasło → czysty JSON (do wglądu/backupu); hasło → **AES-GCM +
  PBKDF2 (600k iteracji)**, WebCrypto. Zły hasło/naruszony plik → jeden komunikat („wrong password or
  altered") — celowo nieodróżnialne.
- **Korzyści/ograniczenia braku backendu:** prywatność, prostota, brak vendor-locka; kosztem —
  współpraca jest **asynchroniczna** (plik snapshotu), brak obecności/synchronizacji w czasie
  rzeczywistym.

## 11. Współpraca i przenoszenie projektów
- **Współpraca dwóch osób dziś:** przez **przenośny snapshot** — eksportujesz plik, druga osoba go
  importuje/scala do własnej lokalnej bazy. Zaproszenie członka jest lokalne („nothing is sent");
  podróżuje w kolejnym snapshotcie.
- **Role:** **informacyjne (advisory)**, nie egzekwowane technicznie — każdy współpracownik ma pełną
  kopię w swoim IndexedDB, więc nic nie może wymusić roli. UI mówi to wprost.
- **Eksport/import:** koperta JSON z numerem `format`; import ma **podgląd** (co by zmienił) przed
  właściwym scaleniem.
- **Konflikt danych / która wersja nowsza:** scalanie dedupuje dokumenty i referencje po DOI,
  **remapuje id** (żeby adnotacje/wątki podążyły za lokalną kopią), a poza tym **wygrywa nowszy
  `updatedAt`**; członkowie są sumowani.
- **Czy import usuwa lokalne dane:** **nie** — scalanie nigdy nie usuwa; tylko dodaje/aktualizuje.
- **Co jest przenoszone:** źródła, adnotacje, referencje, style, ludzie, komentarze, aktywność; bajty
  PDF **opcjonalnie** (checkbox).
- **Przyszłość real-time:** backend i obecność współpracowników są **trwale poza zakresem** — to
  świadoma decyzja produktowa (prywatność, brak konta i vendor-locka), nie brak zasobów. Współpraca
  pozostaje asynchroniczna, przez przenośny snapshot (patrz sekcja 17).

## 12. Historia aktywności i komentarze
- **Co zapisywane:** dodanie źródła, zmiana statusu (z wartością **przed→po**), dodanie/recenzja/
  usunięcie adnotacji, import/dodanie/usunięcie referencji, zmiany członków i ról, komentarze,
  zdarzenia sync (eksport/import snapshotu).
- **Dlaczego w warstwie domenowej (routerze), nie w UI:** żeby **każda** powierzchnia zasilała feed za
  darmo — status zmieniony w panelu bocznym pojawia się w historii, mimo że panel nic nie wie o feedzie.
  To reguła architektoniczna („record domain changes in the router").
- **Funkcja audytu:** de facto tak — feed to odtwarzalna historia zmian projektu (z wartościami
  przed/po dla statusów i ról).
- **Poprzednia/nowa wartość:** tak, dla zmian statusu i ról (`from`/`to`).
- **Do czego przypina się komentarz:** do **adnotacji** (przez „Discuss" w widoku adnotacji).
- **Wątki/odpowiedzi/rozwiązanie:** tak — wątek z odpowiedziami i statusem resolved (jedna atomowa
  zapis na odpowiedź).
- **Skąd ten model:** wynika z reguły architektonicznej („record domain changes in the router"), nie
  z konkretnego osobistego scenariusza — feed powstaje „za darmo" na każdej powierzchni, więc historia
  jest kompletna niezależnie od tego, kto i gdzie wprowadził zmianę.

## 13. Decyzje architektoniczne
- **Ports and adapters:** żeby logika badawcza (domena) była testowalna i niezależna od przeglądarki;
  Chrome API i IndexedDB są „na brzegach". `src/core` jest **czyste** — bez `chrome.*`, bez DOM
  (wyjątek: kotwiczenie web, DOM-owe z natury, testowane pod jsdom).
- **Co rozwiązuje oddzielenie od Chrome API:** testowalność (Vitest + fake-indexeddb), wymienność
  adapterów, odporność na zmiany MV3, jasne granice.
- **Co niezależne od przeglądarki:** cała domena — kotwiczenie (logika), cytowania, model, snapshot,
  reguły stylów.
- **Dlaczego panel boczny główną powierzchnią:** bo research dzieje się **obok** czytanej strony —
  panel towarzyszy, nie zabiera miejsca, i jest zawsze pod ręką przy przeglądaniu.
- **Rola dashboardu vs czytnik PDF:** dashboard = zarządzanie całym projektem (Kanban, dokumenty,
  referencje, style, zespół, snapshot); czytnik PDF = wbudowane czytanie i adnotowanie PDF-ów z
  własną szyną notatek.
- **Dlaczego IndexedDB:** jedyny sensowny lokalny magazyn dla dużych, ustrukturyzowanych danych +
  bajtów PDF w przeglądarce; wspiera migracje (append-only) i transakcje.
- **Dlaczego ograniczone uprawnienia:** narzędzie, którego sensem jest prywatność, nie może żądać
  stałego dostępu do każdej strony — stąd tylko `storage/scripting/activeTab/sidePanel`, a host
  per-origin **opcjonalnie**, na żądanie (model hybrydowy web-adnotacji).

## 14. Konkurencja i alternatywy
- **Co używa się dziś zamiast:** kombinacja zakładek + Zotero/Mendeley + Obsidian/Notion +
  Hypothes.is.
- **Różnice (obiektywnie):** vs **Zotero** — Zotero to menedżer bibliografii, słaby w kotwiczeniu
  kontekstu na stronie; tu cytowania i adnotacje kontekstowe są jednym obiektem. vs **Obsidian/
  Notion** — świetne notatki, ale nie kotwiczą do fragmentu źródła ani nie robią prawdziwego CSL. vs
  **Hypothes.is** — bliskie w web-adnotacjach, ale chmurowe/serwerowe i bez zarządzania bibliografią/
  statusami; tu jest **local-first** i pełny CSL. vs **zakładki Chrome** — brak kontekstu i procesu.
- **Zastąpić czy uzupełnić / jedna cecha unikalna / dlaczego zamiast składanki / kategoria produktowa:**
  Kategoria: „**local-first research companion** — kontekstowe adnotacje + bibliografia CSL w jednym,
  bez chmury". Narzędzie **uzupełnia** dotychczasową składankę, spinając ją w jednym miejscu, a jego
  wyróżnik — którego składanka zwykle nie daje — to **jeden zakotwiczony łańcuch od fragmentu źródła
  do cytatu, w pełni offline i prywatnie**.

## 15. Najważniejsza wartość produktu
- **Moment pokazujący wartość (obiektywnie):** powrót do projektu po tygodniach i **jedno kliknięcie
  notatki, które przenosi Cię z powrotem do dokładnego zdania w źródle** — kontekst nie wyparował.
- **Co użytkownik może po miesiącu:** odtworzyć każdy wniosek do źródłowego fragmentu i wygenerować
  spójną bibliografię bez ręcznego zbierania — bo wszystko było kotwiczone od początku.
- **Jakie straty ogranicza:** utratę kontekstu, błędne/nieodtwarzalne cytaty, czas na odtwarzanie.
- **Główna wartość:** **śledzenie pochodzenia (provenance) + prywatność** — reszta (szybkość,
  dokładność, kontrola procesu) z tego wynika.
- **Sedno:**
  - **Jedna funkcja do zachowania:** *zakotwiczona adnotacja z powrotem do dokładnego fragmentu
    źródła* — bo to ona odróżnia narzędzie od notatnika i menedżera bibliografii.
  - **Jedno zdanie dla czytelnika (wiodące):** _„Twoje notatki nigdy nie tracą kontaktu ze źródłem —
    od zaznaczonego zdania po gotowy cytat, w całości na Twoim komputerze."_
  - **Wariant „studencki" (alternatywa):** _„Research z setką źródeł, do którego możesz wrócić za
    miesiąc i wciąż wiedzieć, skąd wziął się każdy cytat."_

## 16. Dowody i przykłady
**Stan faktyczny (bądźmy uczciwi w artykule):** narzędzie jest na etapie **przed szeroką walidacją
użytkownikami**. Plan dowodu:
- **Autotest na własnej pracy** — używam go do swojego researchu na studiach (pierwszy realny projekt
  powstaje w trakcie).
- **Zaproszenie kolegów ze studiów i wykładowców** do testów i feedbacku — to najbliższy krok.
- Metryki (szybszy powrót do projektu, mniej ręcznej pracy przy bibliografii) będą zbierane z tych
  testów; dziś jeszcze ich nie ma.

_Dowód „techniczny", którym już dysponuję:_ 253 testy jednostkowe + 25 E2E, testy golden dla cytowań,
weryfikacja kotwic (PDF „Moved?", web „couldn't place"), oraz repo z pełną historią wydań od v0.0.1.
To nie zastępuje case study z użytkownikami, ale pokazuje dojrzałość i rzetelność wykonania.

**❓ Opcjonalnie, gdy zbierzesz pierwszy realny projekt:** podaj skalę (ile źródeł / adnotacji /
referencji) i jedną historię „narzędzie pomogło odnaleźć zapomniane źródło / uniknąć błędnego cytatu"
— to najmocniejszy element artykułu, warto go dodać po pierwszych testach.

## 17. Kierunek rozwoju
_Co wynika z roadmapy/STATUS/decyzji:_
- **Local-first pozostaje zasadą** (self-hosted backend świadomie poza zakresem; obecność/real-time
  wymaga żywego kanału, którego plikowy sync nie daje).
- Wszystkie pięć faz roadmapy dostarczone; web-adnotacje właśnie domknięte (v0.27.0).
- Naturalne następne kroki widoczne w backlogu: podłączenie importu Zotero/BibTeX/RIS, kolory/tagi/
  skrót dla web-adnotacji, zarządzanie zaanotowanymi witrynami, obsługa SPA w kotwiczeniu web.
- **Wizja:**
  - **Docelowo:** najlepszy *local-first* towarzysz researchu dla studentów i osób pracujących na
    wielu źródłach — jedno miejsce od zaznaczenia po bibliografię, bez chmury i konta.
  - **Priorytet teraz:** dopięcie web-adnotacji (v0.27.0) i **feedback od pierwszych testerów**
    (koledzy ze studiów, wykładowcy) — dopiero on wyznaczy kolejne kroki.
  - **Inne przeglądarki:** priorytetem jest **Chrome**; **Edge** (MV3) jest blisko, a **Firefox**
    możliwy później.
  - **Integracje:** naturalny kierunek to import z **Zotero/BibTeX/RIS** (już częściowo w kodzie) i
    eksport do edytorów; pełne integracje z Obsidian/Word — do rozważenia po feedbacku.
  - **Czego świadomie NIE dodaję:** centralnego backendu, kont, synchronizacji w czasie rzeczywistym
    i chmurowego przechowywania — to łamałoby zasadę local-first.
  - **Za rok:** stabilne narzędzie z realnymi użytkownikami i importem z menedżerów bibliografii;
    **czym nie ma się stać:** kolejną chmurową platformą SaaS zbierającą dane badawcze.

## 18. Ton i cel artykułu
Decyzje redakcyjne (podjęte) — biorąc pod uwagę, że jesteś studentem, a najbliższy cel to feedback
od kolegów i wykładowców:
- **Miejsce publikacji:** **LinkedIn** — zasięg profesjonalny/uczelniany. Stąd ton bardziej ludzki
  i problemowy, a szczegóły techniczne dawkowane oszczędnie (na tyle, by pokazać rzetelność, bez
  zanudzania nie-technicznych czytelników).
- **Odbiorca:** studenci i osoby pracujące na wielu źródłach, a poza tym społeczność dev (bo to też
  projekt techniczny i open source).
- **Cel:** przede wszystkim **wyjaśnić problem i zaprezentować projekt**, a przy okazji **pozyskać
  pierwszych testerów**.
- **Charakter:** hybryda **osobistej historii** (student, własna praca, „podrapałem własne swędzenie")
  **+ lekkiego technicznego case study** (local-first, kotwiczenie, prawdziwy CSL) — na LinkedIn z
  przewagą historii i wartości nad kodem.
- **Szczegóły techniczne:** umiarkowanie — architektura, prywatność, kotwiczenie jako dowód
  rzetelności, ale bez fragmentów kodu na pierwszym planie.
- **Ograniczenia obecnej wersji:** **opisać otwarcie** (co gotowe, co dopiero wchodzi, czego brak) —
  uczciwość buduje wiarygodność, zwłaszcza przy zapraszaniu do testów.
- **CTA:** _„Zainstaluj, użyj przy swoim researchu i daj znać, co poprawić"_ **+ link do repo**
  (projekt jest **open source**) — dla osób technicznych zaproszenie do feedbacku, issues i PR-ów.

---

### Stan uzupełnienia
Plik jest **sfinalizowany** — wszystkie decyzje redakcyjne i merytoryczne zostały podjęte i
wkomponowane:
- **Odpowiedziane przez Ciebie i wkomponowane:** 1 (geneza — student Solent, CompSci, własny ból +
  anegdota otwierająca), 3 (odbiorca), 8 (statusy = Twój realny proces), 16 (etap przed walidacją).
- **Wypełnione z projektu:** 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14.
- **Zatwierdzone decyzje:** 9 (dokładnie APA + Chicago ×2 + import `.csl`), 11 i 17 (local-first jako
  trwała zasada, brak backendu/real-time), 15 (jedna funkcja + zdanie wiodące), 17 (wizja, priorytet
  przeglądarek Chrome → Edge → Firefox), 18 (publikacja: **LinkedIn**; CTA: **open source + link do
  repo**).
- **Świadomie otwarte (nie blokują publikacji):**
  1. **Weryfikacja szkicu anegdoty** (sekcja 1, `DO WERYFIKACJI`) — podmień na własną, prawdziwą
     sytuację lub potwierdź szkic.
  2. (opcjonalnie, po pierwszych testach) **skala realnego projektu + jedna historia sukcesu**
     (sekcja 16) — najmocniejszy element artykułu, do dodania po testach z kolegami/wykładowcami.
