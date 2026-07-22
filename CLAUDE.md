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

## État et risques connus (2026-07-22, v11 livrée)

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

- v8 en ligne :
  · **Panneau superposé** (ui/router.js) : une route `panneau: true` (boot.js — le détail
    `#/historique/:id`) atteinte DEPUIS une vue montée s'ouvre dans `#panneau-hote`
    (index.html, zone A, z 38 SOUS la feuille 40) par-dessus la vue de fond qui reste MONTÉE
    et abonnée — le retour la retrouve intacte, scroll compris. Accès direct/rechargement =
    pleine page (repli assumé). `fermerPanneau()` avant toute autre navigation.
  · **Progression** : « Volume » est la PREMIÈRE métrique (ordre de MODES.metriques =
    métrique par défaut) ; pour un exercice seul, DEUX graphes toujours empilés — métrique
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
    datée ni de note CDN ni de lien diagnostic ; groupes remis à l'état PAR DÉFAUT quand la
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
- `tests.html` : 214/214 en navigateur au 2026-07-21 (v6 comprise). ⚠ En dev local, purger
  SW + caches AVANT de conclure à un bug : le précache sert d'anciens modules et un simple
  reload ne suffit pas (il se ré-enregistre à chaque boot).
- `views/modeles.js` référence encore `favori` (bascule cœur) : écran secondaire, inerte
  depuis la v6 (plus rien ne lit le flag). À nettoyer à l'occasion, sans urgence.
- Les écrans v2/v3/v4 n'ont PAS tous subi de revue adversariale complète (budget) : les défauts
  de cette base sont typiquement SILENCIEUX (écran vide, bouton inerte, courbe plate — jamais
  d'erreur console). En cas de bug rapporté, chercher d'abord une couture entre modules
  (nom de commit, clé d'icône, attribut aria, forme de retour).
- Souhait utilisateur non implémenté : import d'une capture d'écran de programme → séance
  (OCR hors-ligne peu fiable ; parsing fiable = API vision, en ligne + clé — choix non tranché).
