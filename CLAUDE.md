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

# Tests (~190 assertions : domaine pur, migrations, intégrité classes↔CSS, couture icônes) :
#   ouvrir http://127.0.0.1:8123/Sport-suivi/tests.html — doit être 100 % vert.
# Il n'y a pas de lanceur de test unitaire : tests.html EST le harnais (zéro dépendance).

# Vérifier la syntaxe d'un module (sw.js exclu : contexte worker) :
node --check js/views/seance-tableau.js

# Diagnostic de déploiement (zéro 404 exigé sur les assets déclarés) :
#   ouvrir http://127.0.0.1:8123/Sport-suivi/verif.html

# Livraison — LE rituel (voir aussi README.md, contrat de non-régression) :
#   1. bumper "version" dans version.json (format AAAA-MM-JJ-NN)
#   2. aligner APP_VERSION dans js/config.js sur la MÊME valeur (sinon boucle de mise à jour)
#   3. tout nouveau fichier livré doit être listé UN PAR UN dans version.json (jamais de glob) ;
#      verif.html et tests.html restent VOLONTAIREMENT hors liste
#   4. git add -A && git commit && git push   (Pages reconstruit ; CDN ≤ 10 min)
```

En dev local, le service worker sert son précache : pour voir un changement, purger caches +
désenregistrer le SW dans la console, ou dérouler le protocole PRECACHE/ACTIVER.

## Invariants absolus (chacun a déjà cassé une fois — d'où sa présence ici)

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
9. **Archiver, jamais supprimer un exercice** (les séances le référencent à vie). Une ROUTINE
   utilisateur (`usr:`) se supprime ; un modèle livré (`tpl:`) s'archive.
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

## Architecture — la vue d'ensemble qui demande plusieurs fichiers

**Flux de données.** `boot.js` (ordre d'amorçage NON négociable, commenté sur place : SW d'abord
sans await, puis prefs/miroir chaud, puis IDB→migrations→store→reprise→routeur, historique en
tâche de fond, écran de secours en catch). Les vues lisent le `store` (synchrone), écrivent par
`commit()`, apprennent les changements par `bus`. `domain/` est pur (aucun DOM, aucune I/O).
Direction stricte : `lib → data → domain → ui → views` (« est importé par »).

**Modèle de données** (js/data/schema.js, commenté) : l'INTENTION (Modele/routine, mutable,
champ `favori`) vs le FAIT (Seance, immuable, qui porte un `modeleSnapshot` copié et ses
coefficients gelés). `Serie.at` (epoch ms) est l'horodatage de validation ; le repos réel en est
DÉRIVÉ. `lestKg` est SIGNÉ (−20 = assistance élastique). `meta.lastPerf` est le seul dérivé
persisté (reconstructible).

**Écrans clés.** `views/seance-tableau.js` est l'écran de séance ACTUEL : tableau façon carnet —
colonne exercice + colonnes de séries en GRILLE partagée (`--tab-cols`, posée par `majEntete`,
minimum 8 colonnes TOUTES visibles sans défilement), cellules à `data-etat`
(faite/attente/ratee/future), éditeur en feuille (steppers + pavé), « Terminer » dans la page.
(`views/seance.js`, l'ancien accordéon, n'est plus routé mais reste livré.) `views/composeur.js`
sert 3 routes (séance, routine, édition de routine) : packs → grille d'icônes triée par USAGE →
lignes réglables. `ui/drawer-minuteur.js` (chrono + rebours, état = horodatages persistés,
recalé sur visibilitychange/pageshow) est monté UNE fois par boot, hors routeur : il survit aux
changements d'écran. `ui/chart.js` : multi-séries (≤4), et DEUX unités différentes = deux axes Y
(gauche/droite) — au-delà, refus explicite.

**Icônes** (js/ui/icons.js, ~75 dessins) : convention stricte — l'icône d'un exercice du
catalogue est son id privé de son préfixe (`cat:squat` → `'squat'`) ; résolution TOUJOURS par
`iconePourExercice()` (repli pack puis générique), jamais `ex.icone` directement (les exercices
créés par l'utilisateur n'en ont pas). Nouvel exercice catalogue = nouveau dessin + le champ
`icone` est dans `CHAMPS_SYNCHRONISES` (catalog.js). `currentColor` partout ; le **cœur** est
réservé aux FAVORIS, le cardio est le coureur qui transpire.

## Préférences utilisateur (produit — à respecter dans toute évolution)

- Interface VISUELLE : icônes, cartes, peu de texte. Saisie en séance = TABLEAU façon carnet.
- Minuteur/chrono : dans le tiroir latéral uniquement, jamais dans le flux des séries.
- PAS de popups de succès (les erreurs, si). PAS d'affichage de tonnage (le domaine le calcule
  toujours ; seul l'affichage est retiré). PAS de réglage de temps de repos.
- Les exercices les plus utilisés passent devant ; les séances favorites (cœur) en tête de
  l'accueil ; date d'une séance modifiable (passé ou futur).
- L'utilisateur écrit en français avec des fautes de frappe : interpréter avec bienveillance.
- Coût : limiter les agents (2-3 max, effort mesuré) — deux vagues massives ont épuisé son
  budget mensuel ; les petites retouches se font en direct.

## État et risques connus (2026-07-21, v5 livrée)

- v5 en ligne : **thème VERT** (tokens.css seul, bleu abandonné — ne pas le réintroduire),
  réglages regroupés en 5 `<details>` pliants (`pli-reglages`), renommage de séance
  (`seance.nom`, prime sur `modeleSnapshot.nom` dans TOUTES les vues — le snapshot n'est jamais
  réécrit), cœur d'historique à état (`aria-pressed`, détection par nom de routine favorite),
  composeur sans réglage de répétitions (`repsCibles: null` — les reps se saisissent en salle),
  menu de séance en actions empilées, bouton menu de carte en coin (40 px).
- v4 : favoris, double courbe poids+reps, date modifiable, tri par usage, confirmations
  de suppression harmonisées, bouton « Rechercher une mise à jour » (réglages).
- `tests.html` : 214/214 en navigateur au 2026-07-21 (v5 comprise). ⚠ En dev local, purger
  SW + caches AVANT de conclure à un bug : le précache sert d'anciens modules et un simple
  reload ne suffit pas (il se ré-enregistre à chaque boot).
- Icônes : retouches ponctuelles v5 (haltères, cœur — un SEUL tracé fermé, requis par le
  remplissage CSS du favori —, composer). La refonte complète souhaitée par l'utilisateur
  reste À FAIRE si redemandée.
- Les écrans v2/v3/v4 n'ont PAS tous subi de revue adversariale complète (budget) : les défauts
  de cette base sont typiquement SILENCIEUX (écran vide, bouton inerte, courbe plate — jamais
  d'erreur console). En cas de bug rapporté, chercher d'abord une couture entre modules
  (nom de commit, clé d'icône, attribut aria, forme de retour).
- Souhait utilisateur non implémenté : import d'une capture d'écran de programme → séance
  (OCR hors-ligne peu fiable ; parsing fiable = API vision, en ligne + clé — choix non tranché).
