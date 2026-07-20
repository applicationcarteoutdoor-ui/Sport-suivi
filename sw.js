// sw.js — worker classique, obligatoirement a la RACINE du depot.
// La portee d'un service worker ne remonte jamais au-dessus de son propre repertoire : place
// ailleurs, il ne controlerait pas index.html.
//
// ⚠ Ce fichier ne contient NI numero de version NI liste d'assets, et c'est tout l'interet :
// le navigateur ne detecte une mise a jour que si sw.js differe d'un octet. Un correctif qui ne
// touche que views/seance.js laisserait donc sw.js identique, aucun nouveau worker ne serait
// installe, et le cache-first servirait l'ancien fichier POUR TOUJOURS, sans recours. Ici toute
// la verite vient de ./version.json, relu en no-store a chaque ouverture.

// ⚠ Prefixe OBLIGATOIRE : l'origine <utilisateur>.github.io est partagee par TOUS les depots du
// compte, et l'API caches est indexee par origine. Un caches.keys() non filtre detruirait donc
// les caches des autres projets Pages du meme utilisateur.
const PREFIX = 'muscu-shell-';
const META = 'muscu-meta';

const nomCache = (v) => PREFIX + v;

// ⚠ Un service worker est tue et relance a tout moment (quelques secondes d'inactivite suffisent) :
// une variable de module ne survit pas. La version active est donc RE-HYDRATEE depuis le cache META
// a chaque reveil ; versionPromise n'est qu'une memoisation intra-reveil, remise a null des que la
// valeur change.
let versionPromise = null;

function versionActive() {
  if (!versionPromise) {
    versionPromise = caches
      .open(META)
      .then((c) => c.match('active'))
      .then((r) => (r ? r.text() : null))
      .catch(() => null);
  }
  return versionPromise;
}

// Ecrit la version active dans le cache META et invalide la memoisation.
async function definirVersionActive(version) {
  const c = await caches.open(META);
  await c.put('active', new Response(version));
  versionPromise = null; // sinon le prochain appel renverrait l'ancienne valeur memoisee
}

// Supprime tous les caches de coquille sauf celui de la version conservee.
async function purgerAnciensCaches(versionConservee) {
  const noms = await caches.keys();
  const aGarder = versionConservee ? nomCache(versionConservee) : null;
  await Promise.all(
    noms.filter((n) => n.startsWith(PREFIX) && n !== aGarder).map((n) => caches.delete(n))
  );
}

async function precache(manifest) {
  if (!manifest || !manifest.version || !Array.isArray(manifest.assets)) {
    throw new Error('version.json invalide : version et assets[] sont requis');
  }
  const cache = await caches.open(nomCache(manifest.version));
  const echecs = [];
  // ⚠ fetch INDIVIDUELS, jamais cache.addAll : addAll rejette avec une erreur GENERIQUE qui ne dit
  //   pas quel fichier a echoue — impossible a diagnostiquer sur un telephone.
  // ⚠ {cache:'reload'} : GitHub Pages sert TOUT en Cache-Control max-age=600. Sans cette option on
  //   precacherait des fichiers vieux de 10 minutes, en melangeant deux versions de modules ES dans
  //   un meme cache — l'incoherence la plus difficile a reproduire qui soit.
  await Promise.all(
    manifest.assets.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { cache: 'reload' }));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await cache.put(u, res);
      } catch (e) {
        echecs.push(u + ' → ' + e.message);
      }
    })
  );
  if (echecs.length) {
    // ⚠ Un cache PARTIEL active est pire qu'un echec franc : l'application demarre puis casse
    //   hors-ligne sur un module manquant. On detruit et on rejette.
    await caches.delete(nomCache(manifest.version));
    throw new Error(echecs.join('\n'));
  }
}

self.addEventListener('install', (e) => {
  // ⚠ PAS de skipWaiting() automatique : servir une coquille v2 a du code v1 deja charge en memoire
  //   donne des modules ES incoherents et des 404 sur des fichiers disparus. Le seul declencheur
  //   legitime est le message SKIP_WAITING, arme par un clic explicite de l'utilisateur.
  e.waitUntil(
    (async () => {
      const m = await fetch('./version.json', { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('version.json HTTP ' + r.status);
        return r.json();
      });
      await precache(m);
      // Toute PREMIERE installation uniquement : sans version active, rien ne serait servi depuis
      // le cache. Sur une mise a jour, la bascule reste la decision de l'application (ACTIVER).
      if (!(await versionActive())) await definirVersionActive(m.version);
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const active = await versionActive();
      await purgerAnciensCaches(active);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // ⚠ garde-fou : un POST ne se met pas en cache
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== location.origin) return; // ⚠ on ne s'interpose jamais sur une autre origine
  // ⚠ version.json n'est JAMAIS servi depuis le cache : c'est a la fois le canal de mise a jour et
  //   le kill switch. Mis en cache, il ne pourrait plus jamais annoncer sa propre succession.
  if (url.pathname.endsWith('/version.json')) return;

  e.respondWith(
    (async () => {
      const v = await versionActive();
      const cache = v ? await caches.open(nomCache(v)) : null;
      const hit = cache ? await cache.match(req) : null;
      if (hit) return hit;
      try {
        // ⚠ REPLI RESEAU OBLIGATOIRE. Un respondWith() qui resout sur undefined produit une erreur
        //   reseau MEME EN LIGNE : tout ce qui n'est pas precache (une icone ajoutee, une route
        //   oubliee dans assets[]) deviendrait definitivement inaccessible.
        return await fetch(req);
      } catch (err) {
        // Hors-ligne sur une navigation : on sert la coquille, le routeur par hash fera le reste.
        if (req.mode === 'navigate' && cache) {
          const shell = (await cache.match('./index.html')) || (await cache.match('./'));
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});

self.addEventListener('message', (e) => {
  const m = e.data || {};
  const source = e.source;
  const repondre = (msg) => {
    if (source) source.postMessage(msg);
  };

  // SEUL declencheur legitime de skipWaiting : un clic sur « Recharger ».
  if (m.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Cas NORMAL de mise a jour : seuls des assets ont change, sw.js est reste identique.
  // On precache la nouvelle version en tache de fond, sans rien basculer.
  if (m.type === 'PRECACHE') {
    e.waitUntil(
      precache(m.manifest)
        .then(() => repondre({ type: 'PRECACHE_OK', version: m.manifest && m.manifest.version }))
        .catch((err) => repondre({ type: 'PRECACHE_KO', message: err.message }))
    );
    return;
  }

  // Bascule effective, apres PRECACHE_OK et acceptation de l'utilisateur.
  if (m.type === 'ACTIVER') {
    e.waitUntil(
      (async () => {
        try {
          if (!m.version) throw new Error('ACTIVER sans version');
          await definirVersionActive(m.version);
          await purgerAnciensCaches(m.version);
          repondre({ type: 'ACTIVE_OK', version: m.version });
        } catch (err) {
          repondre({ type: 'ACTIVE_KO', message: err.message });
        }
      })()
    );
    return;
  }

  // Kill switch ATTEIGNABLE : declenche par "kill": true dans version.json (lu en no-store, donc
  // toujours joignable). Purge tous les caches du projet et desenregistre le worker, ce qui rend
  // la main au reseau — unique porte de sortie si une version cassee a ete precachee.
  if (m.type === 'KILL') {
    e.waitUntil(
      (async () => {
        const noms = await caches.keys();
        // Prefixe 'muscu-' : couvre a la fois les coquilles et META, sans toucher aux autres depots.
        await Promise.all(noms.filter((n) => n.startsWith('muscu-')).map((n) => caches.delete(n)));
        versionPromise = null;
        await self.registration.unregister();
        repondre({ type: 'KILL_OK' });
      })()
    );
  }
});
