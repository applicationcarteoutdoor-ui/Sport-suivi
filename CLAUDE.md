# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Lis ce fichier EN ENTIER avant de toucher au code.** Il condense ~25 000 lignes de décisions,
> quatre vagues de revues et une quinzaine de bugs silencieux déjà payés une fois. La langue de
> travail du projet (code, commentaires, interface) est le **français**.

## Ce que c'est

PWA de suivi de musculation, **100 % hors-ligne**, mono-utilisateur, qui remplace un carnet papier.
- **HTML/CSS/JS vanilla. Modules ES natifs. AUCUNE dépendance, AUCUN build, AUCUN framework.**
- Dépôt : `applicationcarteoutdoor-ui/Sport-suivi` → servie par GitHub Pages sur
  `https://applicationcarteoutdoor-ui.github.io/Sport-suivi/` (sous-chemin : jamais de chemin
  absolu commençant par `/`, unique exception nommée `manifest.id`).
- Critère produit : noter une série plus vite qu'au stylo ; ne jamais perdre une donnée.

## Commandes

```powershell
# Serveur local — OBLIGATOIREMENT depuis le dossier PARENT (tester à la racine masque
# les bugs de sous-chemin, la classe d'erreur la plus coûteuse du projet) :
cd ".."; python -m http.server 8123
# puis ouvrir http://127.0.0.1:8123/Sport-suivi/

# Tests (230 assertions : domaine pur, migrations, intégrité classes↔CSS, couture icônes) :
#   ouvrir http://127.0.0.1:8123/Sport-suivi/tests.html — doit être 100 % vert.
#   Le TITRE DE L'ONGLET porte le score (« ✓ 230/230 ») : c'est le seul contrôle à faire.
# Il n'y a pas de lanceur de test unitaire : tests.html EST le harnais (zéro dépendance), et il
# n'a AUCUN filtre — le fichier entier s'exécute en moins d'une seconde. Pour isoler une
# assertion, la recopier dans un `groupe()` temporaire en tête de fichier (et l'en retirer).

# Vérifier la syntaxe d'un module (sw.js exclu : contexte worker) :
node --check js/views/seance-tableau.js

# Diagnostic de déploiement (zéro 404 exigé sur les assets déclarés) :
#   ouvrir http://127.0.0.1:8123/Sport-suivi/verif.html

# Livraison — LE rituel (voir aussi README.md, contrat de non-régression) :
#   1. bumper "version" dans version.json (format « V » + entier, ex. V17 — jamais une date,
#      jamais un numéro réutilisé ; il est AFFICHÉ dans Réglages → Application)
#   2. aligner APP_VERSION dans js/config.js sur la MÊME valeur (sinon boucle de mise à jour)
#   3. tout nouveau fichier livré doit être listé UN PAR UN dans version.json (jamais de glob) ;
#      verif.html et tests.html restent VOLONTAIREMENT hors liste
#   4. git add -A && git commit && git push   (Pages reconstruit ; CDN ≤ 10 min)
```

En dev local, le service worker sert son précache : pour voir un changement, purger caches +
désenregistrer le SW dans la console, ou dérouler le protocole PRECACHE/ACTIVER.

⚠ **Purger le SW ne suffit PAS** (piège qui a coûté deux fois une demi-heure). `python -m
http.server` n'envoie aucun `Cache-Control` : Chrome applique alors son heuristique (10 % du
temps écoulé depuis `Last-Modified`) et sert pendant des HEURES un module vieux de trente
secondes — y compris à un `import` ES. On croit donc à un bug de code là où il n'y a qu'un cache.
**Protocole fiable, dans cet ordre** : purger caches + SW → charger la RACINE de l'app une fois
(le SW réinstalle et précache avec `{cache:'reload'}`, seul chemin qui contourne le cache HTTP)
→ recharger la page à vérifier, qui est alors servie par ce précache neuf. Contrôle en une
ligne : lire l'entrée du précache et y chercher une chaîne de la modification.

⚠⚠ **Et surtout : dans une page CONTRÔLÉE par le SW, `fetch(url, {cache:'no-store'})` ne va PAS
au réseau** pour un asset précaché — le worker s'interpose avant le cache HTTP et répond depuis
son cache, `cache:` n'étant qu'une consigne au cache HTTP. Vérifier « le fichier servi » avec un
`fetch` no-store depuis la page mesure donc le PRÉCACHE, pas le disque. C'est ce qui rend le piège
ci-dessus si convaincant, et c'est faux dans les deux sens : on peut lire du neuf en croyant lire
du vieux. Pour comparer au disque, utiliser `curl` / `md5sum` hors du navigateur, ou une URL
cache-bustée (`?x=…`) que le précache ne contient pas. Corollaire rassurant : cette interposition
est exactement ce qui rend la mise à jour de PRODUCTION fiable — seul le `fetch` interne au worker,
en `{cache:'reload'}`, définit ce que l'utilisateur recevra.

⚠ **Le plus rapide pour vérifier un changement en dev n'est PAS de purger** : c'est de dérouler un
vrai cycle de version (bumper `version.json` + `APP_VERSION`, `verifier({force:true})`, cliquer
« Recharger »). Le précache du worker va au réseau, donc le contenu est neuf par construction, et
on teste le mécanisme de mise à jour en même temps. Cinq cycles enchaînés ainsi le 2026-07-25.

## Invariants absolus (chacun a déjà cassé une fois — d'où sa présence ici)

0. **IRRÉVERSIBLE, et le seul de cette liste qui détruise les données de quelqu'un d'autre :
   ne JAMAIS renommer le dépôt (`Sport-suivi` à vie), ne JAMAIS toucher à `id` / `start_url` /
   `scope` dans `manifest.json`.** L'un ou l'autre change l'identité de la PWA : pour le
   navigateur c'est une AUTRE application — icône installée morte, IndexedDB (liée à l'origine)
   inaccessible, aucun message d'erreur. Rien ne permet de revenir en arrière côté utilisateur.
   Ces deux règles ouvrent le contrat de non-régression du README, qui n'est PAS chargé
   automatiquement : elles sont donc rappelées ici, en tête.
1. **AUCUN `innerHTML`**, nulle part. `createElement`/`createElementNS`/`textContent` via
   `js/lib/dom.js` (`h()`, `svg()`). Corollaire : zéro problème d'échappement.
2. **AUCUN état fonctionnel dans `requestAnimationFrame`.** rAF ne s'exécute pas quand la page
   n'est pas rendue (arrière-plan, throttling mobile). Trois bugs de cette classe corrigés, dont
   « Terminer la séance » totalement inopérant. Pour rendre un panneau visible :
   `void el.offsetHeight;` puis poser l'attribut SYNCHRONEMENT.
3. **Toute classe CSS posée par le JS doit avoir une règle dans `css/`** (`tests.html` échoue
   sinon). Le vocabulaire BEM (`__`, `--`) est **banni** — une divergence de nommage a laissé
   toute la coquille sans style, sans une seule erreur console. Pour des ÉTATS, préférer
   `data-etat="..."` aux classes. Attention aux attributs : le composeur pose `aria-selected`
   (role=tablist), pas `aria-pressed` — un sélecteur CSS sur le mauvais attribut est invisible.
4. **`version.json` fait foi** : un asset déclaré absent ⇒ le précache **entier** échoue ⇒ plus
   aucun mode hors-ligne ; un module oublié ⇒ écran blanc hors-ligne.
5. **`APP_VERSION` (js/config.js) = `version` (version.json)**, toujours.
6. **`MODES` (js/data/schema.js) est l'UNIQUE point de polymorphisme.** Aucun `if` sur un mode
   ailleurs (seule exception : `chargeEffectiveKg` dans domain/metrics.js). Champs de saisie via
   `champsSaisie`/`champsSaisieEntree`, métriques proposées via `MODES[mode].metriques`.
7. **Coefficients GELÉS sur l'entrée de séance** (`modeUtilise`, `lestableUtilise`,
   `incrementKgUtilise`, `bodyweightFactorUtilise`, `machineProfileUtilise`,
   `unilateralUtilise`). On lit l'entrée, JAMAIS l'exercice courant, pour interpréter un fait.
8. **`estComptable(serie)`** filtre tout agrégat (done && kind ≠ échauffement).
   **`estSeanceComptable(seance)`** remplace tout `statut === 'terminee'`. Une séance
   **abandonnée** reste VISIBLE dans l'historique (`estSeanceClose`) mais n'entre dans AUCUNE
   courbe ni statistique.
9. **Archiver plutôt que supprimer un exercice** (les séances le référencent à vie). La seule
   suppression DURE admise (`exercice:supprimer`, v12) exige TOUT ceci : préfixe `usr:`,
   historique chargé, et aucune référence ni dans une séance ni dans un modèle (v13). Sinon
   **archivage**, réversible et sans perte — une entrée de séance privée de son exercice perdrait
   son mode, donc le sens de ses séries. Une ROUTINE utilisateur (`usr:`) se supprime ; un modèle
   livré (`tpl:`) s'archive.
10. **Dates locales** : `dayKey()` — jamais `toISOString` (une séance à 23 h basculerait au
    lendemain). Un `<input type=date>` rend déjà du `YYYY-MM-DD` local : le prendre TEL QUEL.
    Comparaison de dayKey = comparaison de chaînes.
11. **`DB_VERSION = 1` à vie** (IndexedDB, 6 magasins créés au 1er commit — `onblocked`
    structurellement impossible). Les évolutions passent par `SCHEMA_VERSION` +
    `data/migrations.js` (pures, synchrones, testables) : sauvegarde → up() → écriture →
    RELECTURE ET VÉRIFICATION → purge.
12. **Écran de séance : aucun `<input>`.** Valeurs en JS, steppers (`ui/stepper.js`) et pavé
    interne (`ui/keypad.js`). Ailleurs (détail, réglages), un champ natif est admis, police ≥16px
    (zoom iOS).
13. **Contrat de rendu** : une vue construit son DOM UNE FOIS ; jamais de re-rendu global
    (il détruirait scroll, focus et le bouton sous le doigt). Mutations ciblées ;
    `mount(conteneur, params) → { destroy(), onParams(params) }` ; `destroy()` coupe TOUS les
    abonnements ET ferme feuille/pavé. Une feuille est un PARAMÈTRE de route
    (`#/seance?sheet=x`), jamais une route.
14. **`store.commit(type, payload)`** est le seul chemin d'écriture des vues — noms EXACTS dans
    `typesDeCommit()` (data/store.js), charge utile conforme au handler. Invalidation par `bus`.
15. **`localStorage 'muscu:hot'`** = cache de reprise, JAMAIS la source de vérité.
16. Le service worker (`sw.js`, racine) ne contient NI version NI liste : il lit `version.json`
    (`no-store`). Protocole PRECACHE/ACTIVER/KILL — ne pas y toucher sans relire le README.
    Le bandeau de mise à jour n'est différé QUE sur l'écran `#/seance` (une séance « en cours »
    qui traîne ailleurs ne doit jamais bloquer une mise à jour — bug vécu).
17. **Une série ne se formate QUE dans `domain/metrics.js`**, en deux formes et deux seulement :
    `resumeSerie` (une phrase — lignes de série, infobulles, rappel « dernière fois », voix) et
    `resumeSerieCellule` (`{ grand, petit }` — les trois écrans en TABLEAU). Toutes deux dérivent
    de `champsSaisieEntree`, donc de MODES : ajouter un mode ne les rouvre pas. Reformater une
    série dans une vue fait diverger l'historique, le rappel et la courbe — trois écritures d'un
    même fait qui finissent toujours par ne plus se ressembler. C'est arrivé : la forme cellule a
    vécu recopiée dans deux vues jusqu'à la v14, sous le nom `texteCellule`, avec le commentaire
    « copie EXACTE » pour seul garde-fou et aucune assertion.

## Architecture — la vue d'ensemble qui demande plusieurs fichiers

**Flux de données.** `boot.js` (ordre d'amorçage NON négociable, commenté sur place : SW d'abord
sans await, puis prefs/miroir chaud, puis IDB→migrations→store→reprise→routeur, historique en
tâche de fond, écran de secours en catch). Les vues lisent le `store` (synchrone), écrivent par
`commit()`, apprennent les changements par `bus`. `domain/` est pur (aucun DOM, aucune I/O).
Direction stricte : `lib → data → domain → ui → views` (« est importé par »).

**Modèle de données** (js/data/schema.js, commenté) : l'INTENTION (Modele/routine, mutable :
`nom`, `items`, `origine`, `archived`) vs le FAIT (Seance, immuable, qui porte un `modeleSnapshot`
copié et ses coefficients gelés). `Serie.at` (epoch ms) est l'horodatage de validation ; le repos
réel en est DÉRIVÉ. `lestKg` est SIGNÉ (−20 = assistance élastique). `meta.lastPerf` est le seul
dérivé persisté (reconstructible).
⚠ `Modele.favori` est un champ VESTIGIAL : `nouveauModele` le pose encore, plus rien ne le lit
depuis la v6 (seul `views/modeles.js`, écran orphelin, l'affiche). Même dette de nommage dans
`views/historique.js` : le bouton `historique-favori` / `data-action="favori"` dessine un **`plus`**
et crée une SÉANCE TYPE. Ne pas conclure de ces noms que les favoris existent — ils sont morts.

**Écrans ORPHELINS** — `#/exercices` et `#/modeles` sont routés (boot.js) mais AUCUN lien de
l'interface n'y mène (vérifié : seuls des commentaires les citent). Conséquence pratique déjà
payée en v12 : un champ « affiché quelque part » peut n'être visible nulle part. Avant de
travailler sur un affichage, vérifier qu'un utilisateur peut l'atteindre.

**Écrans clés.** `views/seance-tableau.js` est l'écran de séance ACTUEL : tableau façon carnet —
colonne exercice + colonnes de séries en GRILLE partagée (`--tab-cols`, posée par `majEntete`,
minimum 8 colonnes TOUTES visibles sans défilement), cellules à `data-etat`
(faite/attente/ratee/future), éditeur en feuille (steppers + pavé), « Terminer » dans la page.
(`views/seance.js`, l'ancien accordéon, n'est plus routé mais reste livré.)
⚠ **TROIS écrans partagent ce dessin de tableau** — celui-ci, `views/seance-detail.js` et, depuis la
v14, le carnet de `views/progression.js`. Ils partagent le vocabulaire CSS (`.tab-*`, v2.css § 8 bis)
et **le formateur de case** `domain/metrics.resumeSerieCellule` — pas leur cycle de vie. Retoucher
`.tab-cellule` ou ce formateur se voit sur les trois : vérifier les trois. `views/composeur.js`
sert 3 routes (séance, routine, édition de routine) : packs → grille d'icônes triée par USAGE →
lignes réglables. `ui/drawer-minuteur.js` (chrono + rebours, état = horodatages persistés,
recalé sur visibilitychange/pageshow) est monté UNE fois par boot, hors routeur : il survit aux
changements d'écran. `ui/chart.js` : multi-séries (≤4), une échelle Y par unité (2 au maximum,
gauche/droite) — au-delà, refus explicite. ⚠ Ce double axe est un chemin MORT en pratique depuis
la v7 : `progression.js` ne compare que des séries de MÊME unité, et « poids + reps » est rendu
en deux graphes EMPILÉS. Le code existe, aucun appelant ne le déclenche : ne pas le réactiver
sans relire la note v7 plus bas (double axe = anti-pattern n°1 de dataviz).

**Icônes** (js/ui/icons.js, **78 dessins** — recompter à chaque ajout, le chiffre a déjà traîné
deux versions de retard). Convention stricte : l'icône d'un exercice du catalogue est son id privé
de son préfixe (`cat:squat` → `'squat'`). Résolution TOUJOURS par `iconePourExercice()`, dont la
chaîne est : **① `ex.icone`** (logo CHOISI par l'utilisateur depuis la v11-v12, ou posé par
catalog.js) → ② id sans préfixe → ③ pack déduit du matériel/mode → ④ générique. On ne lit donc
jamais `ex.icone` en direct — non parce qu'il serait absent, mais parce que seule la chaîne
complète garantit un dessin.
⚠ **Jamais d'accès direct `ICONES[cle]`** : la clé provient d'un id d'exercice, et `usr:toString`
est un nom légal. `icone()` et `iconePourExercice()` filtrent par
`Object.prototype.hasOwnProperty` — sans cette garde, une clé héritée du prototype rendrait une
fonction au lieu d'un dessin.
Nouvel exercice catalogue = nouveau dessin + le champ `icone` est dans `CHAMPS_SYNCHRONISES`
(catalog.js). `currentColor` partout ; le cardio est le coureur qui transpire — et le **cœur**
n'est plus employé que par `views/modeles.js` (écran orphelin) : les favoris sont morts en v6, ne
pas le recycler comme s'il était libre sans nettoyer cet écran.

## Préférences utilisateur (produit — à respecter dans toute évolution)

- Interface VISUELLE : icônes, cartes, peu de texte. Saisie en séance = TABLEAU façon carnet.
- **Les CHIFFRES avant la tendance** (v14) : sur Progression, l'onglet ouvert est le CARNET, pas une
  courbe. C'est lui qu'on vient lire en salle — la courbe dit qu'on progresse, le carnet dit quoi
  charger aujourd'hui. Et le carnet a le même dessin que l'écran de saisie : demander « le même
  style que l'application » est un retour récurrent, un écran qui invente sa mise en forme est un
  écran qui sera rejeté.
- Minuteur/chrono : dans le tiroir latéral uniquement, jamais dans le flux des séries.
- PAS de popups de succès (les erreurs, si).
- PAS de tonnage dans les RÉSUMÉS (accueil, historique, détail, fin de séance) — mais la courbe
  « Volume » de Progression EST le tonnage du domaine (`LIBELLES_METRIQUES['tonnage'] = 'Volume'`),
  et c'est la métrique par DÉFAUT depuis la v8. Seul le mot « tonnage » est proscrit à l'écran.
- PAS de réglage de repos par EXERCICE (retiré en v4 ; `item.reposSec` survit dans le schéma, sans
  UI). Un réglage GLOBAL demeure et doit rester : Réglages → Séance → « Repos par défaut »
  (15-900 s, `prefs.reposParDefautSec`, défaut 120).
- Les exercices les plus utilisés passent devant ; date d'une séance modifiable (passé ou futur).
- **La version installée reste VISIBLE** (Réglages → Application, v15). L'utilisateur n'a aucun
  autre moyen de savoir si une mise à jour a pris, et sans ce repère il conclut que le mécanisme est
  cassé. Ne pas la retirer une seconde fois au nom de l'épure.
- **Regarder n'est pas agir** (v13) : sélectionner une séance ne la démarre JAMAIS. Une séance
  ouverte par mégarde reste épinglée « en cours » sur l'accueil et sa clôture date un faux
  entraînement — un tap de plus vaut mieux qu'une donnée fausse.
- L'utilisateur écrit en français avec des fautes de frappe : interpréter avec bienveillance.
- Coût : limiter les agents (2-3 max, effort mesuré) — deux vagues massives ont épuisé son
  budget mensuel ; les petites retouches se font en direct.

## État et risques connus (2026-07-25, v13 livrée)

> **Comment lire ce journal.** Il descend de la vague la plus récente à la plus ancienne. Les DEUX
> premières décrivent le code d'aujourd'hui ; au-delà, c'est de l'archéologie — un fait de la v6
> peut avoir été défait en v9 sans que la ligne ait été retouchée. Ce qui garde toute sa valeur en
> descendant, ce sont les lignes **⚠** : chacune est un piège déjà payé une fois, et le code n'en
> porte pas toujours la trace. En cas de doute entre ce journal et le code, **le code gagne** —
> puis on corrige la ligne ici.

- v16 — la version se dit **`V16`**, et tient sur UNE ligne (retour utilisateur : « supprime version
  installée et version publiée, mais juste version ; je veux que tu parles en V1, ou V2 et autre,
  pas en date ») :
  · **Format de version : `V` + entier**, incrémenté à chaque déploiement, jamais réutilisé, jamais
    remis à zéro. Il remplace `AAAA-MM-JJ-NN` (v1→v15). Le compteur démarre à **16** pour tomber sur
    le numéro de vague de ce journal : « il est en V16 » désigne la vague v16, sans correspondance à
    tenir. ⚠ Aucun code ne compare deux versions autrement que par ÉGALITÉ (update.js, sw.js) : le
    format est libre, mais une seconde rupture de lecture serait gratuite pour l'utilisateur.
  · Réglages → Application : **une seule ligne « Version »**. Le numéro publié n'est plus affiché —
    quand il diffère, la ligne porte une pastille « Mise à jour disponible », qui dit quoi FAIRE au
    lieu de donner deux chaînes à comparer. La lecture réseau reste faite à l'OUVERTURE du groupe.
    ⚠ Un échec de lecture laisse la pastille CACHÉE : le silence n'affirme rien, et c'est le bouton
    juste en dessous qui tranche à voix haute.
- v15 — la version REVIENT dans les réglages (retour utilisateur : « je crois que les mises à jour
  ne fonctionnent pas vraiment, rajoute la version, comme ça je vois quand ça se met à jour ») :
  · Réglages → Application porte deux lignes de version (⚠ ramenées à UNE en v16) : installée et
    publiée. La v8 les avait retirées comme du bruit ; elles n'en sont pas — c'est le seul moyen
    pour l'utilisateur de CONSTATER qu'une mise à jour a pris. Ne pas les retirer à nouveau.
  · `ui/update.lireManifeste()` est désormais l'UNIQUE lecture cliente de `version.json`
    (`verifier()` l'utilise aussi). Elle **rejette** au lieu de deviner. ⚠ Confondre « je n'ai pas
    pu demander » et « rien à faire » est précisément ce qui fait douter du mécanisme.
  · ⚠ La pastille ne se distingue pas par la teinte (`--succes` et `--accent` sont deux verts
    indistinguables depuis la v5) mais par la FORME. Et son texte est en `--texte`, PAS en
    `--accent` : mesuré à 4,36:1 sur `--accent-doux`, sous le seuil de 4,5 pour du 14 px. La même
    paire vaut pour `.pastille[data-ton='accent']`, inchangée (composant partagé, hors périmètre).
  · **Le mécanisme de mise à jour a été vérifié de bout en bout**, cinq cycles : bandeau proposé
    tout seul → clic « Recharger » → `page→sw ACTIVER` → `sw→page ACTIVE_OK` → rechargement →
    `APP_VERSION` neuve, ancien cache de coquille purgé. Il n'était pas cassé. Ce qui manquait,
    c'était le moyen de le CONSTATER.
- v14 — le carnet devient un ONGLET, et prend le dessin de l'application (retour utilisateur :
  « à coté des autres courbes, le premier affiché quand on clique » + « je n'aime pas la DA ») :
  · **Barre d'onglets de Progression** : `Carnet | Volume | 1RM estimé | Charge max…`. La vue tient
    un état `vue` ('carnet' | 'courbe') À CÔTÉ de `metrique` : le carnet est l'affichage par défaut,
    au montage ET à chaque exercice choisi (`onParams`). Un seul des deux affichages occupe la
    place — `appliquerVue()` masque plages, courbe, aide et comparaison, ou le carnet.
    ⚠ Quitter la courbe DÉTRUIT son fragment (`peindreCourbe` sort si `vue !== 'courbe'`) : laisser
    vivre un SVG derrière un conteneur masqué, c'est garder ses écouteurs de pointeur.
    ⚠ La carte record reste visible sous le carnet, habillée par `metrique` — qui n'est donc jamais
    remise à null en changeant d'onglet.
  · **DA du carnet** = le vocabulaire de classes du tableau de séance (`.tab-entete`, `.tab-coin`,
    `.tab-col`, `.tab-rangee`, `.tab-sport`, `.tab-cellules`, `.tab-cellule`, `-grand`, `-petit`),
    dans un cadre `.carnet-tableau`. Colonne de gauche = la DATE (+ son ancienneté) au lieu de
    l'exercice, colonnes suivantes = S1…Sn, une case = valeur principale en gros + compléments en
    petit. **Trois écrans, une seule géométrie de tableau** : séance en salle, détail d'une séance
    passée, carnet. Les pastilles `.carnet-serie` de la v13 et les règles `.tableau-chrono` ont
    disparu (plus aucun code ne les posait).
    ⚠ Le nombre de colonnes (`--tab-cols`) est celui de la séance la PLUS FOURNIE des lignes
    affichées, sans plafond : plafonner amputerait des séries réellement faites.
  · **`resumeSerieCellule(serie, entree) → { grand, petit }`** rejoint `resumeSerie` dans
    domain/metrics.js. Elle vivait RECOPIÉE dans seance-tableau.js et seance-detail.js sous le nom
    `texteCellule`, avec « copie EXACTE » pour seul garde-fou et zéro assertion ; le carnet en
    aurait fait une troisième. La forme `{ compact: true }` de la v13 a été RETIRÉE : les pastilles
    qu'elle servait n'existent plus, et un paramètre sans consommateur est le défaut `favori`.
  · ⚠ `.vue-progression .metriques .segment` passe de `flex: 1 1 0; min-width: 0` à `flex: 1 0 auto` :
    avec cinq onglets (cardio) le shrink comprimait les libellés `nowrap` à 60 px et le texte
    débordait par-dessus le voisin, sans ellipse pour le signaler. Au-delà de la largeur, c'est la
    barre qui défile (`overflow-x: auto`, views.css).
  · ⚠ La légende du carnet est dérivée de ce que le tableau AFFICHE, pas de la table des modes :
    une planche est `lestable`, donc son mode déclare `lestKg`, et la légende annonçait « lest en
    dessous » sous vingt cases sans aucun lest. Même piège que la légende figée de la v13.
- v13 — regarder sans agir (retours d'un utilisateur testeur) :
  · **Aperçu d'une séance** : taper une tuile de l'accueil n'ouvre plus une séance, elle ouvre
    `ouvrirApercuModele` (views/accueil.js) — feuille listant les exercices et leurs cibles, puis
    « Lancer la séance », et SEULEMENT si `estRoutine(modele)` : Modifier / Renommer / Supprimer.
    Un modèle livré (`tpl:`) n'expose que « Lancer » — l'éditer écrirait une routine par-dessus le
    catalogue (invariant n°9). ⚠ Une feuille qui porte plus de deux actions DOIT empiler son pied
    (`flex-direction: column`) : en rangée, quatre boutons exigent 458 px et le dernier sort de
    l'écran sans défilement possible — défaut vécu, mesuré, corrigé. Le crayon `.tuile-gerer` et son enveloppe
    `.tuile-hote` ont DISPARU (leur menu EST devenu l'aperçu) ; les règles CSS aussi.
    ⚠ Le plafond `MAX_SEANCES_EN_COURS` ne désarme plus les tuiles de modèle (elles ne démarrent
    plus rien) : c'est le bouton « Lancer » de la feuille qui refuse, en le disant.
    ⚠ Les cartes de séance EN COURS gardent leur reprise en UN tap : l'aperçu ne les concerne pas.
  · **Carnet** (views/progression.js) : le tableau sous la courbe n'affiche plus « meilleure série
    + nombre de séries » mais TOUTES les séries, date à gauche, plus récent en haut.
    `tableauChronologique` expose désormais `entree` (coefficients GELÉS) pour que chaque série se
    relise dans SON mode d'époque — le seul point de cette vague encore intact.
    ⚠ Sa MISE EN FORME (pastilles dans un `<table>`) et la forme `{ compact: true }` de
    `resumeSerie` ont été REFONDUES en v14 : ne pas chercher de `<table>` ni de `.carnet-serie`.
    Ce qui reste vrai de ces deux ⚠ : une colonne commune à toutes les lignes est TOUT l'intérêt
    du carnet, et une largeur posée au mauvais endroit est ignorée en silence.
- v12 — « Créer un exercice » affiné (retours utilisateur) :
  · Formulaire réordonné et allégé : **Nom → Mode de suivi (en tête) → Muscle principal →
    Logo → Lien vidéo**. Retirés : matériel et description (affichés seulement dans l'écran
    `#/exercices`, ORPHELIN depuis la v11 — plus aucun lien vers lui) et muscles secondaires
    (le champ n'était LU nulle part). `musclesSecondaires` retiré de nouvelExercice.
  · **Logo choisi** : nouveau champ `exercice.icone` (une clé de ui/icons.js). `iconePourExercice`
    a une ÉTAPE 0 qui l'honore avant tout — transparente pour le catalogue (catalog.js pose déjà
    `icone` = id-sans-préfixe). La feuille propose une grille de ~46 dessins d'exercice/matériel.
  · **Suppression d'un exercice créé** : commit `exercice:supprimer` (usr: uniquement).
    Suppression DURE seulement si l'historique est chargé ET aucune séance ne le référence ;
    sinon **archivage** (réversible, sans perte — une entrée de séance perdrait son mode). UI :
    poubelle sur les lignes usr: du sélecteur (picker-exercice.js), confirmation en 2 taps
    inline (une feuille de confirmation fermerait le picker, sheet.js n'admettant qu'une feuille).
- v11 :
  · **Réglages hors navigation** : 4 onglets (Accueil, Historique, Progression, Muscles) ;
    l'engrenage ⚙ vit dans l'en-tête de l'ACCUEIL via #btn-menu (armé au montage, RENDU au
    démontage — même modèle que l'écran de séance). Bouton flottant du minuteur relevé
    (esp-5 au-dessus de la nav — il chevauchait le 5ᵉ onglet).
  · **« Créer un exercice »** : tuile accueil (2ᵉ position) → feuille complète
    (js/ui/creer-exercice.js) — nom, muscle principal + secondaires (tuiles aria-pressed),
    mode, matériel (vocabulaire MATERIELS), description, lien vidéo. Champs ADDITIFS du
    schéma : `musclesSecondaires` (filtré sur CATEGORIES) et `videoUrl` (prime sur la
    recherche YouTube dans les 3 fiches vidéo : séance, muscles, anatomie du composeur).
    Commit : 'exercice:enregistrer'.
  · **Feuilles** : plus JAMAIS d'autofocus sur un champ à l'ouverture (sheet.js — le clavier
    jaillissait sur « Catalogue complet ») ; le focus va au panneau si le premier élément
    utile est un input. Les vues qui VEULENT le clavier appellent champ.focus() elles-mêmes.
  · **Picker** : pictogramme (pastille accent-doux) en tête de chaque ligne.
  · ⚠ Un plafond de dépense a fauché 10 agents EN PLEIN VOL pendant cette vague : leurs
    éditions partielles ont été inventoriées et complétées à la main (CSS de la feuille de
    création, asset version.json). En cas de rechute : `git status` + node --check de chaque
    fichier modifié AVANT toute autre chose.

- v10 :
  · **Push et Pull RETIRÉS** (doublons de « Pecs et triceps » / « Dos et biceps ») :
    `MODELES_RETIRES` dans templates.js ; `semerModelesLivres` les ARCHIVE sur les
    installations existantes UNIQUEMENT si jamais touchés (updatedAt === createdAt) — un Push
    renommé/modifié appartient à l'utilisateur et reste. 10 séances livrées actives.
  · **Titre de l'écran séance** = nom de la séance (majSituation écrit #titre-ecran et
    document.title — le routeur avait posé « Séance », la vue surcharge après montage).
  · **Fiche exercice en séance** (colonne de gauche) : affiche le muscle principal
    (LIBELLES_CATEGORIES) et un lien vidéo YouTube avant les actions.
  · **5ᵉ onglet « Muscles »** (#/muscles, views/muscles.js) : silhouette cliquable partagée →
    fiche du muscle (data/muscles-info.js : rôle + conseil, textes originaux) + tous les
    exercices du groupe (lien vidéo, nom → #/progression/:id). Nav basse : 5 onglets
    (index.html — l'icône du 5ᵉ est un SVG inline statique, pas un glyphe).
  · **Silhouette détaillée** (ui/silhouette.js) : écorché façon planches anatomiques — muscles
    individuellement délimités + stries (`silhouette-strie`), décoratifs non cliquables en
    pointer-events:none, les 10 groupes de catégories restent la surface interactive.

- v9 :
  · **12 séances livrées** (templates.js) : les 6 d'origine + Pecs et triceps, Dos et biceps,
    Épaules et abdos, Chaîne postérieure (splits par segment, esprit guides Delavier), et deux
    Full body sans matériel (esprit méthode Lafay : circuits poids du corps, repos courts).
    Compositions ORIGINALES — aucun programme publié recopié. `semerModelesLivres` sème
    désormais TOUT id manquant à chaque boot (plus de drapeau bloquant) : les nouveautés
    atteignent les installations existantes ; l'archivé/modifié n'est jamais retouché.
  · **Composeur** : la charge/lest est un STEPPER inline visible ([−] valeur [+], tap au
    milieu → pavé). ⚠ Le stepper de base est une GRILLE : pour le compacter, redéfinir
    `grid-template-columns` (imposer une largeur aux boutons ne rétrécit pas les pistes —
    bug de largeur vécu, mesuré, corrigé). Le nom garde min-width 72px et s'ellipse.
  · **Réglages** : les 5 groupes TOUS fermés par défaut ; « Données » = export + import
    seulement (maintenance et stockage retirés de l'écran, machinerie dormante).
  · **Progression** : les onglets de métriques s'étirent sur toute la largeur — la règle doit
    battre `.vue-progression .metriques .segment` (flex: 0 0 auto) à spécificité égale.
    (v14 : `flex: 1 0 auto`, jamais de shrink — voir la vague v14.)

- v8 en ligne :
  · **Panneau superposé** (ui/router.js) : une route `panneau: true` (boot.js — le détail
    `#/historique/:id`) atteinte DEPUIS une vue montée s'ouvre dans `#panneau-hote`
    (index.html, zone A, z 38 SOUS la feuille 40) par-dessus la vue de fond qui reste MONTÉE
    et abonnée — le retour la retrouve intacte, scroll compris. Accès direct/rechargement =
    pleine page (repli assumé). `fermerPanneau()` avant toute autre navigation.
  · **Progression** : « Volume » est la PREMIÈRE métrique (ordre de MODES.metriques =
    métrique par défaut — depuis la v14 le premier ONGLET est le carnet, mais la métrique par
    défaut reste Volume : c'est elle qui habille la carte record et la courbe qu'on ouvre) ; pour un exercice seul, DEUX graphes toujours empilés — métrique
    choisie + `reps-total` (CUMUL des répétitions par séance, réducteur v8) ; le bouton
    « Poids + reps » a disparu. Un SECOND tap sur le même point ouvre la séance en panneau
    (`dernierPointVu`, aide écrite sous la courbe).
  · **Courbes, suite (2e commit)** : l'onglet « Répétitions max » n'existe PLUS (filtré dans
    peindreMetriques — la clé RESTE dans MODES : marqueur de capacité pour
    repsEmpilablesPossibles) ; la 2e courbe SUIT l'onglet — `reps-total` sous Volume,
    `reps-max` sous une métrique de charge. La bulle porte une CROIX ; sélection au 'click'
    (plus jamais 'pointerdown' : défiler sélectionnait un point) et seulement dans
    RAYON_TAP=26 unités du point (X ET Y) — tap à côté = referme la bulle.
  · **Réglages (2e commit)** : plus de lieux (machinerie dormante conservée), plus de version
    datée (⚠ REVENUE en v15, et pour de bon) ni de note CDN ni de lien diagnostic ; groupes
    remis à l'état PAR DÉFAUT quand la
    page est masquée (visibilitychange) ; un groupe qui s'ouvre se scrolle en vue (ouvert
    depuis le bas de page, il se dépliait entièrement sous le pli — « ça ne marche pas »).
  · **Composeur (2e commit)** : plus de puce « Séries » (elles s'ajoutent en salle) — ne reste
    que charge/lest, et durée/distance pour le cardio.
  · `reps-total` existe dans REDUCTEURS/UNITES/LIBELLES mais PAS dans MODES.metriques :
    c'est voulu (pas une puce, seulement la 2e courbe).

- v7 en ligne :
  · **« Séance libre » supprimée** de l'accueil (doublon de Composer — composer sans enregistrer
    EST la séance libre). Le libellé « Séance libre » reste pour nommer une séance sans modèle.
  · **Vue anatomique** : bouton `bouton-anatomie` dans le composeur → feuille routée
    (`?sheet=anatomie`) avec silhouettes face/dos (`js/ui/silhouette.js`, groupes `data-groupe`
    = catégories de `CATEGORIES`) ; tap muscle → liste des exercices (lien vidéo YouTube
    `target=_blank`, bouton d'ajout qui réutilise `ajouterExercice()`). Icône `anatomie`
    ajoutée (77 clés).
  · **Courbes** : palette catégorique dédiée `--graphique-1..4` (tokens.css, validée daltonisme
    et contraste clair/sombre — NE JAMAIS colorer une série avec accent/succès, deux verts
    depuis la v5). « Poids + reps » = DEUX graphes EMPILÉS (`courbe-pile-poids` /
    `courbe-pile-reps`, couleur posée sur l'ENVELOPPE : en mono-série le moteur ne pose aucun
    groupe `.courbe-serie`). Plus JAMAIS de double axe Y. Points r=4.
  · **Poids de corps** : logique UNIQUE `store.dernierPoidsConnu()` /
    `store.poidsPourNouvelleSeance()` (14 jours) — trois copies locales avaient divergé (le
    composeur redemandait le poids à chaque séance). Ne pas re-localiser.
  · **Navigation** : fond FLOUTÉ derrière les feuilles (`backdrop-filter` sur
    `.feuille-conteneur[data-ouvert]`), entrée des vues en fondu-glissé (`vue-entree`),
    désactivés par prefers-reduced-motion.
  · **Composeur** : chaque exercice = carte d'UNE ligne 64px (`ligne-exercice-compacte`)
    — c'est le « juste milieu » validé après deux allers-retours (v6 trop serré).
  · **Auto-réparation du précache** (`ui/update.js`) : un SW actif SANS cache `muscu-shell-*`
    (éviction, purge partielle) répondait « à jour » pour toujours, hors-ligne mort. Désormais
    `verifier()` détecte l'absence de coquille et rejoue PRECACHE+ACTIVER en silence
    (`etat.reparationVersion`). État réellement rencontré en dev.

- v6 en ligne :
  · **Séances types** remplacent les favoris : le « + » (historique, détail) crée une routine
    ordinaire (`routineDepuisSeance` n'écrit PLUS `favori`) ; sur l'accueil, chaque tuile de
    routine est enveloppée dans `.tuile-hote` avec un bouton crayon (`gerer-routine`) →
    feuille Lancer / Modifier (`#/composer/routine?id=`) / Renommer / Supprimer. Le concept
    « cœur/favori » ne doit PAS revenir (l'utilisateur : « je ne suis pas fan »).
  · **Poids de corps mémorisé 14 jours** : `poidsDuJour()` (accueil) lit le dernier poids
    connu (séances en mémoire + trace `prefs.dernierPoids`, posée par la feuille de poids de
    séance ET par la pesée des réglages — le magasin IDB `poids` n'est pas chargé en mémoire).
    La feuille de séance se pré-remplit avec le dernier poids, jamais 75 par défaut.
  · **Composeur : UNE ligne par exercice** — icône, nom (ellipse), puces-valeurs
    (`puce-valeur`, tap → pavé numérique, plus AUCUN stepper inline), commandes.
  · **Toasts** : durée par défaut 3,5 s (toast.js) et plus AUCUN toast de succès nulle part
    (les erreurs restent). Ne pas en réintroduire.
  · **Courbe « Volume »** : la métrique `tonnage` est de retour dans MODES (charge,
    poids-du-corps) sous le libellé « Volume » — c'est le tonnage du domaine, seul le nom
    d'affichage change. Le tonnage reste absent des RÉSUMÉS (accueil, historique, détail).
  · Icônes : refonte complète terminée (76 clés inchangées, ~25 dessins refaits).
- v5 : thème VERT (le bleu est abandonné — ne pas le réintroduire), réglages en 5 `<details>`
  pliants, renommage de séance (`seance.nom` prime sur `modeleSnapshot.nom` partout),
  composeur sans réglage de répétitions (`repsCibles: null`).
- `tests.html` : 230/230 en navigateur au 2026-07-25 (v16 comprise). ⚠ En dev local, purger
  SW + caches AVANT de conclure à un bug : le précache sert d'anciens modules et un simple
  reload ne suffit pas (il se ré-enregistre à chaque boot). Voir le protocole complet en tête
  de fichier — et sa version courte : dérouler un vrai cycle de version.
- **Protocole de mise à jour : VÉRIFIÉ le 2026-07-25**, cinq cycles complets en navigateur
  (précache automatique, bandeau, ACTIVER/ACTIVE_OK, purge de l'ancienne coquille, nouvelle
  `APP_VERSION` en mémoire). Le doute de l'utilisateur venait de l'absence d'indicateur, pas
  d'une panne. Avant d'aller déboguer sw.js sur un rapport de ce genre, demander le numéro de
  Réglages → Application (et s'il porte la pastille « Mise à jour disponible ») : ça tranche.
- `views/modeles.js` référence encore `favori` (bascule cœur) : écran secondaire, inerte
  depuis la v6 (plus rien ne lit le flag). À nettoyer à l'occasion, sans urgence.
- Les écrans v2/v3/v4 n'ont PAS tous subi de revue adversariale complète (budget) : les défauts
  de cette base sont typiquement SILENCIEUX (écran vide, bouton inerte, courbe plate — jamais
  d'erreur console). En cas de bug rapporté, chercher d'abord une couture entre modules
  (nom de commit, clé d'icône, attribut aria, forme de retour).
- Souhait utilisateur non implémenté : import d'une capture d'écran de programme → séance
  (OCR hors-ligne peu fiable ; parsing fiable = API vision, en ligne + clé — choix non tranché).
