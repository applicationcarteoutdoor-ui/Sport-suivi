// ui/set-row.js — la ligne de serie, fragment le plus sollicite de l'application.
//
// FRAGMENT VIVANT (zone C) : il possede son sous-arbre, ses steppers et ses ecouteurs. Valider une
// serie ne reconstruit RIEN : la ligne se fige elle-meme par mutation d'un attribut et d'un noeud
// texte. C'est ce qui laisse intacts le minuteur en cours, le defilement et le bouton sous le doigt.
//
// ⚠ POLYMORPHISME PAR MODES, JAMAIS PAR TESTS : les champs affiches derivent de
//   champsSaisieEntree(entree), donc de la table MODES. Il n'y a pas une seule comparaison sur le
//   nom d'un mode dans ce fichier, et un mode ajoute demain s'affiche sans y toucher.
// ⚠ TAP = EDITION. Une erreur de saisie reperee trois minutes plus tard doit rester reparable ;
//   sans ce chemin, elle est definitive. L'appui long ne sert plus qu'a SUPPRIMER.
// ⚠ AUCUN <input> : steppers et pave numerique interne, jamais le clavier systeme.

import { h, on, delegate } from '../lib/dom.js';
import { formatFr, formatDuree } from '../lib/num.js';
import { champsSaisieEntree, pasChamp } from '../data/schema.js';
import { resumeSerie, allureSecParKm, vitesseKmH } from '../domain/metrics.js';
import * as stepper from './stepper.js';
import * as keypad from './keypad.js';

// Appui long : 500 ms. Plus court, il se declenche sur un tap maladroit ; plus long, l'utilisateur
// croit que le geste ne fait rien et releve le doigt.
const MS_APPUI_LONG = 500;
const SEUIL_DEPLACEMENT_PX = 10;

/**
 * Libelles des champs de saisie. Ils vivent ici et non dans data/schema.js parce que ce sont des
 * libelles d'INTERFACE : le socle nomme les champs, l'interface les traduit.
 */
export const LIBELLES_CHAMPS = {
  reps: 'Répétitions',
  chargeKg: 'Charge',
  lestKg: 'Lest',
  valeur: 'Cran',
  dureeSec: 'Durée',
  distanceM: 'Distance'
};

export const UNITES_CHAMPS = {
  reps: '',
  chargeKg: 'kg',
  lestKg: 'kg',
  valeur: '',
  dureeSec: '',
  distanceM: 'm'
};

// Bornes et nature de chaque champ.
// ⚠ lestKg est SIGNE : +10 = lest, −20 = assistance elastique. Lui imposer un minimum a 0
//   rendrait la progression assistee -> non assistee inexprimable.
const NATURE_CHAMPS = {
  reps: { min: 0, max: 999, entier: true },
  chargeKg: { min: 0, max: 999, entier: false },
  lestKg: { min: -300, max: 300, entier: false, signe: true },
  valeur: { min: 0, max: 300, entier: false },
  dureeSec: { min: 0, max: 36000, entier: true },
  distanceM: { min: 0, max: 200000, entier: true }
};

const estNombre = (v) => typeof v === 'number' && Number.isFinite(v);

// Une duree se lit « 10:00 », jamais « 600 ». Tout le reste passe par le format francais.
function formateurDe(cle) {
  return cle === 'dureeSec' ? (v) => formatDuree(v) : (v) => formatFr(v);
}

/**
 * Description complete d'un champ pour un stepper ou pour le pave.
 * Exportee : la feuille d'edition d'une serie passee (views/seance-detail.js) doit produire
 * exactement les memes champs que la ligne en salle.
 */
export function descriptionChamp(entree, cle) {
  const nature = NATURE_CHAMPS[cle] || {};
  return {
    cle,
    label: LIBELLES_CHAMPS[cle] || cle,
    unite: UNITES_CHAMPS[cle] || '',
    // pasChamp resout la chaine 'incrementKg' de MODES contre l'exercice : on lui presente les
    // coefficients GELES de l'entree, jamais l'exercice tel qu'il est configure aujourd'hui.
    pas: pasChamp({ mode: entree && entree.modeUtilise, incrementKg: entree && entree.incrementKgUtilise }, cle),
    min: nature.min,
    max: nature.max,
    entier: nature.entier === true,
    signe: nature.signe === true,
    format: formateurDe(cle)
  };
}

/**
 * Monte une ligne de serie dans `el`.
 *
 * @param {Element} el
 * @param {Object} opts
 * @param {Object} opts.serie
 * @param {Object} opts.entree entree de seance, porteuse des COEFFICIENTS GELES
 * @param {'a-faire'|'en-edition'|'faite'|'non-faite'} [opts.etat]
 * @param {number} [opts.numero] rang affiche (1-based)
 * @param {'allure'|'vitesse'|null} [opts.metriqueCardio] derive affiche sous les steppers
 * @param {Object} [opts.callbacks]
 *        onEditer(serie) · onSupprimer(serie) · onChange(cle, valeur, valeurs) ·
 *        onKind(kind) · onNonFaite() · onPave(champs) *(surcharge l'ouverture du pave)*
 * @returns {{ figer:(s:Object)=>void, editer:()=>void, setValeur:(c:string,v:number)=>void,
 *             valeurs:()=>Object, etat:()=>string, detruire:()=>void }}
 */
export function monter(el, opts = {}) {
  const entree = opts.entree || {};
  const cb = opts.callbacks || {};
  let serie = opts.serie || {};

  // LA source du polymorphisme. Aucun autre endroit de ce fichier ne decide quels champs exister.
  const champs = champsSaisieEntree(entree);

  let etat = opts.etat || (serie.done === true ? 'faite' : 'a-faire');
  let detruit = false;

  // Brouillon : les valeurs vivent en JavaScript, jamais dans un attribut du DOM.
  const brouillon = {};
  for (const cle of champs) brouillon[cle] = estNombre(serie[cle]) ? serie[cle] : null;

  // ── Sous-arbre, construit UNE SEULE FOIS ─────────────────────────────────────
  const numero = h('span', { class: 'ligne-serie-numero' },
    opts.numero == null ? '' : String(opts.numero));

  const resume = h('output', { class: 'ligne-serie-resume' });

  // Un hote par champ. Les steppers y sont montes PARESSEUSEMENT, a la premiere edition, et ne
  // sont ensuite plus jamais detruits : ils sont seulement masques. Les detruire et les
  // reconstruire a chaque bascule ferait perdre le doigt pose dessus pendant une correction.
  const hotes = {};
  const steppers = {};
  const zoneValeurs = h('div', { class: 'ligne-serie-valeurs' }, resume);
  for (const cle of champs) {
    const hote = h('div', { class: 'ligne-serie-champ', 'data-cle': cle, hidden: true });
    // Un seul champ de saisie (poids du corps, gainage) : il prend toute la largeur de la grille
    // d'edition. Pose en style en ligne parce que le selecteur :only-child du CSS ne peut pas
    // voir a travers les hotes masques.
    if (champs.length === 1) hote.style.gridColumn = '1 / -1';
    hotes[cle] = hote;
    zoneValeurs.appendChild(hote);
  }

  const etiquette = h('span', { class: 'ligne-serie-etiquette', hidden: true }, 'Échauf.');
  const annexe = h('div', { class: 'ligne-serie-annexe' }, etiquette);

  // Derive cardio : allure ou vitesse, calculee en direct et JAMAIS editable. Sa presence est
  // deduite des champs (duree + distance), pas d'un test sur le mode.
  const aDerive = champs.indexOf('dureeSec') !== -1 && champs.indexOf('distanceM') !== -1;
  const derive = h('div', { class: 'ligne-serie-annexe ligne-serie-derive', hidden: true });

  const ligne = h('div', {
    class: 'ligne-serie',
    'data-etat': etat,
    'data-serie': serie.id || null
  }, numero, zoneValeurs, annexe, aDerive ? derive : null);

  const btnKind = h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-role': 'kind' }, 'éch.');
  const btnNonFaite = h('button', { class: 'bouton bouton-fantome', type: 'button', 'data-role': 'non-faite' }, 'Non faite');
  const actions = h('div', { class: 'ligne-serie-actions', hidden: true }, btnKind, btnNonFaite);

  el.appendChild(ligne);
  el.appendChild(actions);

  // ── Peinture ciblee ──────────────────────────────────────────────────────────
  function serieCourante() {
    // Vue « serie » du brouillon, pour les formateurs du domaine. Le brouillon n'est jamais
    // ecrit dans les donnees : seul session.js le fait, via store.commit().
    return Object.assign({}, serie, brouillon);
  }

  function peindreResume() {
    resume.textContent = resumeSerie(serieCourante(), entree);
  }

  function peindreDerive() {
    if (!aDerive) return;
    const s = serieCourante();
    const texte = opts.metriqueCardio === 'vitesse'
      ? (() => { const v = vitesseKmH(s); return v == null ? '' : formatFr(v) + ' km/h'; })()
      : (() => { const a = allureSecParKm(s); return a == null ? '' : formatDuree(a) + ' /km'; })();
    derive.textContent = texte;
    derive.hidden = texte === '' || etat !== 'en-edition';
  }

  function peindreAnnexes() {
    etiquette.hidden = serie.kind !== 'echauffement';
    if (serie.echec === true) ligne.setAttribute('data-echec', 'oui');
    else ligne.removeAttribute('data-echec');
    btnKind.textContent = serie.kind === 'echauffement' ? 'effective' : 'éch.';
  }

  function appliquerEtat(nouveau) {
    etat = nouveau;
    ligne.setAttribute('data-etat', etat);
    const enEdition = etat === 'en-edition';

    resume.hidden = enEdition;
    for (const cle of champs) hotes[cle].hidden = !enEdition;
    actions.hidden = !enEdition;

    // Hors edition la ligne EST le bouton d'edition ; en edition elle contient des boutons, et un
    // role imbrique rendrait l'arbre d'accessibilite incoherent.
    if (enEdition) {
      ligne.removeAttribute('role');
      ligne.removeAttribute('tabindex');
      ligne.removeAttribute('aria-label');
    } else {
      ligne.setAttribute('role', 'button');
      ligne.setAttribute('tabindex', '0');
      ligne.setAttribute('aria-label', 'Modifier la série ' + (opts.numero || ''));
    }
    peindreDerive();
  }

  // ── Steppers, montes a la premiere edition ───────────────────────────────────
  function assurerSteppers() {
    for (const cle of champs) {
      if (steppers[cle]) continue;
      const d = descriptionChamp(entree, cle);
      steppers[cle] = stepper.monter(hotes[cle], {
        valeur: estNombre(brouillon[cle]) ? brouillon[cle] : (estNombre(d.min) ? Math.max(0, d.min) : 0),
        pas: d.pas,
        min: d.min,
        max: d.max,
        unite: d.unite,
        libelle: d.label,
        format: d.format,
        onChange: (v) => majValeur(cle, v, true),
        onTapValeur: () => ouvrirPave(cle)
      });
      // Le stepper part de sa propre valeur bornee : on realigne le brouillon dessus pour que
      // les deux ne divergent jamais des le premier affichage.
      brouillon[cle] = steppers[cle].valeur();
    }
  }

  function majValeur(cle, valeur, notifier) {
    brouillon[cle] = estNombre(valeur) ? valeur : null;
    peindreResume();
    peindreDerive();
    if (notifier && typeof cb.onChange === 'function') {
      cb.onChange(cle, brouillon[cle], Object.assign({}, brouillon));
    }
  }

  // ⚠ Le pave enchaine TOUS les champs de la ligne en une seule ouverture : repetitions ->
  //   « Suivant » -> charge -> « OK ». Ouvrir le pave sur le seul champ tape imposerait deux
  //   cycles modaux pour une meme serie.
  function ouvrirPave(cleDepart) {
    const description = champs.map((cle) => {
      const d = descriptionChamp(entree, cle);
      d.valeur = brouillon[cle];
      return d;
    });
    if (typeof cb.onPave === 'function') { cb.onPave(description, cleDepart); return; }

    // Le champ tape passe en tete, les autres suivent dans l'ordre de MODES.saisie.
    const depart = champs.indexOf(cleDepart);
    if (depart > 0) description.unshift(description.splice(depart, 1)[0]);

    keypad.ouvrir({
      titre: entree.nomAffiche || 'Saisie',
      champs: description,
      onValider: (valeurs) => {
        if (detruit) return;
        for (const cle of champs) {
          if (!estNombre(valeurs[cle])) continue;
          if (steppers[cle]) steppers[cle].setValeur(valeurs[cle]);
          majValeur(cle, valeurs[cle], true);
        }
      }
    });
  }

  // ── Tap = edition · appui long = suppression ─────────────────────────────────
  let minuteurAppui = null;
  let pointeur = null;
  let departX = 0;
  let departY = 0;
  let longDeclenche = false;

  function annulerAppui() {
    if (minuteurAppui) { clearTimeout(minuteurAppui); minuteurAppui = null; }
    pointeur = null;
    ligne.removeAttribute('data-appui');
  }

  function surPointerDown(ev) {
    if (etat === 'en-edition') return;                      // les steppers possedent le geste
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target instanceof Element && ev.target.closest('button')) return;
    pointeur = ev.pointerId;
    departX = ev.clientX;
    departY = ev.clientY;
    longDeclenche = false;
    // Retour visuel AVANT le declenchement : sans lui, le geste parait ne rien faire pendant
    // une demi-seconde et l'utilisateur releve le doigt juste avant l'effet.
    ligne.setAttribute('data-appui', 'long');
    minuteurAppui = setTimeout(() => {
      minuteurAppui = null;
      longDeclenche = true;
      ligne.removeAttribute('data-appui');
      if (typeof cb.onSupprimer === 'function') cb.onSupprimer(serie);
    }, MS_APPUI_LONG);
  }

  function surPointerMove(ev) {
    if (pointeur == null || ev.pointerId !== pointeur) return;
    const dx = ev.clientX - departX;
    const dy = ev.clientY - departY;
    // Au-dela de 10 px c'est un defilement, pas un appui : la suppression ne doit surtout pas
    // se declencher parce que la liste a glisse sous le doigt.
    if (dx * dx + dy * dy > SEUIL_DEPLACEMENT_PX * SEUIL_DEPLACEMENT_PX) annulerAppui();
  }

  function surPointerUp(ev) {
    if (pointeur == null || ev.pointerId !== pointeur) return;
    const etaitArme = minuteurAppui != null;
    annulerAppui();
    if (etaitArme && !longDeclenche) demanderEdition();
  }

  function surPointerCancel() {
    annulerAppui();
  }

  function demanderEdition() {
    if (etat === 'en-edition') return;
    editer();
    if (typeof cb.onEditer === 'function') cb.onEditer(serie);
  }

  function surKeyDown(ev) {
    if (etat === 'en-edition') return;
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    demanderEdition();
  }

  const off = [
    on(ligne, 'pointerdown', surPointerDown),
    on(ligne, 'pointermove', surPointerMove),
    on(ligne, 'pointerup', surPointerUp),
    on(ligne, 'pointercancel', surPointerCancel),
    on(ligne, 'keydown', surKeyDown),
    on(ligne, 'contextmenu', (ev) => { if (etat !== 'en-edition') ev.preventDefault(); }),
    // Un seul ecouteur click delegue pour les commandes de la ligne.
    delegate(actions, 'click', '[data-role]', (ev, cible) => {
      ev.preventDefault();
      const role = cible.getAttribute('data-role');
      if (role === 'kind') {
        // Bascule echauffement <-> effective. estComptable() en depend : un echauffement pris
        // pour une serie effective pre-remplit la suivante a 50 kg au lieu de 80.
        serie = Object.assign({}, serie, {
          kind: serie.kind === 'echauffement' ? 'effective' : 'echauffement'
        });
        peindreAnnexes();
        if (typeof cb.onKind === 'function') cb.onKind(serie.kind);
        return;
      }
      if (role === 'non-faite' && typeof cb.onNonFaite === 'function') cb.onNonFaite();
    })
  ];

  // ── Premier affichage ────────────────────────────────────────────────────────
  peindreResume();
  peindreAnnexes();
  if (etat === 'en-edition') assurerSteppers();
  appliquerEtat(etat);

  function editer() {
    assurerSteppers();
    for (const cle of champs) {
      if (estNombre(brouillon[cle])) steppers[cle].setValeur(brouillon[cle]);
    }
    appliquerEtat('en-edition');
  }

  return {
    /**
     * Fige la ligne sur la serie que le domaine vient de valider. AUCUN noeud n'est remplace :
     * un attribut, un noeud texte, et les hotes de steppers repassent en `hidden`.
     */
    figer(nouvelle) {
      if (nouvelle) {
        serie = nouvelle;
        for (const cle of champs) {
          if (estNombre(serie[cle])) {
            brouillon[cle] = serie[cle];
            if (steppers[cle]) steppers[cle].setValeur(serie[cle]);
          }
        }
        if (serie.id) ligne.setAttribute('data-serie', serie.id);
      }
      peindreResume();
      peindreAnnexes();
      // `done:false` = serie prevue non faite : conservee a l'ecran et dans les donnees, exclue
      // de tout agregat. Barree, jamais supprimee.
      appliquerEtat(serie.done === false ? 'non-faite' : 'faite');
    },

    editer,

    setValeur(cle, valeur) {
      if (champs.indexOf(cle) === -1) return;
      if (steppers[cle]) steppers[cle].setValeur(valeur);
      majValeur(cle, valeur, false);
    },

    /** Brouillon courant : c'est lui que la vue passe a session.validerSerie(). */
    valeurs() {
      return Object.assign({}, brouillon);
    },

    etat() {
      return etat;
    },

    detruire() {
      detruit = true;
      annulerAppui();
      for (const f of off) f();
      off.length = 0;
      // Les steppers appartiennent a cette ligne : elle est la seule a pouvoir les detruire.
      for (const cle in steppers) steppers[cle].detruire();
      if (ligne.parentNode) ligne.parentNode.removeChild(ligne);
      if (actions.parentNode) actions.parentNode.removeChild(actions);
    }
  };
}
