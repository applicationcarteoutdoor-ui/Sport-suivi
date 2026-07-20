// ui/timer-view.js — minuteur de repos.
//
// L'ETAT EST { finAt, totalSec } : un HORODATAGE DE FIN, jamais un compteur decremente.
// Un compteur meurt avec le gel de l'onglet en arriere-plan ; un horodatage survit a tout, y
// compris a un kill complet de l'application et a un retour depuis le bfcache.
//
// requestAnimationFrame est GELE en arriere-plan. Au retour, on ne « rattrape » pas les frames
// perdues : on RECALCULE a partir de Date.now(). D'ou le recalage obligatoire sur
// `visibilitychange` ET sur `pageshow`.
//
// Fragment vivant (zone C) : il possede les noeuds qu'il cree et ne remplace JAMAIS un noeud
// qu'il ne possede pas. Les noeuds de la coquille (#minuteur-valeur, #btn-minuteur) sont
// REUTILISES quand ils existent : seuls leur textContent, leurs classes et leurs attributs sont
// mutes, ce qui est exactement le regime de la zone A.

import { h, on } from '../lib/dom.js';
import { emit, on as onBus } from '../lib/bus.js';
import { formatDuree } from '../lib/num.js';
import { lire as lirePrefs } from '../data/prefs.js';

// ── AudioContext : UNIQUE pour toute l'application, cree au PREMIER GESTE UTILISATEUR ────────
// ⚠ Un AudioContext maintenu actif prend la session audio du systeme et coupe la musique de
//   l'utilisateur pendant toute sa seance. On le SUSPEND donc entre deux bips.
// ⚠ iOS suspend l'AudioContext des la mise en arriere-plan : un oscillateur planifie a l'avance
//   (source.start(ctx.currentTime + repos)) NE SE DECLENCHE PAS. Le bip est donc joue par un
//   setTimeout arme AU MOMENT DE L'ECHEANCE, jamais programme a l'avance.
let ctxAudio = null;

function amorcerAudio() {
  if (ctxAudio) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  try {
    ctxAudio = new Ctor();
    // Cree pendant un geste utilisateur (donc autorise), puis immediatement mis en veille.
    if (ctxAudio.state === 'running') ctxAudio.suspend();
  } catch (_) {
    ctxAudio = null;
  }
}

async function bip() {
  if (!ctxAudio) return;
  try {
    if (ctxAudio.state !== 'running') await ctxAudio.resume();
    const t = ctxAudio.currentTime;
    const osc = ctxAudio.createOscillator();
    const gain = ctxAudio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    // Enveloppe courte : un creneau brut produit un clic desagreable a chaque extremite.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(ctxAudio.destination);
    osc.start(t);
    osc.stop(t + 0.24);
    osc.onended = () => { try { ctxAudio.suspend(); } catch (_) { /* deja suspendu */ } };
  } catch (_) {
    // Session audio refusee (onglet jamais touche, mode silencieux materiel) : le canal VISUEL
    // reste le canal principal, on n'escalade pas une erreur pour un bip.
  }
}

/** Normalise un etat de repos venu du domaine. Retourne null si le repos est inexploitable. */
function normaliser(repos) {
  if (!repos) return null;
  const finAt = Number(repos.finAt);
  const totalSec = Number(repos.totalSec);
  if (!Number.isFinite(finAt)) return null;
  return { finAt, totalSec: Number.isFinite(totalSec) ? totalSec : 0 };
}

const memeRepos = (a, b) =>
  (a == null && b == null) || (a != null && b != null && a.finAt === b.finAt && a.totalSec === b.totalSec);

/** « 47 s » sous une minute, « 2:13 » au-dela — le retard se lit en secondes, pas en 0:47. */
const formatRetard = (sec) => (sec < 60 ? sec + ' s' : formatDuree(sec));

/**
 * Monte le minuteur de repos.
 *
 * @param {Element} el conteneur (typiquement #zone-minuteur de la coquille)
 * @param {{ onFin?: () => void }} [options]
 * @returns {{ synchroniser: (repos: {finAt:number,totalSec:number}|null) => void, detruire: () => void }}
 */
export function monter(el, options = {}) {
  const onFin = typeof options.onFin === 'function' ? options.onFin : null;

  // ── Etat ───────────────────────────────────────────────────────────────────────────────────
  let etat = null;        // { finAt, totalSec } local, seule verite d'affichage
  let refSync = null;     // dernier etat recu de l'appelant, pour ne pas ecraser une pause locale
  let pauseA = null;      // horodatage de mise en pause, ou null
  let finSignalee = false;
  let detruit = false;

  let raf = 0;
  let minuteurBip = 0;
  let verrou = null;      // WakeLockSentinel
  let jetonVerrou = 0;    // invalide une acquisition asynchrone devenue obsolete
  let dernierTexte = null;
  let dernierEtatVisuel = null;

  // ── Noeuds ─────────────────────────────────────────────────────────────────────────────────
  // La coquille (index.html) fournit deja la valeur et le bouton : on les REUTILISE. Les
  // reconstruire violerait le contrat de rendu — on ne remplace pas un noeud qu'on ne possede pas.
  // ⚠ Le fragment n'ajoute AUCUNE classe aux noeuds de la coquille : il ne les possede pas, et
  //   une classe posee ici ne serait jamais reprise par detruire(). Les classes de style sont
  //   portees NATIVEMENT par index.html.
  const valeurCoquille = el.querySelector('#minuteur-valeur');
  // Repli quand la coquille est absente (montage isole, tests) : ce noeud-la est POSSEDE, donc
  // cree avec sa classe et retire par detruire().
  const valeurPossedee = valeurCoquille ? null : h('output', { class: 'minuteur' }, '--:--');
  const valeur = valeurCoquille || valeurPossedee;
  if (valeurPossedee) el.appendChild(valeurPossedee);

  const basculeCoquille = el.querySelector('#btn-minuteur');
  const basculePossedee = basculeCoquille ? null : h(
    'button',
    { class: 'minuteur-bascule', type: 'button', disabled: true, 'aria-label': 'Démarrer ou arrêter le repos' },
    h('span', { 'aria-hidden': 'true' }, '▶')
  );
  const bascule = basculeCoquille || basculePossedee;
  if (basculePossedee) el.appendChild(basculePossedee);
  const glyphe = bascule ? (bascule.querySelector('span') || bascule) : null;

  // Mention compacte dans les 88 px de la zone (« +47 s », « pause »). Noeud POSSEDE.
  const mention = h('span', { class: 'minuteur-mention', 'aria-hidden': 'true' });
  el.appendChild(mention);

  // Panneau de commandes : POSSEDE par le fragment, pose au-dessus de la barre d'action.
  // Il ne recouvre jamais le bouton primaire — le minuteur ne bloque JAMAIS la validation d'une
  // serie. C'est aussi lui qui porte le compte a rebours GEANT (lisible a deux metres, telephone
  // pose au sol), les 88 px de la barre etant trop etroits pour le format --txt-geant.
  // ⚠ Il n'est visible QUE pendant le repos : des l'echeance atteinte (etat visuel « fini ») il
  //   se referme, sinon il recouvrirait l'ecran de seance jusqu'au repos suivant.
  const geant = h('output', { class: 'minuteur', style: { fontSize: 'var(--txt-geant)', lineHeight: '1', fontVariantNumeric: 'tabular-nums' } }, '--:--');
  const statut = h('p', { class: 'minuteur-mention', style: { margin: '0' } });
  const panneau = h('div', {
    class: 'minuteur-actions',
    hidden: true,
    style: {
      position: 'fixed',
      left: '0', right: '0',
      bottom: 'calc(var(--cible-geante) + var(--esp-3) + var(--esp-3) + var(--safe-bas))',
      zIndex: 'var(--z-barre)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--esp-3)',
      padding: 'var(--esp-2) var(--esp-3)',
      background: 'var(--surface)',
      borderTop: '1px solid var(--bordure)'
    }
  },
    h('div', { style: { flex: '1 1 auto', minWidth: '0' } }, geant, statut),
    h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-action': 'moins30' }, '−30 s'),
    h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-action': 'plus30' }, '+30 s'),
    h('button', { class: 'bouton', type: 'button', 'data-action': 'passer' }, 'Passer')
  );
  // ⚠ Rattache a un conteneur DECLARE (la barre d'action de la coquille) plutot qu'a
  //   document.body : le panneau disparait alors avec la barre hors seance, et il ne subsiste
  //   jamais de noeud orphelin a la racine du document. document.body n'est qu'un dernier
  //   recours (montage isole, tests).
  const hotePanneau = el.closest('#barre-action') || el.parentElement || document.body;
  hotePanneau.appendChild(panneau);

  // Bordure d'ecran de fin de repos. La regle CSS vise .coquille[data-repos='fini'].
  const coquille = document.querySelector('.coquille') || document.body;

  // ── Calculs ────────────────────────────────────────────────────────────────────────────────
  const resteMs = () => (etat ? etat.finAt - (pauseA != null ? pauseA : Date.now()) : null);

  function peindre() {
    if (!etat) {
      poser('--:--', '', '', null);
      return;
    }
    const ms = resteMs();
    if (ms > 0) {
      const sec = Math.ceil(ms / 1000);
      poser(formatDuree(sec), pauseA != null ? 'pause' : '', pauseA != null ? 'En pause' : 'Repos en cours', 'actif');
      return;
    }
    const retard = Math.floor(-ms / 1000);
    // ⚠ Jamais un zero muet : au retour d'arriere-plan, savoir DEPUIS QUAND le repos est fini
    //   est la seule information utile.
    poser('0:00', retard > 0 ? '+' + formatRetard(retard) : '', retard > 0 ? 'Repos terminé depuis ' + formatRetard(retard) : 'Repos terminé', 'fini');
  }

  function poser(texte, court, phrase, etatVisuel) {
    // Mutations CIBLEES et conditionnelles : ecrire un textContent identique a chaque frame
    // invaliderait la mise en page ~60 fois par seconde pour rien.
    if (texte !== dernierTexte) {
      dernierTexte = texte;
      valeur.textContent = texte;
      geant.textContent = texte;
    }
    if (mention.textContent !== court) mention.textContent = court;
    if (statut.textContent !== phrase) statut.textContent = phrase;

    if (etatVisuel !== dernierEtatVisuel) {
      dernierEtatVisuel = etatVisuel;
      if (etatVisuel) el.setAttribute('data-etat', etatVisuel);
      else el.removeAttribute('data-etat');
      if (etatVisuel === 'fini') coquille.setAttribute('data-repos', 'fini');
      else coquille.removeAttribute('data-repos');
      // ⚠ Le panneau ne suit PAS l'existence de l'etat (qui survit a l'echeance pour porter
      //   « terminé depuis 47 s ») mais l'etat VISUEL : seul « actif » le montre. Il se referme
      //   donc de lui-meme des la fin du repos.
      panneau.hidden = etatVisuel !== 'actif';
    }

    if (bascule) {
      bascule.disabled = !etat;
      bascule.setAttribute('aria-label', !etat ? 'Aucun repos en cours' : (pauseA != null ? 'Reprendre le repos' : 'Mettre le repos en pause'));
      if (glyphe) {
        const g = !etat || pauseA != null ? '▶' : '⏸';
        if (glyphe.textContent !== g) glyphe.textContent = g;
      }
    }
    el.setAttribute('aria-label', phrase || 'Minuteur de repos');
  }

  // ── Boucle ─────────────────────────────────────────────────────────────────────────────────
  function tick() {
    raf = 0;
    if (detruit) return;
    peindre();
    if (!etat || pauseA != null) return;
    if (resteMs() <= 0 && !finSignalee) signalerFin(false);
    // ⚠ On continue a tourner APRES la fin : c'est ce qui fait vivre « terminé depuis 47 s ».
    if (!document.hidden) raf = requestAnimationFrame(tick);
  }

  function relancer() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!detruit && etat && !document.hidden) raf = requestAnimationFrame(tick);
  }

  /**
   * @param {boolean} tardif true si la fin a ete DECOUVERTE au retour d'arriere-plan : ni bip ni
   *   vibration, qui n'auraient plus aucun sens plusieurs minutes apres l'echeance.
   */
  function signalerFin(tardif) {
    if (finSignalee) return;
    finSignalee = true;
    annulerBip();
    relacherVerrou();
    if (!tardif) {
      const prefs = lirePrefs();
      // 2. Vibration : sans effet mais sans erreur sur iOS.
      if (prefs.vibration && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([200, 100, 200]); } catch (_) { /* ignore */ }
      }
      // 3. Bip. Le VISUEL (peindre) est deja passe : c'est lui le canal fiable.
      if (prefs.son) bip();
    }
    peindre();
    emit('repos:fini', { repos: etat ? { ...etat } : null, tardif });
    if (onFin) { try { onFin(); } catch (err) { console.error('[timer-view] onFin', err); } }
  }

  function annulerBip() {
    if (minuteurBip) clearTimeout(minuteurBip);
    minuteurBip = 0;
  }

  /** Arme le declenchement de fin a l'echeance. Jamais un son planifie a l'avance. */
  function programmerEcheance() {
    annulerBip();
    if (!etat || pauseA != null || finSignalee) return;
    const ms = resteMs();
    if (ms <= 0) return;
    // Le setTimeout est un FILET : si l'onglet reste au premier plan, tick() atteint la fin en
    // premier. S'il est gele, recaler() prend le relais au retour.
    minuteurBip = setTimeout(() => { minuteurBip = 0; if (!detruit && !finSignalee) signalerFin(false); }, ms);
  }

  // ── Recalage : visibilitychange + pageshow (bfcache) ───────────────────────────────────────
  function recaler() {
    if (detruit) return;
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      annulerBip();
      relacherVerrou();
      return;
    }
    dernierTexte = null;              // force un repeint complet apres le gel
    if (etat && !finSignalee && resteMs() <= 0) {
      signalerFin(true);              // decouverte tardive : visuel seul
    } else {
      peindre();
      programmerEcheance();
    }
    acquerirVerrou();
    relancer();
  }

  // ── Wake Lock : OPT-IN, desactive par defaut ───────────────────────────────────────────────
  async function acquerirVerrou() {
    // ⚠ Garde de fonctionnalite obligatoire : absent avant iOS 16.4.
    if (!('wakeLock' in navigator)) return;
    if (verrou || detruit || document.hidden) return;
    if (!etat || finSignalee) return;
    if (!lirePrefs().wakeLockRepos) return;
    const jeton = ++jetonVerrou;
    try {
      const sentinelle = await navigator.wakeLock.request('screen');
      // Entre la demande et sa resolution, le repos a pu se terminer ou la vue etre demontee.
      if (jeton !== jetonVerrou || detruit || !etat) { try { sentinelle.release(); } catch (_) {} return; }
      verrou = sentinelle;
      sentinelle.addEventListener('release', () => { if (verrou === sentinelle) verrou = null; });
    } catch (_) {
      // Refus systeme (batterie faible) : le repos continue, seul l'ecran s'eteindra.
    }
  }

  function relacherVerrou() {
    jetonVerrou++;
    const sentinelle = verrou;
    verrou = null;
    if (sentinelle) { try { sentinelle.release(); } catch (_) { /* deja relache */ } }
  }

  // ── Commandes ──────────────────────────────────────────────────────────────────────────────
  /** Publie l'etat local. La vue le persiste (session.ajusterRepos / arreterRepos + commit). */
  function publier() {
    refSync = etat ? { ...etat } : null;
    emit('repos:modifie', { repos: refSync ? { ...refSync } : null });
  }

  function ajuster(delta) {
    if (!etat) return;
    // Meme arithmetique que domain/session.ajusterRepos : le total est borne a 0, sans quoi le
    // compte a rebours remonterait.
    const total = Math.max(0, etat.totalSec + delta);
    const applique = total - etat.totalSec;
    etat.totalSec = total;
    etat.finAt += applique * 1000;
    if (resteMs() > 0) finSignalee = false;
    programmerEcheance();
    peindre();
    relancer();
    publier();
  }

  function basculerPause() {
    if (!etat) return;
    if (pauseA == null) {
      pauseA = Date.now();
      annulerBip();
      relacherVerrou();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      peindre();
    } else {
      // Le temps passe en pause est reporte sur l'horodatage de fin : l'etat reste un finAt.
      etat.finAt += Date.now() - pauseA;
      pauseA = null;
      if (resteMs() > 0) finSignalee = false;
      programmerEcheance();
      peindre();
      acquerirVerrou();
      relancer();
    }
    publier();
  }

  function passer() {
    if (!etat) return;
    etat = null;
    pauseA = null;
    finSignalee = false;
    annulerBip();
    relacherVerrou();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    dernierTexte = null;
    peindre();
    publier();
  }

  // ── Ecouteurs ──────────────────────────────────────────────────────────────────────────────
  // ⚠ La pause n'est armee QUE sur le bouton de bascule, jamais sur les 88 px de la zone :
  //   telephone tenu d'une main, un appui legerement decale du bouton primaire mettrait sinon
  //   le repos en pause a l'insu de l'utilisateur, et rien a l'ecran ne le lui apprendrait
  //   avant plusieurs dizaines de secondes.
  const offCadran = bascule
    ? on(bascule, 'click', () => { amorcerAudio(); basculerPause(); })
    : () => {};

  const offPanneau = on(panneau, 'click', (ev) => {
    const cible = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
    if (!cible || !panneau.contains(cible)) return;
    amorcerAudio();                       // premier geste utilisateur : seul moment ou iOS l'autorise
    const action = cible.getAttribute('data-action');
    if (action === 'plus30') ajuster(30);
    else if (action === 'moins30') ajuster(-30);
    else if (action === 'passer') passer();
  });

  const offVisibilite = on(document, 'visibilitychange', recaler);
  const offPageshow = on(window, 'pageshow', recaler);   // retour depuis le bfcache
  // Un basculement de la preference Wake Lock en cours de repos doit prendre effet immediatement :
  // l'invalidation arrive par le bus, jamais par un appel direct depuis data/.
  const offPrefs = onBus('prefs:modifiees', ({ prefs }) => {
    if (!prefs || !Object.prototype.hasOwnProperty.call(prefs, 'wakeLockRepos')) return;
    if (prefs.wakeLockRepos) acquerirVerrou();
    else relacherVerrou();
  });

  // ── API ────────────────────────────────────────────────────────────────────────────────────
  /**
   * Reconcilie avec l'etat du domaine.
   * @param {{finAt:number,totalSec:number}|null} repos
   */
  function synchroniser(repos) {
    if (detruit) return;
    const suivant = normaliser(repos);
    // ⚠ Comparaison avec le DERNIER ETAT RECU, pas avec l'etat local : re-synchroniser avec une
    //   valeur inchangee ne doit pas annuler une pause en cours ni un +30 s local non encore
    //   persiste.
    if (memeRepos(suivant, refSync)) { peindre(); relancer(); return; }

    refSync = suivant ? { ...suivant } : null;
    etat = suivant ? { ...suivant } : null;
    pauseA = null;
    dernierTexte = null;
    dernierEtatVisuel = null;
    finSignalee = etat ? etat.finAt - Date.now() <= 0 : false;

    annulerBip();
    if (!etat || finSignalee) relacherVerrou(); else acquerirVerrou();
    peindre();
    programmerEcheance();
    relancer();
  }

  function detruire() {
    if (detruit) return;
    detruit = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    annulerBip();
    relacherVerrou();
    offCadran();
    offPanneau();
    offVisibilite();
    offPageshow();
    offPrefs();
    // Noeuds POSSEDES : on les retire. Noeuds de la coquille : on les REMET dans leur etat de
    // repos, on ne les supprime jamais.
    if (mention.parentNode) mention.parentNode.removeChild(mention);
    // Le panneau est POSSEDE : il est retire du DOM, quel que soit son hote. Il est aussi remis
    // a l'etat masque au cas ou une reference exterieure le conserverait.
    panneau.hidden = true;
    if (panneau.parentNode) panneau.parentNode.removeChild(panneau);
    if (valeurPossedee && valeurPossedee.parentNode) valeurPossedee.parentNode.removeChild(valeurPossedee);
    if (basculePossedee && basculePossedee.parentNode) basculePossedee.parentNode.removeChild(basculePossedee);
    el.removeAttribute('data-etat');
    el.setAttribute('aria-label', 'Minuteur de repos');
    coquille.removeAttribute('data-repos');
    // Noeuds de la COQUILLE : remis dans leur etat de repos, jamais supprimes.
    if (valeurCoquille) valeurCoquille.textContent = '--:--';
    if (basculeCoquille) {
      basculeCoquille.disabled = true;
      basculeCoquille.setAttribute('aria-label', 'Démarrer ou arrêter le repos');
      const g = basculeCoquille.querySelector('span') || basculeCoquille;
      g.textContent = '▶';
    }
  }

  peindre();
  return { synchroniser, detruire };
}
