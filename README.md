# Carnet Muscu

PWA de suivi de musculation. HTML/CSS/JavaScript vanilla, modules ES natifs, **aucune dependance,
aucune etape de build**. Hebergement GitHub Pages. Utilisable en salle **sans connexion**.

Le critere de reussite n'est pas la richesse fonctionnelle : c'est qu'**enregistrer une serie soit
plus rapide qu'avec un stylo**, et que trois ans de donnees ne se perdent jamais.

---

## Ce README est un contrat de non-regression

Ce n'est pas une presentation du projet. C'est la liste des invariants qui, s'ils sont rompus,
cassent l'installation, les donnees ou la capacite a livrer un correctif. Ils ne se devinent pas a
la lecture du code, et la plupart echouent **silencieusement** : rien ne casse en developpement,
tout casse chez l'utilisateur installe.

### Les 8 invariants

1. **Ne jamais renommer le depot.** Il s'appelle `Sport-suivi` a vie. Le renommer change l'URL de
   l'origine, donc `manifest.id`, donc l'identite de la PWA : les installations existantes
   deviennent orphelines et les donnees IndexedDB, liees a l'origine, deviennent inaccessibles.

2. **Ne jamais toucher a `id`, `start_url` ni `scope` dans `manifest.json`.** Meme consequence :
   une PWA installee dont l'`id` change est une **autre** application pour le navigateur.
   Ancienne icone morte, donnees perdues, aucun message d'erreur.

3. **`sw.js` reste a la racine du depot.** La portee d'un service worker ne remonte jamais
   au-dessus de son propre repertoire : un `sw.js` place dans `js/` ne pourrait pas controler
   `index.html`, et l'application ne fonctionnerait plus hors connexion.

4. **Aucun chemin ne commence par `/`.** Ni dans le CSS, ni dans le HTML, ni dans les imports ES,
   ni dans `navigator.serviceWorker.register()`, ni dans `version.json`. Le site est servi depuis
   un **sous-chemin** (`https://<user>.github.io/Sport-suivi/`) : un chemin absolu pointe vers la
   racine de `github.io`, hors du depot, et ne repond qu'un 404.

   > **Unique exception nommee : `manifest.id`, qui vaut `"/Sport-suivi/"`.**
   > `id` se resout contre l'**origine**, pas contre l'URL du manifest. `"./"` donnerait
   > `https://<user>.github.io/` et ferait collisionner l'identite de l'application avec **toute
   > autre PWA du meme compte GitHub**. L'omettre le fait deriver de `start_url`, si bien que
   > toute evolution ulterieure de `start_url` orphelinerait les installations existantes.
   > JSON n'admettant pas de commentaire, la justification vit ici et nulle part ailleurs.

5. **A chaque deploiement : bumper `version` ET mettre a jour `assets` dans `version.json`.**
   C'est le seul canal de mise a jour. `sw.js` ne contient ni version ni liste d'assets, justement
   pour qu'un correctif dans `views/seance.js` se propage sans que `sw.js` bouge d'un octet.
   La liste `assets` enumere **chaque fichier un par un** : jamais de glob, jamais de motif
   generique. Un fichier oublie n'est pas dans le cache, donc absent en mode avion.
   Garder `APP_VERSION` de `js/config.js` **aligne** sur le champ `version` : c'est la comparaison
   entre les deux qui declenche le bandeau.

6. **Aucun fichier ni dossier a underscore initial**, et `.nojekyll` present des le premier commit.
   GitHub Pages passe le depot dans Jekyll par defaut, qui **ignore purement et simplement** tout
   ce qui commence par `_`. Le fichier `.nojekyll` est vide : c'est sa presence qui compte.

7. **Checklist de release** (ci-dessous) : `verif.html` -> `tests.html` -> **test en mode avion sur
   l'application installee, depuis un sous-repertoire**. Le `Cache-Control: max-age=600` de GitHub
   Pages peut faire passer une mise a jour correcte pour un bug pendant 10 minutes.

8. **Kill switch.** Mettre `"kill": true` dans `version.json` fait purger tous les caches
   `muscu-*` et desenregistrer le service worker au prochain lancement. C'est le recours de
   derniere instance si une version cassee est en circulation. Le remettre a `false` ensuite.

### Deux regles internes du meme ordre

- **Zero `innerHTML`, partout, y compris dans le moteur SVG.** `createElement` /
  `createElementNS` / `textContent` exclusivement. Une regle sans exception est tenable ;
  « auditer les interpolations apres coup » ne se fait jamais. C'est aussi ce qui rend
  l'echappement HTML sans objet dans toute l'application.
- **Direction des dependances : `lib/` <- `data/` <- `domain/` <- `ui/` <- `views/`.**
  `domain/` est pur : aucun DOM, aucune I/O, aucun import de `data/` hors `schema.js`. Un cycle
  ESM produit une erreur de TDZ sans pile exploitable, quasi impossible a diagnostiquer sur
  telephone.

---

## Lancer en local — obligatoirement derriere un sous-chemin

Servir le dossier **parent**, jamais `Sport-suivi` lui-meme :

```
cd "D:\CODE CLAUDE\Sport suivi"     # dossier PARENT
python -m http.server 8000
```

Puis ouvrir : `http://localhost:8000/Sport-suivi/`

Tester a la racine (`http://localhost:8000/` avec `Sport-suivi` comme racine du serveur) masque
exactement la classe de bugs la plus couteuse : chemins absolus qui « marchent », portee du service
worker qui « marche », `manifest.start_url` qui « marche ». Tout casse une fois deploye.

Le service worker exige une origine sure : `localhost` en fait partie, une IP de reseau local non.
Pour tester depuis un telephone sur le meme reseau, passer par un tunnel HTTPS.

## Deployer sur GitHub Pages

1. Depot **public** nomme exactement `Sport-suivi`, sur le compte qui heberge les Pages.
2. Pousser le contenu de ce dossier a la **racine** du depot (`index.html`, `sw.js`,
   `version.json`, `.nojekyll` doivent etre a la racine, pas dans un sous-dossier).
3. Settings -> Pages -> Source : **Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. L'URL est `https://<user>.github.io/Sport-suivi/`. Elle est definitive.
5. Attendre la fin du deploiement, puis **forcer un rechargement** : GitHub Pages sert tout en
   `max-age=600`. Une mise a jour peut mettre 10 minutes a etre visible sans que rien ne soit
   casse.

Aucun workflow d'integration continue n'est necessaire : il n'y a pas d'etape de build.

## Checklist de release

A executer **dans cet ordre**, sans en sauter.

1. **`version.json`** : `version` bumpee (format `AAAA-MM-JJ-NN`) et `assets` complete des
   fichiers ajoutes ou renommes depuis la derniere release.
2. **`js/config.js`** : `APP_VERSION` identique au champ `version` ci-dessus.
3. **`verif.html`** sur l'URL deployee : **zero 404**. Il fetch chaque entree de `assets` et liste
   les manquants. Un seul manquant = l'application ne demarre pas en mode avion.
4. **`tests.html`** : **zero echec**. 170 assertions sur `domain/`, `data/`, `lib/` et l'integrite
   du vocabulaire de classes CSS.

> ⚠ `verif.html` et `tests.html` sont volontairement **hors de `version.json`** : ce sont des
> outils de diagnostic. Les precacher les ferait servir en cache-first, donc auditer le cache
> qu'ils sont justement censes verifier, et une version corrigee n'arriverait a l'utilisateur
> qu'apres un cycle complet de mise a jour. **Consequence assumee : ils exigent une connexion.**
> Ne comptez pas dessus pour diagnostiquer un probleme en salle, hors ligne.
5. **Installer l'application** (Android : menu « Installer » ; iOS : Partager -> Sur l'ecran
   d'accueil) depuis l'URL en sous-repertoire.
6. **Mode avion, ouvrir l'application** : elle demarre et une serie reste saisissable.
7. **Test de mise a jour** : bumper `version.json`, rouvrir l'application -> bandeau de mise a
   jour -> « Recharger » -> le nouveau contenu apparait. Et **aucun bandeau** si une seance est en
   cours : la proposition est mise en file jusqu'a la cloture.
8. **Test de reprise** : lancer une seance, tuer l'application en pleine serie, rouvrir ->
   reprise a la serie exacte, sans dialogue.
9. **Export** teste sur iOS **en standalone** : feuille de partage, jamais un echec silencieux.

En cas de regression grave deja en circulation : `"kill": true` dans `version.json`, pousser,
attendre la propagation, corriger, puis repasser a `false` avec une version bumpee.

---

## Structure

```
Sport-suivi/
├── .nojekyll          fichier VIDE, indispensable (invariant 6)
├── index.html         unique page. Coquille statique (zone A) + <main> vide
├── manifest.json      .json et non .webmanifest (la table MIME de l'hebergeur decide)
├── sw.js              RACINE obligatoire. Ne contient NI version NI liste d'assets
├── version.json       { version, assets[], kill } — JAMAIS mis en cache (no-store)
├── verif.html         diagnostic : fetch chaque asset, liste les 404
├── tests.html         ~30 assertions, zero dependance
├── icons/             192, 512, 512-maskable, apple-touch-180, favicon.svg
├── css/               tokens, base, components, views
└── js/
    ├── boot.js        SW d'abord, puis try/catch global, puis chaine d'init
    ├── config.js      NS, SCHEMA_VERSION, DB_NAME, DB_VERSION=1, APP_VERSION
    ├── lib/           dom, bus, idb, ids, dates, num
    ├── data/          schema, catalog, templates, migrations, store, hot, prefs, backup
    ├── domain/        metrics, prefill, progression, session   (PURS, testes)
    ├── ui/            router, chart, keypad, stepper, set-row, timer-view, sheet, toast,
    │                  picker-exercice, update, install
    └── views/         accueil, seance, seance-fin, historique, seance-detail, progression,
                       exercices, modeles, reglages
```

## Donnees

Source de verite : IndexedDB `muscu-carnet`, `DB_VERSION` **figee a 1 a vie** — tous les magasins
sont crees au premier commit, donc aucune montee de version n'aura jamais lieu et l'evenement
`onblocked` (insoluble sur mobile) devient structurellement impossible. Les evolutions du modele
passent par `SCHEMA_VERSION` et le pipeline de migrations, jamais par `DB_VERSION`.

`localStorage['muscu:hot']` est un **cache de reprise**, jamais la source de verite : il peut etre
efface sans aucune perte.

**L'export est le seul vrai filet de securite.** `StorageManager.persist()` n'est pas implemente
par Safari : sur iOS, cette protection est **inexistante**. Exporter regulierement — l'application
le rappelle au-dela de 30 jours.
