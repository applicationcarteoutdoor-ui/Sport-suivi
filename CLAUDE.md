# Sport-suivi — mémoire du projet (pour Claude et tout agent)

> **Lis ce fichier EN ENTIER avant de toucher au code.** Il condense ~25 000 lignes de décisions,
> trois vagues de revues adversariales et une dizaine de bugs silencieux déjà payés une fois.
> Repartir de zéro, c'est les payer une deuxième fois.

## Ce que c'est

PWA de suivi de musculation, **100 % hors-ligne**, installée sur le téléphone de l'utilisateur.
- Dépôt GitHub : `applicationcarteoutdoor-ui/Sport-suivi` → servie sur
  `https://applicationcarteoutdoor-ui.github.io/Sport-suivi/`
- **HTML/CSS/JS vanilla. Modules ES natifs. AUCUNE dépendance, AUCUN build.**
- Interface en **français avec les accents**. Commentaires sans accents acceptés.
- Utilisateur unique, qui remplace un carnet papier. Critère : noter une série plus vite qu'au stylo.

## Invariants absolus (chacun a déjà cassé une fois — d'où sa présence ici)

1. **AUCUN `innerHTML`**, nulle part. `createElement`/`createElementNS`/`textContent` via
   `js/lib/dom.js` (`h()`, `svg()`). Corollaire : zéro problème d'échappement.
2. **AUCUN état fonctionnel dans `requestAnimationFrame`.** rAF ne s'exécute pas quand la page
   n'est pas rendue (arrière-plan, throttling mobile). Trois bugs de cette classe déjà corrigés,
   dont « Terminer la séance » totalement inopérant. Pour rendre un panneau visible :
   `void el.offsetHeight;` puis poser l'attribut SYNCHRONEMENT.
3. **Toute classe CSS posée par le JS doit avoir une règle dans `css/`.** `tests.html` échoue
   sinon (groupe « intégrité »). Le vocabulaire BEM (`__`, `--`) est **banni** — une divergence
   de nommage a laissé toute la coquille sans style, sans aucune erreur console.
   Astuce : pour des ÉTATS, préférer `data-etat="..."` aux classes.
4. **`version.json` fait foi** : chaque fichier livré y est listé UN PAR UN. Un asset déclaré
   absent ⇒ le précache **entier** échoue ⇒ plus aucun mode hors-ligne. Un module oublié ⇒
   écran blanc hors-ligne. `verif.html` et `tests.html` restent VOLONTAIREMENT hors liste.
5. **`APP_VERSION` (js/config.js) = `version` (version.json)**, toujours. S'ils divergent,
   le bandeau de mise à jour boucle à chaque ouverture.
6. **`MODES` (js/data/schema.js) est l'UNIQUE point de polymorphisme.** Aucun `if` sur un mode
   ailleurs (seule exception : `chargeEffectiveKg` dans domain/metrics.js). Champs de saisie via
   `champsSaisie` / `champsSaisieEntree`, pas via des tests sur le mode.
7. **Coefficients GELÉS sur l'entrée de séance** (`modeUtilise`, `lestableUtilise`,
   `incrementKgUtilise`, `bodyweightFactorUtilise`, `machineProfileUtilise`,
   `unilateralUtilise`). On lit l'entrée, JAMAIS l'exercice courant, pour interpréter un fait.
8. **`estComptable(serie)`** filtre tout agrégat (done && kind ≠ échauffement).
   **`estSeanceComptable(seance)`** remplace tout `statut === 'terminee'` dans les agrégats.
   Une séance **abandonnée** reste VISIBLE dans l'historique (`estSeanceClose`) mais n'entre
   dans AUCUNE courbe.
9. **Archiver, jamais supprimer un exercice** (les séances le référencent à vie).
   Une ROUTINE utilisateur (`usr:`) se supprime ; un modèle livré (`tpl:`) s'archive.
10. **Dates locales** : `dayKey()` (jamais `toISOString` — une séance à 23 h basculerait au
    lendemain). Comparaison de dayKey = comparaison de chaînes.
11. **Aucun chemin absolu commençant par `/`** (imports, CSS, HTML, SW). Unique exception
    nommée : `manifest.id` (`/Sport-suivi/`). **Ne jamais renommer le dépôt** : casserait
    l'identité PWA des installations.
12. **`DB_VERSION = 1 à vie** (IndexedDB, 6 magasins créés au 1er commit). Les évolutions passent
    par `SCHEMA_VERSION` + `data/migrations.js` (pures, synchrones, testables). Séquence :
    sauvegarde → up() → écriture → RELECTURE ET VÉRIFICATION → purge.
13. **Écran de séance : aucun `<input>`.** Valeurs en JS, steppers (`ui/stepper.js`) et pavé
    interne (`ui/keypad.js`). Supprime zoom iOS, conflit virgule/point, champ masqué.
14. **Contrat de rendu** : une vue construit son DOM UNE FOIS ; jamais de re-rendu global
    (il détruirait scroll, focus, bouton sous le doigt). Mutations ciblées. `mount(conteneur,
    params) → { destroy(), onParams(params) }` ; `destroy()` coupe TOUS les abonnements.
    Une feuille est un PARAMÈTRE de route (`#/seance?sheet=x`), jamais une route.
15. **`store.commit(type, payload)`** est le seul chemin d'écriture des vues (voir
    `typesDeCommit()` dans data/store.js pour les noms EXACTS). L'invalidation passe par `bus`.
16. **`localStorage 'muscu:hot'`** = cache de reprise, JAMAIS la source de vérité.
17. Le service worker (`sw.js`, racine) ne contient NI version NI liste : il lit `version.json`
    (`no-store`). Ne pas toucher au protocole PRECACHE/ACTIVER/KILL sans relire le README.

## Rituels de vérification

- `python -m http.server 8123` depuis le dossier **PARENT**, puis
  `http://127.0.0.1:8123/Sport-suivi/` — tester à la racine masque les bugs de sous-chemin.
- `tests.html` : ~190 assertions, doit être **100 % vert** (inclut l'intégrité classes↔CSS et
  la couture icônes↔catalogue↔packs).
- `verif.html` : zéro 404 sur les assets déclarés.
- `node --check` passe sur tous les modules de `js/` (sauf `sw.js`, contexte worker).
- Chaque livraison : bump `version.json` **ET** `APP_VERSION`, ajouter les nouveaux fichiers
  aux assets.

## Carte du code

```
js/lib/      dom, bus, idb, ids, dates, num          — génériques purs
js/data/     schema (MODES, fabriques), catalog (40 exos), packs (7 packs), templates,
             store (état + commit), hot, prefs, backup, migrations
js/domain/   metrics (e1rm, chargeEffective, tonnage), prefill (4 niveaux, filtre échauf),
             progression (réducteurs par métrique), session (machine à états)
js/ui/       icons (66 SVG, currentColor), router, sheet, stepper, keypad, set-row,
             picker-exercice, chart (multi-séries), toast, drawer-minuteur (chrono+rebours),
             update (protocole SW), install, timer-view (OBSOLÈTE, plus monté)
js/views/    accueil, seance-tableau (écran séance ACTUEL, style tableau),
             seance (ANCIEN accordéon, conservé en référence), seance-fin, composeur
             (packs → grille d'icônes → lignes), historique, seance-detail, progression,
             exercices, modeles (routines), reglages
```

## Préférences utilisateur (à respecter dans toute évolution)

- Interface **visuelle** : icônes, cartes, défilements horizontaux, peu de texte.
- **Création** de séance : le composeur par packs, tel quel.
- **Saisie en séance** : TABLEAU façon carnet papier — colonne gauche = exercice (tap → lesté
  ou non, options), colonnes = séries, tap sur une case → +/− et pavé pour écrire.
- Minuteur/chrono : dans le **tiroir latéral** uniquement, jamais dans le flux des séries.
- Souhaits en attente : import d'une capture d'écran de programme (Insta/manga workout) →
  séance ; comparaison multi-exercices (fait) ; plusieurs séances en cours (fait).

## État et risques connus (2026-07-20)

- v1 + fondations v2 : testées et relues (3 vagues adversariales, ~40 défauts corrigés).
- Écrans v2 (composeur, progression, routines, accueil, tiroir) : **écrits mais JAMAIS passés
  en revue adversariale** (limite de dépenses atteinte en cours de vague). Défauts silencieux
  probables — c'est la dette n° 1.
- `views/seance.js` (accordéon) n'est plus routé mais reste dans les assets.
- Icônes : convention stricte `id sans préfixe` → clé de `ICONES`. Nouvel exercice catalogue =
  nouvelle icône + `icone` dans `CHAMPS_SYNCHRONISES`.
