// lib/idb.js — enveloppe promisifiée d'IndexedDB.
// Aucune connaissance du domaine : ce module ne connaît ni les magasins ni les entités.
// Seule dépendance : bus.js, pour signaler les conflits de base aux couches supérieures.

import * as moduleBus from './bus.js';

// bus.js peut exposer son API en exports nommés ou via un objet (`default` / `bus`).
// On résout ici pour ne pas figer un style d'export chez le module voisin : un accès
// direct à `moduleBus.emit` casserait silencieusement si bus.js exportait un objet.
const bus = moduleBus.bus ?? moduleBus.default ?? moduleBus;

function signaler(type, charge) {
  // Le bus est le SEUL canal d'invalidation entre couches. S'il manque (chargement partiel),
  // on ne fait pas tomber une écriture de séance pour autant.
  try { bus?.emit?.(type, charge); } catch (_) { /* un abonné fautif ne casse pas l'IDB */ }
}

/**
 * Ouvre (ou crée) une base IndexedDB.
 *
 * @param {string} nom
 * @param {number} version
 * @param {(db: IDBDatabase, ancienneVersion: number, tx: IDBTransaction) => void} [onUpgrade]
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<IDBDatabase>}
 */
export function ouvrir(nom, version, onUpgrade, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB indisponible sur cet appareil.'));
      return;
    }

    let regle = false;
    let minuteur = null;

    const terminer = (action) => {
      if (regle) return;
      regle = true;
      if (minuteur !== null) clearTimeout(minuteur);
      action();
    };

    let requete;
    try {
      requete = indexedDB.open(nom, version);
    } catch (err) {
      // Navigation privée sur certains WebKit : open() jette au lieu de renvoyer une requête.
      terminer(() => reject(err));
      return;
    }

    // ⚠ Bug WebKit connu en mode standalone, et navigation privée : la requête d'ouverture ne
    // se résout NI ne rejette JAMAIS. Sans ce garde-fou, toute la chaîne d'amorçage reste
    // suspendue et l'écran de secours n'est jamais atteint — donc écran blanc définitif.
    minuteur = setTimeout(() => {
      terminer(() => reject(new Error(
        `Ouverture d'IndexedDB « ${nom} » sans réponse après ${timeoutMs} ms.`
      )));
    }, timeoutMs);

    requete.onupgradeneeded = (ev) => {
      if (typeof onUpgrade !== 'function') return;
      // La transaction de migration est portée par la requête : la passer évite qu'onUpgrade
      // n'en ouvre une seconde, ce qui interbloquerait la mise à niveau.
      onUpgrade(requete.result, ev.oldVersion, requete.transaction, ev);
    };

    requete.onsuccess = () => {
      const db = requete.result;

      if (regle) {
        // Le délai a déjà expiré et l'appelant est parti sur l'écran de secours : garder une
        // connexion ouverte bloquerait toute réouverture ultérieure.
        try { db.close(); } catch (_) { /* rien à faire */ }
        return;
      }

      // Un autre onglet demande une montée de version : on ferme immédiatement, sinon c'est
      // LUI qui reçoit onblocked et reste coincé.
      db.onversionchange = () => {
        try { db.close(); } catch (_) { /* rien à faire */ }
        signaler('db:conflit', { cause: 'versionchange', nom });
      };

      db.onclose = () => signaler('db:conflit', { cause: 'fermeture', nom });

      terminer(() => resolve(db));
    };

    requete.onerror = () => {
      terminer(() => reject(requete.error ?? new Error(`Ouverture d'IndexedDB « ${nom} » refusée.`)));
    };

    // On ne rejette PAS ici : l'autre onglet peut encore libérer la base et l'ouverture
    // aboutir. Si personne ne cède, c'est le délai ci-dessus qui tranche.
    requete.onblocked = () => signaler('db:conflit', { cause: 'blocked', nom, version });
  });
}

/**
 * Exécute une transaction sur un magasin et résout sur `oncomplete`.
 * Résoudre sur le succès de la requête plutôt que sur la fin de la transaction ferait croire
 * qu'une écriture est durable alors que la transaction peut encore avorter.
 */
function transiger(db, magasin, mode, corps) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(magasin, mode);
    } catch (err) {
      reject(err);
      return;
    }

    let resultat;
    try {
      const requete = corps(tx.objectStore(magasin));
      if (requete) requete.onsuccess = () => { resultat = requete.result; };
    } catch (err) {
      try { tx.abort(); } catch (_) { /* déjà avortée */ }
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(resultat);
    tx.onerror = () => reject(tx.error ?? new Error(`Transaction « ${magasin} » en échec.`));
    tx.onabort = () => reject(tx.error ?? new Error(`Transaction « ${magasin} » avortée.`));
  });
}

/** Lit un enregistrement. Résout sur `undefined` si la clé est absente. */
export function get(db, magasin, cle) {
  return transiger(db, magasin, 'readonly', (s) => s.get(cle));
}

/** Lit tout le magasin. */
export function getAll(db, magasin) {
  return transiger(db, magasin, 'readonly', (s) => s.getAll());
}

/** Écrit (ou remplace) un enregistrement. Résout sur la clé. */
export function put(db, magasin, valeur) {
  return transiger(db, magasin, 'readwrite', (s) => s.put(valeur));
}

/** Supprime un enregistrement. Silencieux si la clé est absente (comportement IDB). */
export function del(db, magasin, cle) {
  return transiger(db, magasin, 'readwrite', (s) => s.delete(cle));
}

/**
 * Écrit un lot dans UNE seule transaction.
 * ⚠ Aucun `await` sur autre chose qu'une requête IDB à l'intérieur : une transaction
 * IndexedDB s'auto-valide dès que la pile d'appels se vide. Un `await fetch()`, un
 * `await new Promise(setTimeout)` ou même un microtask non-IDB entre deux `put()` rendrait
 * la transaction inactive et ferait échouer les écritures suivantes.
 * Les `put()` sont donc empilés de façon strictement synchrone.
 */
export function putBatch(db, magasin, valeurs) {
  const lot = Array.from(valeurs ?? []);
  if (!lot.length) return Promise.resolve(0);

  return transiger(db, magasin, 'readwrite', (s) => {
    for (const valeur of lot) s.put(valeur);
    return null; // le résultat utile est le nombre d'éléments, renvoyé ci-dessous
  }).then(() => lot.length);
}
