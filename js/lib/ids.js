// lib/ids.js — generation d'identifiants.
// Les ids de l'application sont des ULID : leur tri lexicographique EST leur tri chronologique.
// C'est ce qui permet a une Serie de n'avoir aucun champ `index` et a une liste de series
// d'etre simplement l'ordre du tableau, sans compteur a maintenir ni a reindexer.

// Alphabet Crockford base32 : ni I, ni L, ni O, ni U — les caracteres confondables avec 1/0
// et la seule voyelle qui fabrique des mots malheureux sont exclus. 32 symboles = 5 bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LONGUEUR_TEMPS = 10;      // 10 x 5 bits = 50 bits, soit des dates jusqu'en l'an 10889
const LONGUEUR_ALEA = 16;       // 16 x 5 bits = 80 bits d'aleatoire

// Etat de monotonie : conserve entre deux appels dans la meme milliseconde.
let dernierTemps = -1;
/** @type {number[]} */
let dernierAlea = [];

/**
 * Remplit un tableau de `n` valeurs entieres dans [0,31].
 * @param {number} n
 * @returns {number[]}
 */
function tirerAlea(n) {
  const out = new Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const octets = new Uint8Array(n);
    c.getRandomValues(octets);
    // 256 est un multiple exact de 32 : le modulo ne cree donc aucun biais de distribution
    // (ce ne serait pas vrai avec un alphabet dont la taille ne divise pas 256).
    for (let i = 0; i < n; i++) out[i] = octets[i] % 32;
    return out;
  }
  // Repli : contexte non securise (http://) ou moteur ancien. La collision reste improbable
  // et un id duplique ne corrompt rien de plus qu'une ligne de serie.
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 32);
  return out;
}

/**
 * Encode un horodatage epoch ms sur 10 symboles Crockford.
 * @param {number} ms
 * @returns {string}
 */
function encoderTemps(ms) {
  let reste = ms;
  const chars = new Array(LONGUEUR_TEMPS);
  for (let i = LONGUEUR_TEMPS - 1; i >= 0; i--) {
    const mod = reste % 32;
    chars[i] = ALPHABET[mod];
    reste = (reste - mod) / 32;   // ⚠ soustraction puis division, jamais un decalage binaire :
  }                               //    un epoch ms depasse 2^32 et >>> le tronquerait.
  return chars.join('');
}

/**
 * Incremente en place la partie aleatoire (arithmetique base 32, retenue vers la gauche).
 * @param {number[]} alea
 * @returns {boolean} false en cas de debordement complet (tous les symboles a 31)
 */
function incrementerAlea(alea) {
  for (let i = alea.length - 1; i >= 0; i--) {
    if (alea[i] < 31) { alea[i]++; return true; }
    alea[i] = 0;
  }
  return false;
}

/**
 * Identifiant ULID : 26 caracteres Crockford base32, triable chronologiquement.
 * Monotone : deux appels dans la meme milliseconde produisent deux ids croissants.
 * @returns {string}
 */
export function ulid() {
  const maintenant = Date.now();
  // ⚠ Si l'horloge systeme recule (changement d'heure, synchronisation NTP), on GELE le temps
  //    sur la derniere valeur emise : un id anterieur casserait l'ordre du tableau de series
  //    et la reprise apres coupure repartirait sur une serie qui n'est pas la derniere.
  const temps = maintenant > dernierTemps ? maintenant : dernierTemps;

  if (temps === dernierTemps && dernierAlea.length) {
    // Meme milliseconde : on incremente au lieu de retirer, sinon deux series validees
    // coup sur coup pourraient sortir dans le desordre.
    if (!incrementerAlea(dernierAlea)) {
      // Debordement des 80 bits dans une seule milliseconde : theorique, mais on emprunte
      // une milliseconde au futur plutot que de rendre un id non croissant.
      dernierTemps = temps + 1;
      dernierAlea = tirerAlea(LONGUEUR_ALEA);
      return encoderTemps(dernierTemps) + dernierAlea.map((v) => ALPHABET[v]).join('');
    }
  } else {
    dernierAlea = tirerAlea(LONGUEUR_ALEA);
  }
  dernierTemps = temps;

  return encoderTemps(temps) + dernierAlea.map((v) => ALPHABET[v]).join('');
}

/**
 * UUID v4. Utilise pour ce qui n'a pas besoin d'etre triable (jetons, correlations).
 * @returns {string}
 */
export function uuid() {
  const c = globalThis.crypto;
  // ⚠ randomUUID n'existe qu'en contexte securise (https ou localhost) : sur un serveur de
  //    test en http:// sur IP locale, il est absent alors que crypto l'est.
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  if (c && typeof c.getRandomValues === 'function') {
    const o = new Uint8Array(16);
    c.getRandomValues(o);
    o[6] = (o[6] & 0x0f) | 0x40;   // version 4
    o[8] = (o[8] & 0x3f) | 0x80;   // variante RFC 4122
    const hex = Array.from(o, (v) => v.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
           hex.slice(16, 20) + '-' + hex.slice(20);
  }

  // Dernier repli, sans garantie cryptographique.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (car) => {
    const r = Math.floor(Math.random() * 16);
    const v = car === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
