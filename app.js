/* ============================================================
   MA FAMILLE — gestion financière et familiale du foyer (FCFA)
   Application mono-utilisateur : un seul compte, une seule base
   de données (Firestore), aucune connexion directe aux banques
   ou portefeuilles mobiles — vous saisissez vous-même vos soldes
   et mouvements.
   Le foyer est un objet dynamique : de 1 à N personnes, sans
   composition prédéfinie (voir MODÈLE DE DONNÉES ci-dessous).
   ============================================================ */

/* ============ FIREBASE ============
   Remplacez ces valeurs par celles de VOTRE projet Firebase
   (Console Firebase > Paramètres du projet > Vos applications).
   Voir le guide de déploiement (DEPLOIEMENT.md) fourni avec ce projet. */
const firebaseConfig = {
  apiKey: "AIzaSyD1Rn_zTfhoptj6u4EO42d6ks2HmHXkQ_s",
  authDomain: "ma-famille-5084c.firebaseapp.com",
  projectId: "ma-famille-5084c",
  storageBucket: "ma-famille-5084c.firebasestorage.app",
  messagingSenderId: "908502729265",
  appId: "1:908502729265:web:60afd8942265e4db340b10"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
/* Force la connexion à rester mémorisée via localStorage plutôt que via
   IndexedDB (comportement par défaut de Firebase). Sur certains navigateurs
   mobiles — Safari iPhone en tête — le stockage IndexedDB peut se corrompre
   (ex. après une longue inactivité ou en navigation privée), ce qui provoque
   une erreur bloquante au moment de se connecter ("Object store cannot be
   found in the backing store"). localStorage est beaucoup plus simple et
   fiable pour ce seul usage (retenir qui est connecté). */
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
  console.warn('Persistance de connexion : impossible d\'utiliser localStorage, la connexion ne sera peut-être pas mémorisée.', err);
});
const db = firebase.firestore();
/* Sur certains réseaux/opérateurs, la connexion "streaming" que Firestore essaie
   en premier échoue silencieusement puis rebascule sur du "long polling" après
   un long délai (c'est exactement ce qui cause un premier chargement très lent,
   ~20-30s, alors que tout le reste du site est instantané). Cette option force
   la détection immédiate du bon mode de connexion au lieu d'attendre l'échec. */
db.settings({ experimentalAutoDetectLongPolling: true });
/* Persistance hors-ligne : garde une copie de vos données sur l'appareil
   (IndexedDB) pour pouvoir continuer à consulter — et modifier — votre foyer
   sans connexion internet ; tout se resynchronise automatiquement avec
   Firestore dès que le réseau revient. Utile sur un réseau mobile instable. */
db.enablePersistence({synchronizeTabs:true}).catch(err => {
  if(err.code === 'failed-precondition'){
    console.warn('Persistance hors-ligne indisponible (plusieurs onglets ouverts sans synchronisation).');
  } else if(err.code === 'unimplemented'){
    console.warn('Persistance hors-ligne non supportée par ce navigateur.');
  } else {
    console.warn('Persistance hors-ligne : erreur', err);
  }
});
/* Chaque compte (email + mot de passe) a son propre document Firestore,
   identifié par son uid Firebase Auth — voir onAuthStateChanged plus bas.
   Tant que personne n'est connecté, DOC_REF reste null : aucune lecture ni
   écriture n'est possible avant l'authentification (voir la règle Firestore). */
let DOC_REF = null;
let unsubscribeSnapshot = null;

/* ============ CONSTANTES ============ */
const ACCOUNT_TYPES = [
  {id:'BANK', label:'Banque', icon:'🏦'},
  {id:'DJAMO', label:'Djamo', icon:'💳'},
  {id:'ORANGE_MONEY', label:'Orange Money', icon:'🟠'},
  {id:'WAVE', label:'Wave', icon:'🔵'},
  {id:'MTN_MONEY', label:'MTN Money', icon:'🟡'},
  {id:'MOOV_MONEY', label:'Moov Money', icon:'🟢'},
  {id:'CASH', label:'Espèces', icon:'💵'},
  {id:'OTHER', label:'Autre', icon:'📦'},
];
/* Comptes mobile money sur lesquels un transfert sortant prélève 1% de frais
   (comportement réel des opérateurs ivoiriens : Wave, Djamo, Orange Money,
   MTN Money, Moov Money). Banque, espèces et "Autre" restent sans frais. */
const MOBILE_MONEY_TYPES = ['DJAMO','ORANGE_MONEY','WAVE','MTN_MONEY','MOOV_MONEY'];
/* Chaque catégorie de dépense porte désormais une "nature" — fixe ou
   variable — décidée une fois pour toutes par catégorie (et non transaction
   par transaction). C'est ce qui alimente la séparation "Dépense fixe" /
   "Dépense variable" de l'onglet Dépenses et du tableau de bord.
   Hypothèse retenue pour les catégories non précisées par l'utilisateur :
   maison/éducation/dettes = fixe (charges qui reviennent à l'identique) ;
   alimentation/personnel/transport/santé/habillement/loisirs/autre = variable
   (montant qui change d'un mois à l'autre). Ajustable à tout moment depuis
   Paramètres → Catégories personnalisées pour toute nouvelle catégorie. */
const EXPENSE_CATEGORIES = [
  {id:'maison', label:'Maison', icon:'🏠', nature:'fixe'},
  {id:'alimentation', label:'Alimentation', icon:'🍚', nature:'variable'},
  {id:'personnel', label:'Dépense personnelle', icon:'👤', nature:'variable'},
  {id:'transport', label:'Transport', icon:'🚗', nature:'variable'},
  {id:'sante', label:'Santé', icon:'🏥', nature:'variable'},
  {id:'habillement', label:'Habillement', icon:'👕', nature:'variable'},
  {id:'education', label:'Éducation', icon:'🎓', nature:'fixe'},
  {id:'loisirs', label:'Loisirs', icon:'🎉', nature:'variable'},
  {id:'dettes', label:'Dettes', icon:'💳', nature:'fixe'},
  {id:'autre', label:'Autre', icon:'📦', nature:'variable'},
];
const INCOME_CATEGORIES = [
  {id:'salaire', label:'Salaire', icon:'💼'},
  {id:'activite_commerciale', label:'Activité commerciale', icon:'🛍️'},
  {id:'activite_independante', label:'Activité indépendante', icon:'🧑‍💻'},
  {id:'commission', label:'Commission', icon:'🤝'},
  {id:'allocation', label:'Allocation', icon:'🎗️'},
  {id:'pension', label:'Pension', icon:'🧓'},
  {id:'aide_familiale', label:'Aide familiale', icon:'🤲'},
  {id:'revenu_locatif', label:'Revenu locatif', icon:'🏘️'},
  {id:'investissement', label:'Investissement', icon:'📈'},
  {id:'autre', label:'Autre', icon:'📦'},
];
/* Liens possibles entre une personne et le titulaire du compte ("vous").
   'soi' est réservé au titulaire lui-même (une seule occurrence par foyer). */
const RELATIONS = [
  {id:'soi', label:'Vous-même', icon:'🙂'},
  {id:'conjoint', label:'Conjoint(e)', icon:'💑'},
  {id:'enfant', label:'Enfant', icon:'🧒'},
  {id:'parent', label:'Parent', icon:'🧓'},
  {id:'aide_domestique', label:'Aide à la maison', icon:'🧹'},
  {id:'colocataire', label:'Colocataire', icon:'🏠'},
  {id:'autre_famille', label:'Autre membre de la famille', icon:'👪'},
  {id:'autre', label:'Autre', icon:'👤'},
];
function relationInfo(id){ return RELATIONS.find(r => r.id === id) || RELATIONS[RELATIONS.length-1]; }
const SITUATION_LABELS = {seul:'Je vis seul(e)', couple:'En couple', famille:'Famille avec enfant(s)', autre:'Autre configuration'};
const DEFAULT_THRESHOLDS = [50, 75, 90];
const LOCAL_KEY = 'mafamille_local_v1';

/* ============ HELPERS GÉNÉRAUX ============ */
/* Échappe tout texte saisi par l'utilisateur avant de l'insérer dans du HTML,
   pour empêcher qu'une note/nom contenant des balises (ex. <script>) ne
   s'exécute dans le navigateur (faille XSS stockée). */
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatFCFA(n){
  const v = Math.round(Number(n) || 0);
  return new Intl.NumberFormat('fr-FR').format(v) + ' FCFA';
}
function genId(prefix){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}
function todayStr(){
  return new Date().toISOString().slice(0,10);
}
function monthKeyOf(dateStr){
  return (dateStr || '').slice(0,7); // 'AAAA-MM'
}
function currentMonthKey(){
  return todayStr().slice(0,7);
}
function monthKeyToDate(key){
  const [y,m] = key.split('-').map(Number);
  return new Date(y, m-1, 1);
}
function dateToMonthKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function addMonthsToKey(key, n){
  const d = monthKeyToDate(key);
  d.setMonth(d.getMonth() + n);
  return dateToMonthKey(d);
}
function monthLabel(key){
  const d = monthKeyToDate(key);
  const label = d.toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function daysInMonthOf(key){
  const [y,m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function clampDay(day, key){
  return Math.min(Math.max(1, Number(day)||1), daysInMonthOf(key));
}
function dateForDayInMonth(key, day){
  const [y,m] = key.split('-').map(Number);
  return `${y}-${String(m).padStart(2,'0')}-${String(clampDay(day,key)).padStart(2,'0')}`;
}
function daysUntil(dateStr){
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  const dueUTC = Date.UTC(y, m - 1, d);
  return Math.round((dueUTC - todayUTC) / 86400000);
}
function showToast(message){
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3200);
}
/* ============ MODALE GÉNÉRIQUE (Userforms) ============
   Remplace les prompt()/confirm() du navigateur par une zone de texte centrée
   et organisée, cohérente avec le design de l'application. openModal() décrit
   les champs à afficher ; onSubmit reçoit un objet {champId: valeur}. */
function openModal(opts){
  const overlay = document.getElementById('modalOverlay');
  const fieldsHtml = opts.fields.map(f => {
    if(f.type === 'checkbox'){
      return `<label class="role-filter-toggle"><input type="checkbox" id="modal_${f.id}" ${f.value?'checked':''}><span>${escapeHtml(f.label)}</span></label>`;
    }
    if(f.type === 'hint'){
      // Paragraphe d'information simple (pas un champ de saisie) — utilisé par
      // exemple pour l'indication de frais mobile money mise à jour en direct
      // dans la modale de transfert (voir opts.onRender ci-dessous).
      return `<p class="form-hint" id="modal_${f.id}">${f.value||''}</p>`;
    }
    if(f.type === 'select'){
      const optsHtml = (f.options||[]).map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value)===String(f.value)?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
      return `<div class="field-group"><label class="field-label">${escapeHtml(f.label)}</label><select id="modal_${f.id}">${optsHtml}</select></div>`;
    }
    const type = f.type || 'text';
    if(type === 'password'){
      return `<div class="field-group"><label class="field-label">${escapeHtml(f.label)}</label>
        <div class="password-field"><input type="password" id="modal_${f.id}" autocomplete="off" value="${escapeHtml(f.value||'')}" placeholder="${escapeHtml(f.placeholder||'')}">
        <button type="button" class="password-toggle" onclick="togglePasswordVisibility('modal_${f.id}', this)">👁</button></div>
      </div>`;
    }
    const step = type === 'number' ? ' step="1"' : '';
    return `<div class="field-group"><label class="field-label">${escapeHtml(f.label)}</label><input type="${type}" id="modal_${f.id}" value="${escapeHtml(f.value===undefined||f.value===null?'':f.value)}"${step} placeholder="${escapeHtml(f.placeholder||'')}"></div>`;
  }).join('');
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close" onclick="closeModal()">✕</button>
      <h3>${escapeHtml(opts.title||'')}</h3>
      ${opts.sub ? `<p class="modal-sub">${escapeHtml(opts.sub)}</p>` : ''}
      <form id="modalForm">
        <div class="modal-fields">${fieldsHtml}</div>
        <div class="modal-actions">
          <button type="submit" class="cta-inline">${escapeHtml(opts.submitLabel||'Enregistrer')}</button>
          ${opts.hideCancel ? '' : `<button type="button" class="icon-btn wide" onclick="closeModal()">Annuler</button>`}
        </div>
      </form>
    </div>`;
  overlay.classList.add('show');
  // Champs conditionnels génériques : ex. les champs "aide à la maison"
  // n'apparaissent que si le lien choisi est "aide_domestique".
  if(opts.conditional){
    const trigger = document.getElementById('modal_' + opts.conditional.trigger);
    if(trigger){
      const apply = () => {
        const show = trigger.value === opts.conditional.showValue;
        opts.conditional.fieldIds.forEach(fid => {
          const el = document.getElementById('modal_' + fid);
          const wrap = el ? (el.closest('.field-group') || el.closest('.role-filter-toggle')) : null;
          if(wrap) wrap.style.display = show ? '' : 'none';
        });
      };
      trigger.addEventListener('change', apply);
      apply();
    }
  }
  // Point d'extension optionnel : permet à l'appelant de brancher son propre
  // comportement une fois les champs présents dans le DOM (ex. mise à jour en
  // direct d'un champ "hint" quand un autre champ change — voir openTransferModal).
  if(typeof opts.onRender === 'function') opts.onRender();
  document.getElementById('modalForm').addEventListener('submit', e => {
    e.preventDefault();
    const values = {};
    opts.fields.forEach(f => {
      const el = document.getElementById('modal_'+f.id);
      if(!el) return;
      values[f.id] = f.type === 'checkbox' ? el.checked : el.value;
    });
    closeModal();
    opts.onSubmit(values);
  });
  const firstInput = overlay.querySelector('input, select');
  if(firstInput) setTimeout(() => firstInput.focus(), 30);
}
function closeModal(){
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('show');
  overlay.innerHTML = '';
}
window.closeModal = closeModal;
document.getElementById('modalOverlay').addEventListener('click', e => {
  if(e.target.id === 'modalOverlay') closeModal();
});
/* confirmModal()/alertModal() : remplacent respectivement window.confirm() et
   window.alert() par la même modale centrée (Userform) que le reste du site,
   pour une expérience 100% cohérente, sans aucune fenêtre native. */
function confirmModal(message, onConfirm, opts){
  opts = opts || {};
  openModal({
    title: opts.title || 'Confirmer',
    sub: message,
    submitLabel: opts.submitLabel || 'Confirmer',
    fields: [],
    onSubmit(){ onConfirm(); }
  });
}
window.confirmModal = confirmModal;
function alertModal(message, opts){
  opts = opts || {};
  openModal({
    title: opts.title || 'Information',
    sub: message,
    submitLabel: 'OK',
    hideCancel: true,
    fields: [],
    onSubmit(){ if(opts.then) opts.then(); }
  });
}
window.alertModal = alertModal;
/* ============ AIDE (« ❓ » sur chaque vue principale) ============
   Comme demandé ("comme tout application ou site internet complexe") :
   un petit tableau explicatif par vue principale, ouvert dans la même
   modale Userform que le reste du site, mais affichant un <table> au lieu
   d'un formulaire. */
function openHelpModal(title, rows){
  const overlay = document.getElementById('modalOverlay');
  const rowsHtml = (rows||[]).map(r => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join('');
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close" onclick="closeModal()">✕</button>
      <h3>❓ ${escapeHtml(title)}</h3>
      <p class="modal-sub">Comment utiliser cette page.</p>
      <div class="help-table-wrap"><table class="help-table"><tbody>${rowsHtml}</tbody></table></div>
      <div class="modal-actions"><button type="button" class="cta-inline" onclick="closeModal()">Compris</button></div>
    </div>`;
  overlay.classList.add('show');
}
window.openHelpModal = openHelpModal;
const HELP_TITLES = {dashboard:'Tableau de bord', accounts:'Comptes', revenus:'Revenus', depenses:'Dépenses', calendar:'Calendrier', plus:'Plus'};
const HELP_CONTENT = {
  dashboard: [
    ["Épargne totale", "Le grand chiffre en haut : tout ce que vous avez mis de côté dans vos objectifs d'épargne (onglet Plus → Épargne)."],
    ["Revenus / Dépense fixe / Dépense variable", "Les trois chiffres du mois en cours, juste en dessous."],
    ["Budget global du mois", "« Prévu » = ce que vous avez budgété ce mois-ci (onglet Dépenses → Budget). « Réel » = ce que vous avez réellement dépensé dans ces catégories. La barre montre le pourcentage réel/prévu."],
    ["Prochaines dépenses", "Vos factures et dépenses récurrentes à venir dans les 30 prochains jours."],
    ["Aperçu des comptes", "Le solde de chacun de vos moyens financiers."],
    ["Alertes budget", "Vous prévient si vous dépensez plus que ce que vous recevez ce mois-ci, ou si un budget par catégorie approche sa limite."],
    ["Argent utilisable / réellement disponible", "« Utilisable » exclut votre épargne réservée. « Réellement disponible » retire en plus vos prochaines factures et récurrences déjà prévues."],
  ],
  accounts: [
    ["Mes comptes", "Tous vos moyens financiers (banque, mobile money, espèces…) et leur solde actuel."],
    ["+ Nouveau moyen financier", "Ajoutez un compte, une carte ou une caisse."],
    ["🔁 Nouveau transfert", "Déplacez de l'argent d'un compte à un autre (ex. Banque → Espèces) — ce n'est ni une dépense ni un revenu, cela ne fausse donc pas vos statistiques."],
    ["Transferts récents", "L'historique de vos derniers transferts entre comptes."],
  ],
  revenus: [
    ["+ Nouveau revenu", "Enregistrez chaque somme que vous recevez, sa catégorie et le compte qui la reçoit."],
    ["Récurrences de revenus", "Cochez « récurrent » sur un revenu (ex. salaire) pour qu'il réapparaisse chaque mois — cliquez « Enregistrer ce mois » pour le confirmer."],
    ["Historique", "Recherchez et filtrez tous vos revenus passés, par mois ou par catégorie."],
  ],
  depenses: [
    ["+ Nouvelle dépense", "Enregistrez chaque sortie d'argent, sa catégorie et le compte utilisé."],
    ["Dépense fixe", "Les charges qui reviennent à l'identique chaque mois : maison, éducation, dettes, et vos factures."],
    ["Dépense variable", "Les dépenses dont le montant change d'un mois à l'autre : nourriture, santé, habillement, transport, loisirs…"],
    ["Budget", "Fixez un plafond mensuel par catégorie et comparez ce qui est prévu à ce qui est réellement dépensé."],
    ["Historique des dépenses", "Recherchez et filtrez toutes vos dépenses — y compris par nature (fixe ou variable)."],
  ],
  calendar: [
    ["Vue mensuelle", "Chaque jour affiche les mouvements réels et les mouvements prévus (factures, récurrences à venir)."],
    ["Cliquer sur un jour", "Affiche le détail complet des mouvements de ce jour-là."],
  ],
  plus: [
    ["Épargne", "Vos objectifs d'épargne et leur progression."],
    ["Dettes", "Le suivi de vos crédits en cours et de leurs remboursements."],
    ["Foyer", "Les personnes qui composent votre foyer, présentes ou parties."],
    ["Paramètres", "Votre profil, vos catégories personnalisées et vos sauvegardes."],
    ["Rapport", "L'évolution de votre budget sur 6 mois, avec export CSV et PDF."],
    ["Prévisions", "Ce qui va probablement se passer financièrement dans les prochains jours, à partir de vos comptes, factures et récurrences."],
  ],
};
function showHelp(view){
  openHelpModal(HELP_TITLES[view] || '', HELP_CONTENT[view] || []);
}
window.showHelp = showHelp;
function initials(name){
  const c = (name||'').trim().slice(0,1).toUpperCase();
  return c || '?';
}
function ageFromBirthdate(dateStr){
  if(!dateStr) return '—';
  const birth = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  let months = (now.getFullYear()-birth.getFullYear())*12 + (now.getMonth()-birth.getMonth());
  if(now.getDate() < birth.getDate()) months--;
  if(months < 1){
    const days = Math.max(0, Math.round((now - birth) / 86400000));
    return `${days} jour${days>1?'s':''}`;
  }
  if(months < 24) return `${months} mois`;
  return `${Math.floor(months/12)} an${Math.floor(months/12)>1?'s':''}`;
}
/* ============ DATES — affichages évolués ============
   formatDateLong : "lun. 12 août 2026" (jour de semaine abrégé + date complète).
   relativeDatePill : petit badge coloré ("Aujourd'hui", "Demain", "Dans 3 j",
   "Hier", "En retard 2 j") utilisé sur les factures et les échéances à venir. */
function formatDateLong(dateStr){
  if(!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  let s = d.toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function relativeDatePill(dateStr){
  if(!dateStr) return '';
  const n = daysUntil(dateStr);
  if(n === 0) return `<span class="date-pill today">Aujourd'hui</span>`;
  if(n === 1) return `<span class="date-pill soon">Demain</span>`;
  if(n === -1) return `<span class="date-pill late">Hier</span>`;
  if(n > 1 && n <= 7) return `<span class="date-pill soon">Dans ${n} j</span>`;
  if(n < -1) return `<span class="date-pill late">En retard ${Math.abs(n)} j</span>`;
  return '';
}

/* ============ MODÈLE DE DONNÉES « FOYER DYNAMIQUE » ============
   Un document Firestore par compte : collection 'foyers', id = uid Firebase Auth.
   {
     foyer: { nom, situationLogement:'seul'|'couple'|'famille'|'autre' },
     personnes: [ {
        id, prenom, nom, relation: voir RELATIONS, dateNaissance, telephone,
        aCharge:bool,          // personne financièrement à charge du foyer
        contribution:bool,     // personne qui contribue aux revenus du foyer
        role, frequence, remuneration, transport, autres,  // utilisés seulement si relation === 'aide_domestique'
        presente:bool,         // false = a quitté le foyer — JAMAIS supprimée, seulement désactivée,
        dateArrivee, dateDepart                              // pour préserver l'historique financier
     } ],
     accounts: [ {id,name,type,balance} ],
     transactions: [ {id,type:'revenu'|'depense'|'transfert'|'epargne_ajout'|'epargne_retrait',
                       amount,date,category,subcategory,personId,accountId,toAccountId,note,recurringId} ],
     recurring: [ {id,label,type:'revenu'|'depense',amount,category,personId,accountId,day,fixedCharge,lastRecordedMonth} ],
     budgets: { [categoryId]: montant },
     thresholds: [50,75,90],
     bills: [ {id,name,amount,due,accountId,paid,paidTxnId} ],
     savingsGoals: [ {id,name,target,current} ],
     debts: [ {id,name,creancier,initial,restant,mensualite,taux,dateDebut,dateFin} ],
     categories: [ {id,label,type,icon,custom:true} ]
   }
   personId sur une transaction/récurrence vaut soit l'id d'une personne du
   foyer, soit la valeur spéciale 'foyer' (dépense/revenu commun, non attribué
   à une personne en particulier). */
function defaultFoyerData(){
  return {
    foyer: {nom:'', situationLogement:''},
    personnes: [],
    accounts: [],
    transactions: [],
    recurring: [],
    budgets: {},
    thresholds: DEFAULT_THRESHOLDS.slice(),
    bills: [],
    savingsGoals: [],
    debts: [],
    categories: [],
  };
}
/* Migration silencieuse depuis l'ancien modèle fixe (Homme/Femme/Bébé/Aide) :
   si un document existant utilise encore "membres"/"profil", on le convertit
   en "personnes" dynamiques sans rien perdre — aucune donnée saisie avant ce
   changement ne doit être perdue. */
function migrateLegacyIfNeeded(shared){
  if(!shared || Array.isArray(shared.personnes)) return shared;
  if(!shared.membres) return shared;
  const m = shared.membres;
  const map = {};
  const personnes = [];
  if(m.homme && m.homme.prenom){
    const id = genId('p');
    map.homme = id;
    personnes.push({id, prenom:m.homme.prenom, nom:'', relation:'soi', dateNaissance:'', telephone:(shared.profil&&shared.profil.telephone)||'', aCharge:false, contribution:true, role:'',frequence:'',remuneration:0,transport:0,autres:0, presente:true, dateArrivee:'', dateDepart:null});
  }
  if(m.femme && m.femme.prenom){
    const id = genId('p');
    map.femme = id;
    personnes.push({id, prenom:m.femme.prenom, nom:'', relation: personnes.length?'conjoint':'soi', dateNaissance:'', telephone:'', aCharge:false, contribution:true, role:'',frequence:'',remuneration:0,transport:0,autres:0, presente:true, dateArrivee:'', dateDepart:null});
  }
  if(m.bebe && m.bebe.actif){
    const id = genId('p');
    map.bebe = id;
    personnes.push({id, prenom:m.bebe.prenom||'Bébé', nom:'', relation:'enfant', dateNaissance:m.bebe.naissance||'', telephone:'', aCharge:true, contribution:false, role:'',frequence:'',remuneration:0,transport:0,autres:0, presente:true, dateArrivee:'', dateDepart:null});
  }
  if(m.aide && m.aide.actif){
    const id = genId('p');
    map.aide = id;
    personnes.push({id, prenom:m.aide.prenom||'Aide à la maison', nom:'', relation:'aide_domestique', dateNaissance:'', telephone:'', aCharge:false, contribution:false, role:m.aide.role||'', frequence:m.aide.frequence||'', remuneration:m.aide.remuneration||0, transport:m.aide.transport||0, autres:m.aide.autres||0, presente:true, dateArrivee:'', dateDepart:null});
  }
  map.famille = 'foyer';
  const remap = (val) => (val && map[val]) ? map[val] : 'foyer';
  (shared.transactions||[]).forEach(t => {
    t.personId = t.person ? remap(t.person) : (t.scope ? remap(t.scope) : 'foyer');
    if(['bebe','homme','femme','aide'].includes(t.category)) t.category = 'personnel';
    delete t.person; delete t.scope;
  });
  (shared.recurring||[]).forEach(r => {
    r.personId = r.scope ? remap(r.scope) : 'foyer';
    if(['bebe','homme','femme','aide'].includes(r.category)) r.category = 'personnel';
    delete r.scope;
  });
  shared.personnes = personnes;
  shared.foyer = shared.foyer || {nom:''};
  shared.foyer.situationLogement = shared.foyer.situationLogement || '';
  delete shared.membres;
  delete shared.profil;
  return shared;
}
let DATA = defaultFoyerData();
let dataReady = false;
let foyerExists = false;

function loadLocalPrefs(){
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {currentView: 'dashboard'};
}
function saveLocalPrefs(){
  try{
    localStorage.setItem(LOCAL_KEY, JSON.stringify({currentView: currentView}));
  }catch(e){}
}
let currentView = (loadLocalPrefs().currentView) || 'dashboard';

function setSyncBadge(state){
  const el = document.getElementById('syncBadge');
  if(!el) return;
  if(state === 'ok'){ el.textContent = '🟢 synchronisé'; el.className = 'sync-badge ok'; }
  else if(state === 'saving'){ el.textContent = '🔄 sauvegarde…'; el.className = 'sync-badge'; }
  else if(state === 'err'){ el.textContent = '🔴 erreur de sync'; el.className = 'sync-badge err'; }
  else { el.textContent = '🔄 connexion…'; el.className = 'sync-badge'; }
}
function saveData(){
  if(!DOC_REF) return;
  setSyncBadge('saving');
  DOC_REF.set(DATA).then(() => setSyncBadge('ok')).catch(err => {
    console.error('Erreur de sauvegarde Firestore :', err);
    setSyncBadge('err');
    alertModal('La sauvegarde a échoué. Vérifiez votre connexion internet et réessayez. (Détail dans la console F12)');
  });
}

/* ============ ÉCRANS ============ */
function hideAllGateScreens(){
  ['loadingScreen','authScreen','setupScreen','appRoot'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
}
function showAuthScreen(){
  hideAllGateScreens();
  document.getElementById('authScreen').style.display = 'flex';
  clearAuthFormFields();
}
function showLoadingScreen(){
  hideAllGateScreens();
  const loading = document.getElementById('loadingScreen');
  loading.innerHTML = `<div class="login-card" style="text-align:center;">
    <div class="login-brand" style="justify-content:center;"><span class="dot"></span>MA FAMILLE</div>
    <p class="login-sub" style="margin:10px 0 0;">Connexion à vos données…</p>
  </div>`;
  loading.style.display = 'flex';
}
function showSetupScreen(){
  hideAllGateScreens();
  document.getElementById('setupScreen').style.display = 'flex';
  initWizard();
}
function showAppRoot(){
  hideAllGateScreens();
  document.getElementById('appRoot').style.display = 'block';
}

/* ============ QUESTIONNAIRE ADAPTATIF (création du foyer) ============
   Le nombre d'étapes s'adapte à la situation choisie : une personne seule
   saute directement l'étape "combien de personnes" (elle vaut 1). */
const WIZ_TITLES = {1:'Votre foyer', 2:'Composition', 3:'Les personnes du foyer', 4:'Vérification'};
let wizard = { stepOrder:[1,2,3,4], idx:0, foyerNom:'', moiPrenom:'', situation:'', count:1, personnes:[] };

function wizardCurrentStep(){ return wizard.stepOrder[wizard.idx]; }
function renderWizardProgress(){
  const el = document.getElementById('wizardProgress');
  if(!el) return;
  el.innerHTML = wizard.stepOrder.map((s,i) => {
    const cls = i < wizard.idx ? 'done' : (i === wizard.idx ? 'current' : '');
    return `<div class="seg ${cls}"><div class="fill"></div></div>`;
  }).join('');
}
function showWizardStep(){
  [1,2,3,4].forEach(n => {
    const el = document.getElementById('wizStep'+n);
    if(el) el.classList.toggle('active', n === wizardCurrentStep());
  });
  renderWizardProgress();
  const activeEl = document.getElementById('wizStep'+wizardCurrentStep());
  const labelEl = activeEl ? activeEl.querySelector('.wizard-steplabel') : null;
  if(labelEl) labelEl.textContent = `Étape ${wizard.idx+1} sur ${wizard.stepOrder.length} — ${WIZ_TITLES[wizardCurrentStep()]}`;
  document.getElementById('wizPrevBtn').style.visibility = wizard.idx === 0 ? 'hidden' : 'visible';
  document.getElementById('wizNextBtn').textContent = wizardCurrentStep() === 4 ? 'Créer mon foyer 🎉' : 'Suivant ›';
  document.getElementById('setupError').textContent = '';
}
function initWizard(){
  wizard = { stepOrder:[1,2,3,4], idx:0, foyerNom:'', moiPrenom:'', situation:'', count:1, personnes:[] };
  document.getElementById('stFoyerNom').value = '';
  document.getElementById('stMoiPrenom').value = '';
  document.querySelectorAll('#situationGrid .radio-card').forEach(b => b.classList.remove('selected'));
  document.getElementById('stCountValue').textContent = '1';
  document.getElementById('stCountMinus').disabled = true;
  document.getElementById('personFormsContainer').innerHTML = '';
  document.getElementById('wizardRecap').innerHTML = '';
  showWizardStep();
}
function buildPersonForms(){
  const container = document.getElementById('personFormsContainer');
  let html = '';
  for(let i = 0; i < wizard.count; i++){
    if(i === 0){
      html += `
        <div class="person-form-card" data-idx="0">
          <div class="pf-head"><span class="pf-badge">1</span> Vous-même</div>
          <div class="form-grid" style="background:transparent;border:none;padding:0;">
            <div class="field-group"><label class="field-label">Prénom</label><input type="text" class="pf-prenom" value="${escapeHtml(wizard.moiPrenom)}" readonly></div>
            <div class="field-group"><label class="field-label">Date de naissance (facultatif)</label><input type="date" class="pf-naissance"></div>
          </div>
        </div>`;
    } else {
      html += `
        <div class="person-form-card" data-idx="${i}">
          <div class="pf-head"><span class="pf-badge">${i+1}</span> Personne ${i+1}</div>
          <div class="form-grid" style="background:transparent;border:none;padding:0;">
            <div class="field-group"><label class="field-label">Prénom</label><input type="text" class="pf-prenom" placeholder="Prénom" required></div>
            <div class="field-group"><label class="field-label">Lien avec vous</label>
              <select class="pf-relation">${RELATIONS.filter(r=>r.id!=='soi').map(r=>`<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}</select>
            </div>
            <div class="field-group"><label class="field-label">Date de naissance (facultatif)</label><input type="date" class="pf-naissance"></div>
          </div>
          <label class="role-filter-toggle"><input type="checkbox" class="pf-acharge"><span>À charge financièrement</span></label>
          <label class="role-filter-toggle"><input type="checkbox" class="pf-contribution"><span>Contribue aux revenus du foyer</span></label>
          <div class="setup-grid pf-aide-fields" style="display:none;grid-column:1/-1;margin-top:8px;">
            <div class="field-group"><label class="field-label">Rôle</label><input type="text" class="pf-role" placeholder="Ex. Aide ménagère"></div>
            <div class="field-group"><label class="field-label">Fréquence</label><input type="text" class="pf-frequence" placeholder="Ex. Tous les jours"></div>
            <div class="field-group"><label class="field-label">Rémunération (FCFA)</label><input type="number" class="pf-remuneration" min="0"></div>
            <div class="field-group"><label class="field-label">Transport (FCFA)</label><input type="number" class="pf-transport" min="0"></div>
            <div class="field-group"><label class="field-label">Autres frais (FCFA)</label><input type="number" class="pf-autres" min="0"></div>
          </div>
        </div>`;
    }
  }
  container.innerHTML = html;
  container.querySelectorAll('.pf-relation').forEach(sel => {
    sel.addEventListener('change', function(){
      const aideFields = this.closest('.person-form-card').querySelector('.pf-aide-fields');
      aideFields.style.display = this.value === 'aide_domestique' ? 'grid' : 'none';
    });
  });
}
function collectPersonForms(){
  const cards = document.querySelectorAll('#personFormsContainer .person-form-card');
  const list = [];
  let ok = true;
  cards.forEach((card, i) => {
    if(i === 0){
      const naissance = card.querySelector('.pf-naissance').value;
      list.push({id: genId('p'), prenom: wizard.moiPrenom, nom:'', relation:'soi', dateNaissance: naissance, telephone:'', aCharge:false, contribution:true, role:'',frequence:'',remuneration:0,transport:0,autres:0, presente:true, dateArrivee: todayStr(), dateDepart:null});
      return;
    }
    const prenom = card.querySelector('.pf-prenom').value.trim();
    if(!prenom){ ok = false; return; }
    const relation = card.querySelector('.pf-relation').value;
    const isAide = relation === 'aide_domestique';
    list.push({
      id: genId('p'), prenom, nom:'', relation,
      dateNaissance: card.querySelector('.pf-naissance').value,
      telephone:'',
      aCharge: card.querySelector('.pf-acharge').checked,
      contribution: card.querySelector('.pf-contribution').checked,
      role: isAide ? card.querySelector('.pf-role').value.trim() : '',
      frequence: isAide ? card.querySelector('.pf-frequence').value.trim() : '',
      remuneration: isAide ? (Number(card.querySelector('.pf-remuneration').value)||0) : 0,
      transport: isAide ? (Number(card.querySelector('.pf-transport').value)||0) : 0,
      autres: isAide ? (Number(card.querySelector('.pf-autres').value)||0) : 0,
      presente:true, dateArrivee: todayStr(), dateDepart:null,
    });
  });
  return ok ? list : null;
}
function renderRecap(){
  const el = document.getElementById('wizardRecap');
  let html = `<div class="budget-block"><div class="budget-block-top"><span class="name">Nom du foyer</span><span class="nums">${escapeHtml(wizard.foyerNom)}</span></div></div>`;
  html += `<div class="budget-block"><div class="budget-block-top"><span class="name">Situation</span><span class="nums">${SITUATION_LABELS[wizard.situation]||wizard.situation}</span></div></div>`;
  html += wizard.personnes.map(p => {
    const rel = relationInfo(p.relation);
    return `<div class="person-card"><div class="person-avatar">${initials(p.prenom)}</div><div class="person-body"><div class="person-name">${escapeHtml(p.prenom)}</div><div class="person-rel">${rel.icon} ${rel.label}</div><div class="person-tags">${p.aCharge?'<span class="tag orange">À charge</span>':''}${p.contribution?'<span class="tag green">Contribue</span>':''}</div></div></div>`;
  }).join('');
  el.innerHTML = html;
}
function submitWizard(){
  const errEl = document.getElementById('setupError');
  const data = defaultFoyerData();
  data.foyer = {nom: wizard.foyerNom, situationLogement: wizard.situation};
  data.personnes = wizard.personnes;
  data.accounts.push({id: genId('acc'), name:'Espèces', type:'CASH', balance:0});
  DATA = data;
  setSyncBadge('saving');
  DOC_REF.set(DATA).then(() => {
    foyerExists = true; dataReady = true;
    showAppRoot(); switchView('dashboard'); renderAll();
    showToast('Bienvenue ! Votre foyer est prêt 🎉');
  }).catch(err => {
    console.error('Erreur de création du foyer :', err);
    errEl.textContent = 'Impossible de créer votre foyer. Vérifiez votre connexion et réessayez.';
    setSyncBadge('err');
  });
}
document.getElementById('situationGrid').addEventListener('click', e => {
  const btn = e.target.closest('.radio-card');
  if(!btn) return;
  document.querySelectorAll('#situationGrid .radio-card').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  wizard.situation = btn.dataset.val;
});
document.getElementById('stCountMinus').addEventListener('click', () => {
  wizard.count = Math.max(1, wizard.count - 1);
  document.getElementById('stCountValue').textContent = wizard.count;
  document.getElementById('stCountMinus').disabled = wizard.count <= 1;
});
document.getElementById('stCountPlus').addEventListener('click', () => {
  wizard.count = Math.min(12, wizard.count + 1);
  document.getElementById('stCountValue').textContent = wizard.count;
  document.getElementById('stCountMinus').disabled = wizard.count <= 1;
});
document.getElementById('wizPrevBtn').addEventListener('click', () => {
  if(wizard.idx > 0){ wizard.idx--; showWizardStep(); }
});
document.getElementById('wizNextBtn').addEventListener('click', () => {
  const errEl = document.getElementById('setupError');
  errEl.textContent = '';
  const step = wizardCurrentStep();
  if(step === 1){
    wizard.foyerNom = document.getElementById('stFoyerNom').value.trim();
    wizard.moiPrenom = document.getElementById('stMoiPrenom').value.trim();
    if(!wizard.foyerNom || !wizard.moiPrenom || !wizard.situation){
      errEl.textContent = 'Merci de compléter le nom du foyer, votre prénom, et de choisir une situation.';
      return;
    }
    if(wizard.situation === 'seul'){
      wizard.count = 1;
      wizard.stepOrder = [1,3,4];
    } else {
      wizard.stepOrder = [1,2,3,4];
    }
    wizard.idx = 1;
    if(wizard.situation === 'seul') buildPersonForms();
    showWizardStep();
  } else if(step === 2){
    wizard.idx++;
    buildPersonForms();
    showWizardStep();
  } else if(step === 3){
    const list = collectPersonForms();
    if(!list){ errEl.textContent = 'Merci de renseigner le prénom de chaque personne.'; return; }
    wizard.personnes = list;
    wizard.idx++;
    renderRecap();
    showWizardStep();
  } else if(step === 4){
    submitWizard();
  }
});

/* ============ AUTHENTIFICATION (comptes séparés) ============
   Un compte Firebase Auth (email + mot de passe) par foyer. Le document
   Firestore de chaque foyer est identifié par l'uid du compte connecté :
   personne d'autre ne peut y accéder (voir la règle Firestore basée sur
   request.auth.uid). Se souvenir de son mot de passe est indispensable —
   il n'existe aucun moyen de récupérer les données sans lui. */
function switchAuthTab(tab){
  document.getElementById('authTabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('authTabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'flex' : 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('registerError').textContent = '';
}
window.switchAuthTab = switchAuthTab;
function authErrorMessage(err){
  const map = {
    'auth/invalid-email': "Adresse e-mail invalide.",
    'auth/user-not-found': "Aucun compte ne correspond à cette adresse.",
    'auth/wrong-password': "Mot de passe incorrect.",
    'auth/invalid-credential': "Adresse ou mot de passe incorrect.",
    'auth/email-already-in-use': "Un compte existe déjà avec cette adresse — utilisez plutôt « Se connecter ».",
    'auth/weak-password': "Le mot de passe doit contenir au moins 6 caractères.",
    'auth/too-many-requests': "Trop de tentatives. Réessayez dans quelques minutes.",
    'auth/network-request-failed': "Problème de connexion internet. Réessayez.",
    'auth/operation-not-allowed': "La connexion par e-mail n'est pas encore activée dans Firebase Console (Authentication → Sign-in method → Email/Password).",
    'auth/requires-recent-login': "Par sécurité, reconnectez-vous puis réessayez immédiatement cette action.",
    'auth/user-mismatch': "Ce mot de passe ne correspond pas au compte connecté.",
  };
  if(map[err.code]) return map[err.code];
  // Bug de stockage propre au navigateur (fréquent sur Safari iPhone après une
  // longue inactivité ou en navigation privée) : message clair et actionnable
  // plutôt que le texte technique brut renvoyé par le navigateur.
  const msg = String(err.message || '');
  if(/backing store|object store|indexeddb/i.test(msg)){
    return "Le navigateur rencontre un problème de stockage local (fréquent sur iPhone après une longue inactivité, ou en navigation privée). Essayez de recharger la page ; si ça persiste, quittez la navigation privée ou videz les données de ce site dans les réglages du navigateur, puis réessayez.";
  }
  return "Erreur : " + (err.message || err.code || 'inconnue');
}
document.getElementById('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  auth.signInWithEmailAndPassword(email, password).catch(err => {
    errEl.textContent = authErrorMessage(err);
  });
});
document.getElementById('registerForm').addEventListener('submit', e => {
  e.preventDefault();
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const password2 = document.getElementById('registerPassword2').value;
  if(password !== password2){ errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
  auth.createUserWithEmailAndPassword(email, password).catch(err => {
    errEl.textContent = authErrorMessage(err);
  });
});
/* Vide les champs email/mot de passe de connexion et création de compte —
   appelé à la déconnexion et à chaque affichage de l'écran de connexion,
   pour qu'aucune valeur saisie précédemment ne reste visible ou soumise. */
function clearAuthFormFields(){
  ['loginEmail','loginPassword','registerEmail','registerPassword','registerPassword2'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const loginErr = document.getElementById('loginError'); if(loginErr) loginErr.textContent = '';
  const regErr = document.getElementById('registerError'); if(regErr) regErr.textContent = '';
}
function logoutUser(){
  openModal({
    title: 'Se déconnecter ?',
    sub: 'Vous pourrez vous reconnecter à tout moment avec votre adresse et votre mot de passe.',
    submitLabel: 'Se déconnecter',
    fields: [],
    onSubmit(){
      auth.signOut();
      clearAuthFormFields();
    }
  });
}
window.logoutUser = logoutUser;
function openDeleteAccountModal(){
  const user = auth.currentUser;
  if(!user) return;
  openModal({
    title: 'Supprimer définitivement mon compte',
    sub: `Cette action supprime immédiatement et sans retour possible toutes les données de votre foyer ainsi que votre compte de connexion (${user.email}). Entrez votre mot de passe pour confirmer.`,
    submitLabel: 'Supprimer définitivement',
    fields: [
      {id:'password', label:'Mot de passe', type:'password', value:''},
      {id:'confirm', label:'Je comprends que cette action est irréversible', type:'checkbox', value:false},
    ],
    onSubmit(v){
      if(!v.confirm){ alertModal('Veuillez cocher la case de confirmation.'); return; }
      if(!v.password){ alertModal('Mot de passe requis.'); return; }
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, v.password);
      const uid = user.uid;
      user.reauthenticateWithCredential(credential)
        .then(() => db.collection('foyers').doc(uid).delete())
        .then(() => user.delete())
        .then(() => {
          clearAuthFormFields();
          showToast('Compte et données supprimés définitivement.');
        })
        .catch(err => {
          console.error('Erreur de suppression de compte :', err);
          alertModal(authErrorMessage(err));
        });
    }
  });
}
window.openDeleteAccountModal = openDeleteAccountModal;
/* Bouton "œil" sur les champs mot de passe (connexion et création de compte). */
function togglePasswordVisibility(inputId, btn){
  const el = document.getElementById(inputId);
  if(!el) return;
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
}
window.togglePasswordVisibility = togglePasswordVisibility;
/* Mot de passe oublié : envoie un e-mail Firebase standard contenant un lien
   pour en choisir un nouveau. Aucune donnée n'est modifiée ici — c'est
   Firebase qui gère l'envoi et la validation du lien. */
function openForgotPasswordModal(){
  const loginEmailEl = document.getElementById('loginEmail');
  const prefill = loginEmailEl ? loginEmailEl.value.trim() : '';
  openModal({
    title: 'Mot de passe oublié',
    sub: 'Entrez votre adresse e-mail : si un compte existe, vous recevrez un lien pour choisir un nouveau mot de passe.',
    submitLabel: 'Envoyer le lien',
    fields: [{id:'email', label:'Adresse e-mail', type:'email', value:prefill}],
    onSubmit(v){
      const email = (v.email||'').trim();
      if(!email){ alertModal('Adresse e-mail requise.'); return; }
      auth.sendPasswordResetEmail(email).then(() => {
        alertModal(`Un e-mail vient d'être envoyé à ${email} avec un lien pour choisir un nouveau mot de passe. Pensez à vérifier vos courriers indésirables.`, {title:'E-mail envoyé ✅'});
      }).catch(err => {
        alertModal(authErrorMessage(err));
      });
    }
  });
}
window.openForgotPasswordModal = openForgotPasswordModal;

/* ============ SYNCHRONISATION ============
   Se déclenche à chaque changement d'état de connexion (connexion,
   inscription, déconnexion, ou session déjà active au chargement de la
   page). Chaque foyer lit/écrit uniquement son propre document. */
auth.onAuthStateChanged(user => {
  if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  if(!user){
    DOC_REF = null;
    dataReady = false;
    foyerExists = false;
    // Toujours repartir du tableau de bord à la prochaine connexion, plutôt
    // que de rouvrir l'onglet où l'on se trouvait avant de se déconnecter.
    currentView = 'dashboard';
    saveLocalPrefs();
    showAuthScreen();
    return;
  }
  DOC_REF = db.collection('foyers').doc(user.uid);
  showLoadingScreen();
  unsubscribeSnapshot = DOC_REF.onSnapshot(snap => {
    if(snap.exists){
      let shared = migrateLegacyIfNeeded(snap.data());
      DATA = Object.assign(defaultFoyerData(), shared);
      if(!Array.isArray(DATA.personnes)) DATA.personnes = [];
      foyerExists = true;
      dataReady = true;
      setSyncBadge('ok');
      showAppRoot();
      switchView(currentView);
      renderAll();
    } else {
      foyerExists = false;
      dataReady = false;
      showSetupScreen();
    }
  }, err => {
    console.error('Erreur de synchronisation Firestore :', err);
    setSyncBadge('err');
    // Si on n'a encore jamais réussi à charger les données, l'écran de
    // chargement resterait bloqué indéfiniment sans message : on affiche
    // l'erreur dessus plutôt que de laisser "Connexion à vos données…" tourner.
    if(!dataReady){
      const loading = document.getElementById('loadingScreen');
      if(loading){
        loading.innerHTML = `<div class="login-card" style="text-align:center;">
          <div class="login-brand" style="justify-content:center;"><span class="dot"></span>MA FAMILLE</div>
          <p class="login-sub" style="margin:10px 0 0;color:var(--red);">Impossible de se connecter à la base de données.<br>Vérifiez la règle Firestore et votre connexion internet, puis rechargez la page.</p>
        </div>`;
      }
    }
  });
});

/* ============ NAVIGATION ============
   6 onglets principaux (Tableau de bord / Comptes / Revenus / Dépenses /
   Calendrier / Plus) ; tout le reste vit derrière l'onglet "Plus" (menu en
   grille) pour ne pas surcharger l'interface quelle que soit la taille du foyer.
   Factures et Budget ne sont plus des vues séparées : leurs sections vivent
   désormais à l'intérieur de la vue Dépenses (mêmes éléments, mêmes fonctions
   de rendu — seul leur emplacement dans le DOM a changé). */
const MAIN_VIEWS = ['dashboard','accounts','revenus','depenses','calendar','plus'];
const PLUS_CHILDREN = ['savings','debts','foyer','settings','reports','forecast'];
const VIEWS = MAIN_VIEWS.concat(PLUS_CHILDREN);
function switchView(view){
  if(!VIEWS.includes(view)) view = 'dashboard';
  currentView = view;
  saveLocalPrefs();
  const navActive = MAIN_VIEWS.includes(view) ? view : 'plus';
  MAIN_VIEWS.forEach(v => {
    const nav = document.getElementById('nav' + v.charAt(0).toUpperCase() + v.slice(1));
    if(nav) nav.classList.toggle('active', v === navActive);
  });
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if(el) el.classList.toggle('active', v === view);
  });
  if(!dataReady) return;
  if(view === 'calendar') renderCalendar();
  if(view === 'forecast') renderForecast();
  if(view === 'reports') renderReports();
  if(view === 'foyer') renderFoyer();
  if(view === 'settings') renderSettings();
}
window.switchView = switchView;

function renderAll(){
  if(!dataReady) return;
  fillAllAccountSelects();
  fillAllCategorySelects();
  fillAllPersonSelects();
  renderDashboard();
  renderAccounts();
  renderTransfersHistory();
  renderRecurring();
  renderRevenusHistory();
  renderDepensesHistory();
  renderBudget();
  renderBills();
  renderSavings();
  renderDebts();
  if(currentView === 'calendar') renderCalendar();
  if(currentView === 'forecast') renderForecast();
  if(currentView === 'reports') renderReports();
  if(currentView === 'foyer') renderFoyer();
  if(currentView === 'settings') renderSettings();
}

/* ============ CATÉGORIES ============ */
function allExpenseCategories(){
  const custom = (DATA.categories || []).filter(c => c.type === 'depense');
  return EXPENSE_CATEGORIES.concat(custom.map(c => ({id:c.id, label:c.label, icon:'🏷️'})));
}
function allIncomeCategories(){
  const custom = (DATA.categories || []).filter(c => c.type === 'revenu');
  return INCOME_CATEGORIES.concat(custom.map(c => ({id:c.id, label:c.label, icon:'🏷️'})));
}
function categoryInfo(id, type){
  const list = type === 'revenu' ? allIncomeCategories() : allExpenseCategories();
  return list.find(c => c.id === id) || {id, label:id, icon:'📦'};
}
/* 'fixe' ou 'variable', déterminé une fois pour toutes par catégorie de
   dépense (voir EXPENSE_CATEGORIES et le formulaire "Catégories
   personnalisées" de Paramètres). Par défaut 'variable' si non précisé. */
function categoryNature(catId){
  const builtin = EXPENSE_CATEGORIES.find(c => c.id === catId);
  if(builtin) return builtin.nature || 'variable';
  const custom = (DATA.categories||[]).find(c => c.id === catId && c.type === 'depense');
  if(custom) return custom.nature || 'variable';
  return 'variable';
}
function fillCategorySelect(selectEl, type, keepValue){
  if(!selectEl) return;
  const prev = keepValue ? selectEl.value : null;
  const list = type === 'revenu' ? allIncomeCategories() : allExpenseCategories();
  selectEl.innerHTML = list.map(c => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');
  if(prev && list.some(c => c.id === prev)) selectEl.value = prev;
}
function fillAllCategorySelects(){
  fillCategorySelect(document.getElementById('inCategory'), 'revenu', true);
  fillCategorySelect(document.getElementById('exCategory'), 'depense', true);
  fillCategorySelect(document.getElementById('bgCategory'), 'depense', true);
  const revCat = document.getElementById('revFilterCategory');
  if(revCat){
    const prev = revCat.value;
    revCat.innerHTML = '<option value="">Toutes catégories</option>' + allIncomeCategories().map(c => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');
    revCat.value = prev;
  }
  const depCat = document.getElementById('depFilterCategory');
  if(depCat){
    const prev = depCat.value;
    depCat.innerHTML = '<option value="">Toutes catégories</option>' + allExpenseCategories().map(c => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');
    depCat.value = prev;
  }
  const cmpCat = document.getElementById('reportComparisonCategory');
  if(cmpCat){
    const prev = cmpCat.value;
    cmpCat.innerHTML = allExpenseCategories().map(c => `<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`).join('');
    if(prev && allExpenseCategories().some(c=>c.id===prev)) cmpCat.value = prev;
  }
}

/* ============ PERSONNES DU FOYER ============ */
function personById(id){ return (DATA.personnes||[]).find(p => p.id === id); }
function activePersonnes(){ return (DATA.personnes||[]).filter(p => p.presente !== false); }
function inactivePersonnes(){ return (DATA.personnes||[]).filter(p => p.presente === false); }
function soiPersonne(){ return (DATA.personnes||[]).find(p => p.relation === 'soi') || activePersonnes()[0] || null; }
function personLabel(id){
  if(!id || id === 'foyer') return 'Foyer';
  const p = personById(id);
  return p ? p.prenom : 'Foyer';
}
function fillPersonSelect(selectEl, keepValue){
  if(!selectEl) return;
  const prev = keepValue ? selectEl.value : null;
  const active = activePersonnes();
  let html = `<option value="foyer">👨‍👩‍👧‍👦 Foyer (commun)</option>`;
  html += active.map(p => {
    const rel = relationInfo(p.relation);
    return `<option value="${p.id}">${rel.icon} ${escapeHtml(p.prenom)}</option>`;
  }).join('');
  selectEl.innerHTML = html;
  if(prev && (prev === 'foyer' || active.some(p => p.id === prev))) selectEl.value = prev;
}
function fillAllPersonSelects(){
  fillPersonSelect(document.getElementById('inPersonId'), true);
  fillPersonSelect(document.getElementById('exPersonId'), true);
  fillPersonSelect(document.getElementById('naOwner'), true);
}
function personMonthlyPersonalExpense(personId, key){
  return sumAmount((DATA.transactions||[]).filter(t => t.type === 'depense' && t.personId === personId && monthKeyOf(t.date) === key));
}
function renderPersonCard(p){
  const rel = relationInfo(p.relation);
  const inactive = p.presente === false;
  const key = currentMonthKey();
  const monthExp = personMonthlyPersonalExpense(p.id, key);
  let statsHtml = `<div class="ps"><div class="k">Dépenses perso ce mois</div><div class="v">${formatFCFA(monthExp)}</div></div>`;
  if(p.dateNaissance) statsHtml += `<div class="ps"><div class="k">Âge</div><div class="v">${ageFromBirthdate(p.dateNaissance)}</div></div>`;
  if(p.relation === 'aide_domestique'){
    const total = (Number(p.remuneration)||0) + (Number(p.transport)||0) + (Number(p.autres)||0);
    statsHtml += `<div class="ps"><div class="k">Coût mensuel prévu</div><div class="v">${formatFCFA(total)}</div></div>`;
  }
  let actions;
  if(inactive){
    actions = `<button class="icon-btn" title="Faire revenir" onclick="reactivatePerson('${p.id}')">↩</button>`;
  } else {
    actions = `<button class="icon-btn" title="Modifier" onclick="editPerson('${p.id}')">✎</button>`;
    if(p.relation !== 'soi') actions += `<button class="icon-btn danger" title="Retirer du foyer" onclick="deactivatePerson('${p.id}')">🚪</button>`;
  }
  const dateDepartStr = (inactive && p.dateDepart) ? ' · Parti(e) le ' + new Date(p.dateDepart+'T00:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '';
  return `
    <div class="person-card ${inactive?'inactive':''}">
      <div class="person-avatar">${initials(p.prenom)}</div>
      <div class="person-body">
        <div class="person-name">${escapeHtml(p.prenom)}</div>
        <div class="person-rel">${rel.icon} ${rel.label}${dateDepartStr}</div>
        <div class="person-tags">${p.aCharge?'<span class="tag orange">À charge</span>':''}${p.contribution?'<span class="tag green">Contribue aux revenus</span>':''}</div>
        <div class="person-stats">${statsHtml}</div>
      </div>
      <div class="person-actions">${actions}</div>
    </div>`;
}
function renderFoyer(){
  document.getElementById('fyNom').value = DATA.foyer.nom || '';
  document.getElementById('fySituation').value = DATA.foyer.situationLogement || 'famille';
  document.getElementById('foyerTitle').textContent = DATA.foyer.nom || 'Foyer';
  const active = activePersonnes();
  document.getElementById('personnesList').innerHTML = active.length ? active.map(renderPersonCard).join('') : `<div class="empty">Aucune personne enregistrée.</div>`;
  const inactive = inactivePersonnes();
  const pastCard = document.getElementById('pastPersonsCard');
  if(inactive.length){
    pastCard.style.display = 'block';
    document.getElementById('pastPersonnesList').innerHTML = inactive.map(renderPersonCard).join('');
  } else {
    pastCard.style.display = 'none';
  }
}
document.getElementById('foyerInfoForm').addEventListener('submit', e => {
  e.preventDefault();
  DATA.foyer.nom = document.getElementById('fyNom').value.trim();
  DATA.foyer.situationLogement = document.getElementById('fySituation').value;
  saveData();
  renderAll();
  renderFoyer();
  showToast('Informations du foyer mises à jour ✅');
});
function openAddPerson(){
  const relationOptions = RELATIONS.filter(r => r.id !== 'soi').map(r => ({value:r.id, label:`${r.icon} ${r.label}`}));
  openModal({
    title: 'Ajouter une personne au foyer',
    submitLabel: 'Ajouter',
    fields: [
      {id:'prenom', label:'Prénom', type:'text', value:''},
      {id:'relation', label:'Lien avec vous', type:'select', value:relationOptions[0].value, options:relationOptions},
      {id:'naissance', label:'Date de naissance (facultatif)', type:'date', value:''},
      {id:'acharge', label:'À charge financièrement', type:'checkbox', value:false},
      {id:'contribution', label:'Contribue aux revenus du foyer', type:'checkbox', value:false},
      {id:'role', label:'Rôle (aide à la maison)', type:'text', value:'', placeholder:'Ex. Aide ménagère'},
      {id:'frequence', label:'Fréquence (aide à la maison)', type:'text', value:'', placeholder:'Ex. Tous les jours'},
      {id:'remuneration', label:'Rémunération mensuelle (FCFA)', type:'number', value:0},
      {id:'transport', label:'Transport (FCFA)', type:'number', value:0},
      {id:'autres', label:'Autres frais (FCFA)', type:'number', value:0},
    ],
    conditional: {trigger:'relation', showValue:'aide_domestique', fieldIds:['role','frequence','remuneration','transport','autres']},
    onSubmit(v){
      const prenom = v.prenom.trim();
      if(!prenom){ alertModal('Le prénom est obligatoire.'); return; }
      const isAide = v.relation === 'aide_domestique';
      const p = {
        id: genId('p'), prenom, nom:'', relation:v.relation,
        dateNaissance: v.naissance, telephone:'',
        aCharge: !!v.acharge, contribution: !!v.contribution,
        role: isAide ? v.role.trim() : '',
        frequence: isAide ? v.frequence.trim() : '',
        remuneration: isAide ? (Number(v.remuneration)||0) : 0,
        transport: isAide ? (Number(v.transport)||0) : 0,
        autres: isAide ? (Number(v.autres)||0) : 0,
        presente: true, dateArrivee: todayStr(), dateDepart: null,
      };
      DATA.personnes.push(p);
      saveData();
      renderAll();
      renderFoyer();
      showToast(`${prenom} a rejoint le foyer ✅`);
    }
  });
}
window.openAddPerson = openAddPerson;
function editPerson(id){
  const p = personById(id);
  if(!p) return;
  const fields = [
    {id:'prenom', label:'Prénom', type:'text', value:p.prenom},
    {id:'naissance', label:'Date de naissance (facultatif)', type:'date', value:p.dateNaissance||''},
  ];
  if(p.relation !== 'soi'){
    fields.push({id:'acharge', label:'À charge financièrement', type:'checkbox', value:p.aCharge});
    fields.push({id:'contribution', label:'Contribue aux revenus du foyer', type:'checkbox', value:p.contribution});
  }
  if(p.relation === 'aide_domestique'){
    fields.push({id:'remuneration', label:'Rémunération mensuelle (FCFA)', type:'number', value:p.remuneration||0});
    fields.push({id:'transport', label:'Transport (FCFA)', type:'number', value:p.transport||0});
    fields.push({id:'autres', label:'Autres frais (FCFA)', type:'number', value:p.autres||0});
  }
  openModal({
    title: `Modifier ${p.prenom}`,
    sub: relationInfo(p.relation).label,
    submitLabel: 'Enregistrer',
    fields,
    onSubmit(v){
      if(v.prenom.trim()) p.prenom = v.prenom.trim();
      p.dateNaissance = v.naissance || '';
      if(p.relation !== 'soi'){
        p.aCharge = !!v.acharge;
        p.contribution = !!v.contribution;
      }
      if(p.relation === 'aide_domestique'){
        p.remuneration = Number(v.remuneration) || 0;
        p.transport = Number(v.transport) || 0;
        p.autres = Number(v.autres) || 0;
      }
      saveData();
      renderFoyer();
      renderDashboard();
      showToast('Personne mise à jour ✅');
    }
  });
}
window.editPerson = editPerson;
function deactivatePerson(id){
  const p = personById(id);
  if(!p) return;
  if(p.relation === 'soi'){ alertModal('Vous ne pouvez pas vous retirer vous-même du foyer.'); return; }
  confirmModal(`Faire partir "${p.prenom}" du foyer ? Son historique financier (transactions passées) sera entièrement conservé — cette action est réversible depuis "Personnes parties du foyer".`, () => {
    p.presente = false;
    p.dateDepart = todayStr();
    saveData();
    renderAll();
    renderFoyer();
    showToast(`${p.prenom} est marqué(e) comme parti(e) du foyer.`);
  }, {title:'Faire partir du foyer', submitLabel:'Faire partir'});
}
window.deactivatePerson = deactivatePerson;
function reactivatePerson(id){
  const p = personById(id);
  if(!p) return;
  p.presente = true;
  p.dateDepart = null;
  saveData();
  renderAll();
  renderFoyer();
  showToast(`${p.prenom} fait de nouveau partie du foyer ✅`);
}
window.reactivatePerson = reactivatePerson;

/* ============ COMPTES ============ */
function accountById(id){ return (DATA.accounts||[]).find(a => a.id === id); }
function accountTypeInfo(type){ return ACCOUNT_TYPES.find(t => t.id === type) || ACCOUNT_TYPES[ACCOUNT_TYPES.length-1]; }
function totalAllAccounts(){ return (DATA.accounts||[]).reduce((s,a) => s + (Number(a.balance)||0), 0); }
function totalReserved(){ return (DATA.savingsGoals||[]).reduce((s,g) => s + (Number(g.current)||0), 0); }
function totalUsable(){ return totalAllAccounts() - totalReserved(); }
function fillAccountSelect(selectEl, keepValue, allowEmpty){
  if(!selectEl) return;
  const prev = keepValue ? selectEl.value : null;
  const accounts = DATA.accounts || [];
  let html = allowEmpty ? '<option value="">—</option>' : '';
  html += accounts.map(a => {
    const t = accountTypeInfo(a.type);
    return `<option value="${a.id}">${t.icon} ${escapeHtml(a.name)} (${formatFCFA(a.balance)})</option>`;
  }).join('');
  selectEl.innerHTML = html;
  if(prev && accounts.some(a => a.id === prev)) selectEl.value = prev;
}
function fillAllAccountSelects(){
  fillAccountSelect(document.getElementById('inAccount'), true, false);
  fillAccountSelect(document.getElementById('exAccount'), true, false);
  fillAccountSelect(document.getElementById('blAccount'), true, true);
}
function renderAccounts(){
  document.getElementById('acctTotalAll').textContent = formatFCFA(totalAllAccounts());
  document.getElementById('acctTotalReserved').textContent = formatFCFA(totalReserved());
  document.getElementById('acctTotalUsable').textContent = formatFCFA(totalUsable());
  const el = document.getElementById('accountsList');
  const accounts = (DATA.accounts || []).slice().sort((a,b) => a.name.localeCompare(b.name, 'fr'));
  el.innerHTML = accounts.length ? accounts.map(a => {
    const t = accountTypeInfo(a.type);
    const ownerSub = a.ownerId && a.ownerId !== 'foyer' ? ' · ' + escapeHtml(personLabel(a.ownerId)) : ' · Foyer (commun)';
    return `
      <div class="row-item">
        <div class="row-icon">${t.icon}</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(a.name)}</div>
          <div class="row-sub">${t.label}${ownerSub}</div>
        </div>
        <div class="row-amount">${formatFCFA(a.balance)}</div>
        <div class="row-actions">
          <button class="icon-btn" title="Modifier" onclick="editAccount('${a.id}')">✎</button>
          <button class="icon-btn danger" title="Supprimer" onclick="deleteAccount('${a.id}')">🗑</button>
        </div>
      </div>`;
  }).join('') : `<div class="empty">Aucun moyen financier pour l'instant.</div>`;
}
/* Historique compact des transferts, affiché en bas de l'onglet Comptes
   (les 20 plus récents) — la modale "🔁 Nouveau transfert" reste le seul
   moyen d'en créer un. */
function renderTransfersHistory(){
  const el = document.getElementById('transfersHistoryList');
  if(!el) return;
  const list = (DATA.transactions||[]).filter(t => t.type === 'transfert').slice().sort((a,b) => b.date.localeCompare(a.date)).slice(0,20);
  el.innerHTML = list.length ? list.map(txnRowHtml).join('') : `<div class="empty">Aucun transfert pour le moment.</div>`;
}
document.getElementById('newAccountForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('naName').value.trim();
  const type = document.getElementById('naType').value;
  const balance = Number(document.getElementById('naBalance').value) || 0;
  const ownerId = document.getElementById('naOwner').value || 'foyer';
  if(!name) return;
  DATA.accounts.push({id: genId('acc'), name, type, balance, ownerId});
  saveData();
  e.target.reset();
  document.getElementById('naBalance').value = 0;
  renderAll();
  showToast('Compte ajouté ✅');
});
function editAccount(id){
  const a = accountById(id);
  if(!a) return;
  const ownerOptions = [{value:'foyer', label:'👨‍👩‍👧‍👦 Foyer (commun)'}].concat(
    activePersonnes().map(p => ({value:p.id, label:`${relationInfo(p.relation).icon} ${p.prenom}`}))
  );
  openModal({
    title: 'Modifier ce compte',
    submitLabel: 'Enregistrer',
    fields: [
      {id:'name', label:'Nom du compte', type:'text', value:a.name},
      {id:'balance', label:'Solde actuel (FCFA) — ajustement seulement', type:'number', value:a.balance},
      {id:'owner', label:'Propriétaire', type:'select', value:a.ownerId||'foyer', options:ownerOptions},
    ],
    onSubmit(v){
      if(v.name.trim()) a.name = v.name.trim();
      const nb = Number(v.balance);
      if(!isNaN(nb)) a.balance = nb;
      a.ownerId = v.owner || 'foyer';
      saveData();
      renderAll();
      showToast('Compte mis à jour ✅');
    }
  });
}
window.editAccount = editAccount;
function deleteAccount(id){
  const a = accountById(id);
  if(!a) return;
  if((DATA.accounts||[]).length <= 1){
    alertModal('Impossible de supprimer le dernier moyen financier restant.');
    return;
  }
  confirmModal(`Supprimer "${a.name}" ? Son solde (${formatFCFA(a.balance)}) sera perdu de votre total. Cette action est irréversible.`, () => {
    DATA.accounts = DATA.accounts.filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer ce compte', submitLabel:'Supprimer'});
}
window.deleteAccount = deleteAccount;
function transferFee(fromId, amount){
  const from = accountById(fromId);
  if(!from || !amount || amount <= 0) return 0;
  return MOBILE_MONEY_TYPES.includes(from.type) ? Math.round(amount * 0.01) : 0;
}
/* Transfert entre comptes : désormais ouvert depuis une modale (bouton
   "🔁 Nouveau transfert" en haut de l'onglet Comptes) plutôt que depuis un
   formulaire fixe dans la page — même logique de calcul et de frais qu'avant,
   simplement présentée en Userform. */
function openTransferModal(){
  const accounts = DATA.accounts || [];
  if(accounts.length < 2){ alertModal('Il faut au moins deux comptes pour effectuer un transfert.'); return; }
  const accOptions = accounts.map(a => ({value:a.id, label:`${accountTypeInfo(a.type).icon} ${a.name} (${formatFCFA(a.balance)})`}));
  openModal({
    title: 'Transfert entre comptes',
    sub: "Déplace de l'argent d'un compte à un autre : ce n'est ni une dépense ni un revenu, cela ne fausse donc pas vos statistiques.",
    submitLabel: 'Effectuer le transfert',
    fields: [
      {id:'from', label:'Depuis', type:'select', value:accOptions[0].value, options:accOptions},
      {id:'to', label:'Vers', type:'select', value:(accOptions[1]||accOptions[0]).value, options:accOptions},
      {id:'amount', label:'Montant (FCFA)', type:'number', value:''},
      {id:'note', label:'Note (facultatif)', type:'text', value:'', placeholder:'Ex. Retrait pour dépenses courantes'},
      {id:'feehint', label:'', type:'hint', value:''},
    ],
    onRender(){
      const fromEl = document.getElementById('modal_from');
      const amountEl = document.getElementById('modal_amount');
      const hintEl = document.getElementById('modal_feehint');
      const update = () => {
        const fee = transferFee(fromEl.value, Number(amountEl.value));
        hintEl.innerHTML = fee > 0 ? `⚠️ Frais mobile money (1%) : <b>${formatFCFA(fee)}</b> — le compte de destination recevra ${formatFCFA(Number(amountEl.value) - fee)}.` : '';
      };
      fromEl.addEventListener('change', update);
      amountEl.addEventListener('input', update);
    },
    onSubmit(v){
      const fromId = v.from, toId = v.to, amount = Number(v.amount), note = (v.note||'').trim();
      if(!fromId || !toId || fromId === toId || !amount || amount <= 0){
        alertModal('Choisissez deux comptes différents et un montant valide.');
        return;
      }
      const from = accountById(fromId), to = accountById(toId);
      if(!from || !to) return;
      const fee = transferFee(fromId, amount);
      const received = amount - fee;
      from.balance -= amount;
      to.balance += received;
      DATA.transactions.push({
        id: genId('txn'), type:'transfert', amount, date: todayStr(),
        accountId: fromId, toAccountId: toId, note, category:'', subcategory:'', personId:'foyer', fee
      });
      saveData();
      renderAll();
      showToast(fee > 0 ? `Transfert effectué : ${from.name} → ${to.name} (frais 1% : ${formatFCFA(fee)})` : `Transfert effectué : ${from.name} → ${to.name}`);
    }
  });
}
window.openTransferModal = openTransferModal;

/* ============ REVENUS & DÉPENSES ============ */
document.getElementById('inDate').value = todayStr();
document.getElementById('exDate').value = todayStr();
document.getElementById('newIncomeForm').addEventListener('submit', e => {
  e.preventDefault();
  const amount = Number(document.getElementById('inAmount').value);
  const date = document.getElementById('inDate').value;
  const personId = document.getElementById('inPersonId').value || 'foyer';
  const category = document.getElementById('inCategory').value;
  const accountId = document.getElementById('inAccount').value;
  const note = document.getElementById('inNote').value.trim();
  const recurrent = document.getElementById('inRecurrent').checked;
  if(!amount || amount <= 0 || !date || !accountId){ alertModal('Vérifiez le montant, la date et le compte.'); return; }
  const account = accountById(accountId);
  if(!account) return;
  let recurringId = '';
  if(recurrent){
    const rec = {id: genId('rec'), label: categoryInfo(category,'revenu').label, type:'revenu', amount, category,
      personId, accountId, day: Number(date.slice(8,10)), fixedCharge:false, lastRecordedMonth: monthKeyOf(date)};
    DATA.recurring.push(rec);
    recurringId = rec.id;
  }
  account.balance += amount;
  DATA.transactions.push({id: genId('txn'), type:'revenu', amount, date, category, subcategory:'', personId, accountId, toAccountId:'', note, recurringId});
  saveData();
  e.target.reset();
  document.getElementById('inDate').value = todayStr();
  renderAll();
  showToast('Revenu enregistré ✅');
});
document.getElementById('newExpenseForm').addEventListener('submit', e => {
  e.preventDefault();
  const amount = Number(document.getElementById('exAmount').value);
  const date = document.getElementById('exDate').value;
  const category = document.getElementById('exCategory').value;
  const subcategory = document.getElementById('exSubcategory').value.trim();
  const personId = document.getElementById('exPersonId').value || 'foyer';
  const accountId = document.getElementById('exAccount').value;
  const note = document.getElementById('exNote').value.trim();
  const recurrent = document.getElementById('exRecurrent').checked;
  if(!amount || amount <= 0 || !date || !accountId){ alertModal('Vérifiez le montant, la date et le compte.'); return; }
  const account = accountById(accountId);
  if(!account) return;
  let recurringId = '';
  if(recurrent){
    const rec = {id: genId('rec'), label: subcategory || categoryInfo(category,'depense').label, type:'depense', amount, category,
      personId, accountId, day: Number(date.slice(8,10)), fixedCharge:false, lastRecordedMonth: monthKeyOf(date)};
    DATA.recurring.push(rec);
    recurringId = rec.id;
  }
  account.balance -= amount;
  DATA.transactions.push({id: genId('txn'), type:'depense', amount, date, category, subcategory, personId, accountId, toAccountId:'', note, recurringId});
  saveData();
  e.target.reset();
  document.getElementById('exDate').value = todayStr();
  renderAll();
  showToast('Dépense enregistrée ✅');
});
function deleteTransaction(id){
  const t = (DATA.transactions||[]).find(x => x.id === id);
  if(!t) return;
  confirmModal('Supprimer ce mouvement ? Le solde du compte concerné sera réajusté.', () => {
    if(t.type === 'revenu'){
      const a = accountById(t.accountId); if(a) a.balance -= t.amount;
    } else if(t.type === 'depense'){
      const a = accountById(t.accountId); if(a) a.balance += t.amount;
    } else if(t.type === 'transfert'){
      const from = accountById(t.accountId), to = accountById(t.toAccountId);
      if(from) from.balance += t.amount;
      if(to) to.balance -= (t.amount - (Number(t.fee)||0));
    }
    DATA.transactions = DATA.transactions.filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer ce mouvement', submitLabel:'Supprimer'});
}
window.deleteTransaction = deleteTransaction;

/* ============ RÉCURRENCES & CHARGES FIXES ============
   Depuis la restructuration en Revenus / Dépenses, les récurrences sont
   réparties dans trois listes distinctes (revenus, dépenses de nature fixe,
   dépenses de nature variable — voir categoryNature()) plutôt qu'une liste
   unique : chacune vit dans l'onglet correspondant. */
function recurringRowHtml(r, key){
  const info = categoryInfo(r.category, r.type);
  const done = r.lastRecordedMonth === key;
  const sign = r.type === 'revenu' ? 'pos' : 'neg';
  return `
    <div class="row-item">
      <div class="row-icon">${info.icon}</div>
      <div class="row-body">
        <div class="row-title">${escapeHtml(r.label)} ${r.fixedCharge?'<span class="tag violet">Charge fixe</span>':''} ${done?'<span class="tag green">Fait ce mois</span>':'<span class="tag orange">À enregistrer</span>'}</div>
        <div class="row-sub">${r.type === 'revenu' ? 'Revenu' : 'Dépense'} · le ${r.day} de chaque mois · ${escapeHtml(accountById(r.accountId)?accountById(r.accountId).name:'—')}${r.personId && r.personId!=='foyer' ? ' · '+escapeHtml(personLabel(r.personId)) : ''}</div>
      </div>
      <div class="row-amount ${sign}">${r.type==='revenu'?'+':'-'}${formatFCFA(r.amount)}</div>
      <div class="row-actions">
        <button class="icon-btn" title="Enregistrer ce mois" ${done?'disabled':''} onclick="recordRecurring('${r.id}')">✔</button>
        <button class="icon-btn" title="Charge fixe ?" onclick="toggleFixedCharge('${r.id}')">📌</button>
        <button class="icon-btn danger" title="Supprimer" onclick="deleteRecurring('${r.id}')">🗑</button>
      </div>
    </div>`;
}
function renderRecurring(){
  const list = DATA.recurring || [];
  const key = currentMonthKey();
  const incomeEl = document.getElementById('recurringListIncome');
  if(incomeEl){
    const incomeList = list.filter(r => r.type === 'revenu');
    incomeEl.innerHTML = incomeList.length ? incomeList.map(r => recurringRowHtml(r, key)).join('') : `<div class="empty">Aucun revenu récurrent pour le moment. Cochez "récurrent" sur un revenu pour en créer un.</div>`;
  }
  const fixedEl = document.getElementById('recurringListFixed');
  if(fixedEl){
    const fixedList = list.filter(r => r.type === 'depense' && categoryNature(r.category) === 'fixe');
    fixedEl.innerHTML = fixedList.length ? fixedList.map(r => recurringRowHtml(r, key)).join('') : `<div class="empty">Aucune dépense fixe récurrente pour le moment.</div>`;
  }
  const varEl = document.getElementById('recurringListVariable');
  if(varEl){
    const varList = list.filter(r => r.type === 'depense' && categoryNature(r.category) === 'variable');
    varEl.innerHTML = varList.length ? varList.map(r => recurringRowHtml(r, key)).join('') : `<div class="empty">Aucune dépense variable récurrente pour le moment.</div>`;
  }
}
function recordRecurring(id){
  const r = (DATA.recurring||[]).find(x => x.id === id);
  if(!r) return;
  const key = currentMonthKey();
  if(r.lastRecordedMonth === key){ alertModal('Déjà enregistré ce mois-ci.'); return; }
  const account = accountById(r.accountId);
  if(!account){ alertModal('Le compte associé à cette récurrence n\'existe plus.'); return; }
  const date = dateForDayInMonth(key, r.day);
  const personId = r.personId || 'foyer';
  if(r.type === 'revenu'){
    account.balance += r.amount;
    DATA.transactions.push({id: genId('txn'), type:'revenu', amount:r.amount, date, category:r.category, subcategory:'', personId, accountId:r.accountId, toAccountId:'', note:r.label, recurringId:r.id});
  } else {
    account.balance -= r.amount;
    DATA.transactions.push({id: genId('txn'), type:'depense', amount:r.amount, date, category:r.category, subcategory:r.label, personId, accountId:r.accountId, toAccountId:'', note:'', recurringId:r.id});
  }
  r.lastRecordedMonth = key;
  saveData();
  renderAll();
  showToast('Récurrence enregistrée pour ce mois ✅');
}
window.recordRecurring = recordRecurring;
function toggleFixedCharge(id){
  const r = (DATA.recurring||[]).find(x => x.id === id);
  if(!r) return;
  r.fixedCharge = !r.fixedCharge;
  saveData();
  renderRecurring();
}
window.toggleFixedCharge = toggleFixedCharge;
function deleteRecurring(id){
  confirmModal('Supprimer cette récurrence ? Les transactions déjà enregistrées restent intactes.', () => {
    DATA.recurring = (DATA.recurring||[]).filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer cette récurrence', submitLabel:'Supprimer'});
}
window.deleteRecurring = deleteRecurring;

/* ============ HISTORIQUE ============
   Depuis la restructuration, chaque type de mouvement a sa propre vue et donc
   son propre historique filtrable : Revenus (revenus uniquement), Dépenses
   (dépenses uniquement, avec un filtre supplémentaire fixe/variable), et un
   petit historique des transferts dans Comptes (voir renderTransfersHistory
   plus haut, sans filtre). */
function clearRevFilters(){
  document.getElementById('revFilterMonth').value = '';
  document.getElementById('revFilterCategory').value = '';
  const searchEl = document.getElementById('revFilterSearch');
  if(searchEl) searchEl.value = '';
  renderRevenusHistory();
}
window.clearRevFilters = clearRevFilters;
['revFilterMonth','revFilterCategory'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', renderRevenusHistory);
});
const revFilterSearchEl = document.getElementById('revFilterSearch');
if(revFilterSearchEl) revFilterSearchEl.addEventListener('input', renderRevenusHistory);

function clearDepFilters(){
  document.getElementById('depFilterMonth').value = '';
  document.getElementById('depFilterCategory').value = '';
  document.getElementById('depFilterNature').value = '';
  const searchEl = document.getElementById('depFilterSearch');
  if(searchEl) searchEl.value = '';
  renderDepensesHistory();
}
window.clearDepFilters = clearDepFilters;
['depFilterMonth','depFilterCategory','depFilterNature'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', renderDepensesHistory);
});
const depFilterSearchEl = document.getElementById('depFilterSearch');
if(depFilterSearchEl) depFilterSearchEl.addEventListener('input', renderDepensesHistory);

function txnRowHtml(t){
  const from = accountById(t.accountId);
  const to = accountById(t.toAccountId);
  let icon = '↔️', title = 'Transfert', sub = `${from?from.name:'—'} → ${to?to.name:'—'}${t.fee?' · frais 1% : '+formatFCFA(t.fee):''}`, sign = '', cls = '';
  if(t.type === 'revenu'){
    const info = categoryInfo(t.category, 'revenu');
    icon = info.icon; title = info.label + (t.note?` — ${escapeHtml(t.note)}`:'');
    sub = `${from?from.name:'—'}${t.personId && t.personId!=='foyer' ? ' · '+escapeHtml(personLabel(t.personId)) : ''}`;
    sign = '+'; cls = 'pos';
  } else if(t.type === 'depense'){
    const info = categoryInfo(t.category, 'depense');
    icon = info.icon; title = info.label + (t.subcategory?` — ${escapeHtml(t.subcategory)}`:'');
    sub = `${from?from.name:'—'} · ${escapeHtml(personLabel(t.personId||'foyer'))}`;
    sign = '-'; cls = 'neg';
  } else if(t.type === 'epargne_ajout' || t.type === 'epargne_retrait'){
    icon = '🐷'; title = (t.type==='epargne_ajout'?'Ajout épargne — ':'Retrait épargne — ') + escapeHtml(t.note||'');
    sub = '';
    sign = t.type==='epargne_ajout' ? '-' : '+'; cls = t.type==='epargne_ajout' ? 'neg' : 'pos';
  }
  const dateStr = formatDateLong(t.date);
  return `
    <div class="row-item">
      <div class="row-icon">${icon}</div>
      <div class="row-body">
        <div class="row-title">${title || '—'}</div>
        <div class="row-sub">${dateStr}${sub?' · '+sub:''}</div>
      </div>
      <div class="row-amount ${cls}">${sign}${formatFCFA(t.amount)}</div>
      <div class="row-actions"><button class="icon-btn danger" title="Supprimer" onclick="deleteTransaction('${t.id}')">🗑</button></div>
    </div>`;
}
function transactionSearchText(t){
  const type = t.type === 'revenu' ? 'revenu' : (t.type === 'depense' ? 'depense' : '');
  const cat = type ? categoryInfo(t.category, type).label : '';
  const acc = accountById(t.accountId) ? accountById(t.accountId).name : '';
  return [t.note, t.subcategory, cat, personLabel(t.personId||'foyer'), acc].filter(Boolean).join(' ').toLowerCase();
}
/* Regroupe une liste de transactions déjà filtrée/triée par jour, avec le
   solde net de la journée en en-tête (revenus - dépenses ; les transferts et
   mouvements d'épargne ne comptent pas dans ce solde). Partagé par les
   historiques Revenus et Dépenses. */
function renderTxnGroupedList(el, list){
  if(!el) return;
  if(!list.length){ el.innerHTML = `<div class="empty">Aucun mouvement pour ces filtres.</div>`; return; }
  const capped = list.slice(0,200);
  const groups = [];
  capped.forEach(t => {
    const g = groups[groups.length-1];
    if(!g || g.date !== t.date) groups.push({date:t.date, items:[t]});
    else g.items.push(t);
  });
  el.innerHTML = groups.map(g => {
    const net = g.items.reduce((s,t) => s + (t.type==='revenu'?t.amount:(t.type==='depense'?-t.amount:0)), 0);
    const netCls = net > 0 ? 'pos' : (net < 0 ? 'neg' : '');
    const header = `<div class="txn-day-header"><span>${formatDateLong(g.date)}</span><span class="${netCls}">${net>=0?'+':''}${formatFCFA(net)}</span></div>`;
    return header + g.items.map(txnRowHtml).join('');
  }).join('');
}
function renderRevenusHistory(){
  const monthFilter = document.getElementById('revFilterMonth').value;
  const catFilter = document.getElementById('revFilterCategory').value;
  const searchEl = document.getElementById('revFilterSearch');
  const searchFilter = searchEl ? searchEl.value.trim().toLowerCase() : '';
  let list = (DATA.transactions || []).filter(t => t.type === 'revenu');
  if(monthFilter) list = list.filter(t => monthKeyOf(t.date) === monthFilter);
  if(catFilter) list = list.filter(t => t.category === catFilter);
  if(searchFilter) list = list.filter(t => transactionSearchText(t).includes(searchFilter));
  list.sort((a,b) => b.date.localeCompare(a.date));
  renderTxnGroupedList(document.getElementById('revTxnList'), list);
}
function renderDepensesHistory(){
  const monthFilter = document.getElementById('depFilterMonth').value;
  const catFilter = document.getElementById('depFilterCategory').value;
  const natureFilter = document.getElementById('depFilterNature').value;
  const searchEl = document.getElementById('depFilterSearch');
  const searchFilter = searchEl ? searchEl.value.trim().toLowerCase() : '';
  let list = (DATA.transactions || []).filter(t => t.type === 'depense');
  if(monthFilter) list = list.filter(t => monthKeyOf(t.date) === monthFilter);
  if(catFilter) list = list.filter(t => t.category === catFilter);
  if(natureFilter) list = list.filter(t => categoryNature(t.category) === natureFilter);
  if(searchFilter) list = list.filter(t => transactionSearchText(t).includes(searchFilter));
  list.sort((a,b) => b.date.localeCompare(a.date));
  renderTxnGroupedList(document.getElementById('depTxnList'), list);
}

/* ============ BUDGET ============ */
document.getElementById('newBudgetForm').addEventListener('submit', e => {
  e.preventDefault();
  const cat = document.getElementById('bgCategory').value;
  const amount = Number(document.getElementById('bgAmount').value);
  if(!cat || amount < 0 || isNaN(amount)) return;
  DATA.budgets[cat] = amount;
  saveData();
  e.target.reset();
  renderAll();
  showToast('Budget enregistré ✅');
});
document.getElementById('thresholdForm').addEventListener('submit', e => {
  e.preventDefault();
  const t50 = Number(document.getElementById('thr50').value) || 50;
  const t75 = Number(document.getElementById('thr75').value) || 75;
  const t90 = Number(document.getElementById('thr90').value) || 90;
  DATA.thresholds = [t50, t75, t90].sort((a,b)=>a-b);
  saveData();
  renderAll();
  showToast('Seuils mis à jour ✅');
});
function expensesForMonth(key, categoryFilter){
  return (DATA.transactions || []).filter(t => t.type === 'depense' && monthKeyOf(t.date) === key && (!categoryFilter || t.category === categoryFilter));
}
function sumAmount(list){ return list.reduce((s,t) => s + (Number(t.amount)||0), 0); }
function budgetBarClass(pct, thresholds){
  const [t1,t2,t3] = thresholds && thresholds.length===3 ? thresholds : DEFAULT_THRESHOLDS;
  if(pct >= 100) return 'red';
  if(pct >= t3) return 'red';
  if(pct >= t2) return 'orange';
  if(pct >= t1) return 'orange';
  return 'green';
}
function renderBudget(){
  const key = currentMonthKey();
  document.getElementById('budgetMonthLabel').textContent = monthLabel(key);
  document.getElementById('thr50').value = DATA.thresholds[0] ?? 50;
  document.getElementById('thr75').value = DATA.thresholds[1] ?? 75;
  document.getElementById('thr90').value = DATA.thresholds[2] ?? 90;
  const el = document.getElementById('budgetTrackList');
  let entries = Object.entries(DATA.budgets || {});
  if(!entries.length){
    el.innerHTML = `<div class="empty">Aucun budget défini pour le moment.</div>`;
    return;
  }
  // Les catégories les plus proches (ou au-delà) de leur plafond remontent en premier.
  entries = entries.slice().sort((a,b) => {
    const pctA = a[1] > 0 ? sumAmount(expensesForMonth(key, a[0])) / a[1] : 0;
    const pctB = b[1] > 0 ? sumAmount(expensesForMonth(key, b[0])) / b[1] : 0;
    return pctB - pctA;
  });
  el.innerHTML = entries.map(([catId, budget]) => {
    const info = categoryInfo(catId, 'depense');
    const spent = sumAmount(expensesForMonth(key, catId));
    const pct = budget > 0 ? Math.round((spent/budget)*100) : 0;
    const cls = budgetBarClass(pct, DATA.thresholds);
    const reste = budget - spent;
    return `
      <div class="budget-block">
        <div class="budget-block-top">
          <span class="name">${info.icon} ${escapeHtml(info.label)}</span>
          <span class="nums">${formatFCFA(spent)} / ${formatFCFA(budget)} · reste ${formatFCFA(reste)}</span>
        </div>
        <div class="progress-outer"><div class="progress-inner ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
        <div class="progress-label"><span>${pct}% utilisé</span><span>${pct>=100?'⚠️ Dépassé':''}</span></div>
      </div>`;
  }).join('');
}
function budgetAlerts(){
  const key = currentMonthKey();
  const alerts = [];
  Object.entries(DATA.budgets || {}).forEach(([catId, budget]) => {
    if(!budget) return;
    const info = categoryInfo(catId, 'depense');
    const spent = sumAmount(expensesForMonth(key, catId));
    const pct = Math.round((spent/budget)*100);
    const [t1,t2,t3] = DATA.thresholds && DATA.thresholds.length===3 ? DATA.thresholds : DEFAULT_THRESHOLDS;
    if(pct >= 100) alerts.push({level:'red', text:`${info.icon} ${info.label} : budget dépassé (${pct}%)`});
    else if(pct >= t3) alerts.push({level:'orange', text:`${info.icon} ${info.label} : ${pct}% du budget utilisé`});
    else if(pct >= t2) alerts.push({level:'orange', text:`${info.icon} ${info.label} : ${pct}% du budget utilisé`});
    else if(pct >= t1) alerts.push({level:'blue', text:`${info.icon} ${info.label} : ${pct}% du budget utilisé`});
  });
  return alerts;
}

/* ============ FACTURES ============ */
document.getElementById('newBillForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('blName').value.trim();
  const amount = Number(document.getElementById('blAmount').value);
  const due = document.getElementById('blDue').value;
  const accountId = document.getElementById('blAccount').value;
  if(!name || !amount || amount<=0 || !due) return;
  DATA.bills.push({id: genId('bill'), name, amount, due, accountId, paid:false, paidTxnId:''});
  saveData();
  e.target.reset();
  renderAll();
  showToast('Facture ajoutée ✅');
});
/* Sélecteur de compte en modale (remplace l'ancien prompt() numéroté). */
function pickAccountModal(title, sub, onPicked){
  const accounts = DATA.accounts || [];
  if(!accounts.length){ alertModal('Aucun compte disponible.'); return; }
  openModal({
    title, sub, submitLabel:'Confirmer',
    fields: [{id:'account', label:'Compte', type:'select', value:accounts[0].id,
      options: accounts.map(a => ({value:a.id, label:`${accountTypeInfo(a.type).icon} ${a.name} (${formatFCFA(a.balance)})`}))}],
    onSubmit(v){ const acc = accountById(v.account); if(acc) onPicked(acc); }
  });
}
function payBillWithAccount(b, account){
  account.balance -= b.amount;
  const txn = {id: genId('txn'), type:'depense', amount:b.amount, date: todayStr(), category:'maison', subcategory:b.name, personId:'foyer', accountId:account.id, toAccountId:'', note:`Facture : ${b.name}`, recurringId:''};
  DATA.transactions.push(txn);
  b.paid = true;
  b.paidTxnId = txn.id;
  b.accountId = account.id;
  saveData();
  renderAll();
}
function toggleBillPaid(id){
  const b = (DATA.bills||[]).find(x => x.id === id);
  if(!b) return;
  if(!b.paid){
    const account = accountById(b.accountId);
    if(account){ payBillWithAccount(b, account); return; }
    pickAccountModal(`Payer "${b.name}"`, `Montant : ${formatFCFA(b.amount)} — avec quel compte payez-vous cette facture ?`, acc => payBillWithAccount(b, acc));
    return;
  }
  confirmModal('Annuler le paiement de cette facture ? La dépense correspondante sera supprimée et le solde réajusté.', () => {
    const txn = (DATA.transactions||[]).find(t => t.id === b.paidTxnId);
    if(txn){
      const account = accountById(txn.accountId);
      if(account) account.balance += txn.amount;
      DATA.transactions = DATA.transactions.filter(t => t.id !== b.paidTxnId);
    }
    b.paid = false;
    b.paidTxnId = '';
    saveData();
    renderAll();
  }, {title:'Annuler le paiement', submitLabel:'Annuler le paiement'});
}
window.toggleBillPaid = toggleBillPaid;
function deleteBill(id){
  const b = (DATA.bills||[]).find(x => x.id === id);
  if(!b) return;
  if(b.paid){ alertModal('Cette facture est déjà payée. Annulez d\'abord le paiement avant de la supprimer.'); return; }
  confirmModal(`Supprimer la facture "${b.name}" ?`, () => {
    DATA.bills = DATA.bills.filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer cette facture', submitLabel:'Supprimer'});
}
window.deleteBill = deleteBill;
function renderBills(){
  const el = document.getElementById('billsList');
  const bills = (DATA.bills || []).slice().sort((a,b) => a.due.localeCompare(b.due));
  el.innerHTML = bills.length ? bills.map(b => {
    const n = daysUntil(b.due);
    let statusTag = b.paid ? '<span class="tag green">Payée</span>' : (n < 0 ? '<span class="tag red">En retard</span>' : '<span class="tag orange">À payer</span>');
    const dateStr = formatDateLong(b.due);
    return `
      <div class="row-item ${!b.paid && n<0 ? 'alert-row':''}">
        <div class="row-icon">🧾</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(b.name)} ${statusTag}${!b.paid?relativeDatePill(b.due):''}</div>
          <div class="row-sub">Échéance le ${dateStr}${!b.paid?` · ${n>=0?n+' j restants':Math.abs(n)+' j de retard'}`:''}</div>
        </div>
        <div class="row-amount neg">${formatFCFA(b.amount)}</div>
        <div class="row-actions">
          <button class="icon-btn" title="${b.paid?'Annuler le paiement':'Marquer payée'}" onclick="toggleBillPaid('${b.id}')">${b.paid?'↩':'✔'}</button>
          <button class="icon-btn danger" title="Supprimer" onclick="deleteBill('${b.id}')">🗑</button>
        </div>
      </div>`;
  }).join('') : `<div class="empty">Aucune facture pour le moment.</div>`;
}

/* ============ ÉPARGNE ============ */
document.getElementById('newGoalForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('gName').value.trim();
  const target = Number(document.getElementById('gTarget').value);
  const current = Number(document.getElementById('gCurrent').value) || 0;
  if(!name || !target || target<=0) return;
  DATA.savingsGoals.push({id: genId('goal'), name, target, current});
  saveData();
  e.target.reset();
  renderAll();
  showToast('Objectif créé ✅');
});
function goalById(id){ return (DATA.savingsGoals||[]).find(g => g.id === id); }
function adjustGoal(id, direction){
  const g = goalById(id);
  if(!g) return;
  const label = direction > 0 ? 'Ajouter à' : 'Retirer de';
  openModal({
    title: `${label} "${g.name}"`,
    sub: `Épargné actuellement : ${formatFCFA(g.current)} / ${formatFCFA(g.target)}`,
    submitLabel: direction>0 ? 'Ajouter' : 'Retirer',
    fields: [{id:'amount', label:'Montant (FCFA)', type:'number', value:''}],
    onSubmit(v){
      const amount = Number(v.amount);
      if(!amount || amount <= 0){ alertModal('Montant invalide.'); return; }
      if(direction < 0 && amount > g.current){ alertModal('Ce montant dépasse ce qui est actuellement épargné sur cet objectif.'); return; }
      const applyGoalChange = () => {
        g.current += direction * amount;
        DATA.transactions.push({
          id: genId('txn'), type: direction>0?'epargne_ajout':'epargne_retrait', amount, date: todayStr(),
          category:'', subcategory:'', personId:'foyer', accountId:'', toAccountId:'', note:g.name, recurringId:''
        });
        saveData();
        renderAll();
        if(direction>0 && g.current >= g.target) showToast(`🎉 Objectif "${g.name}" atteint !`);
        else showToast('Épargne mise à jour ✅');
      };
      if(direction > 0 && amount > totalUsable()){
        confirmModal(`Attention : cela dépasse votre argent utilisable actuel (${formatFCFA(totalUsable())}). Continuer quand même ?`, applyGoalChange, {title:'Dépasser l\'argent utilisable ?', submitLabel:'Continuer quand même'});
      } else {
        applyGoalChange();
      }
    }
  });
}
window.adjustGoal = adjustGoal;
function editGoal(id){
  const g = goalById(id);
  if(!g) return;
  openModal({
    title: 'Modifier l\'objectif',
    submitLabel: 'Enregistrer',
    fields: [
      {id:'name', label:'Nom', type:'text', value:g.name},
      {id:'target', label:'Montant cible (FCFA)', type:'number', value:g.target},
    ],
    onSubmit(v){
      if(v.name.trim()) g.name = v.name.trim();
      const nt = Number(v.target);
      if(nt > 0) g.target = nt;
      saveData();
      renderAll();
      showToast('Objectif mis à jour ✅');
    }
  });
}
window.editGoal = editGoal;
function deleteGoal(id){
  const g = goalById(id);
  if(!g) return;
  confirmModal(`Supprimer l'objectif "${g.name}" ? Les ${formatFCFA(g.current)} déjà épargnés redeviennent immédiatement utilisables.`, () => {
    DATA.savingsGoals = DATA.savingsGoals.filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer cet objectif', submitLabel:'Supprimer'});
}
window.deleteGoal = deleteGoal;
function renderSavings(){
  const el = document.getElementById('goalsList');
  const goals = (DATA.savingsGoals || []).slice().sort((a,b) => a.name.localeCompare(b.name,'fr'));
  const html = goals.length ? goals.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.current/g.target)*100)) : 0;
    return `
      <div class="row-item" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;align-items:center;gap:12px;width:100%;">
          <div class="row-icon">🐷</div>
          <div class="row-body">
            <div class="row-title">${escapeHtml(g.name)}</div>
            <div class="row-sub">${formatFCFA(g.current)} / ${formatFCFA(g.target)} · ${pct}%</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn" title="Ajouter" onclick="adjustGoal('${g.id}',1)">＋</button>
            <button class="icon-btn" title="Retirer" onclick="adjustGoal('${g.id}',-1)">－</button>
            <button class="icon-btn" title="Modifier" onclick="editGoal('${g.id}')">✎</button>
            <button class="icon-btn danger" title="Supprimer" onclick="deleteGoal('${g.id}')">🗑</button>
          </div>
        </div>
        <div class="progress-outer" style="width:100%;"><div class="progress-inner" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') : `<div class="empty">Aucun objectif d'épargne pour le moment.</div>`;
  el.innerHTML = html;
  const dashEl = document.getElementById('dashGoalsList');
  if(dashEl){
    dashEl.innerHTML = goals.length ? goals.slice(0,4).map(g => {
      const pct = g.target > 0 ? Math.min(100, Math.round((g.current/g.target)*100)) : 0;
      return `<div class="budget-block"><div class="budget-block-top"><span class="name">${escapeHtml(g.name)}</span><span class="nums">${pct}%</span></div><div class="progress-outer"><div class="progress-inner" style="width:${pct}%"></div></div></div>`;
    }).join('') : `<div class="empty">Aucun objectif pour le moment.</div>`;
  }
}

/* ============ DETTES ============ */
document.getElementById('newDebtForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('dName').value.trim();
  const creancier = document.getElementById('dCreancier').value.trim();
  const initial = Number(document.getElementById('dInitial').value);
  const restant = Number(document.getElementById('dRestant').value);
  const mensualite = Number(document.getElementById('dMensualite').value);
  const taux = document.getElementById('dTaux').value ? Number(document.getElementById('dTaux').value) : null;
  const dateDebut = document.getElementById('dDateDebut').value;
  const dateFin = document.getElementById('dDateFin').value;
  if(!name || !initial || initial<=0 || restant<0 || mensualite<0) return;
  DATA.debts.push({id: genId('debt'), name, creancier, initial, restant, mensualite, taux, dateDebut, dateFin});
  saveData();
  e.target.reset();
  renderAll();
  showToast('Dette ajoutée ✅');
});
function debtById(id){ return (DATA.debts||[]).find(d => d.id === id); }
function repayDebt(id){
  const d = debtById(id);
  if(!d) return;
  const accounts = DATA.accounts || [];
  if(!accounts.length){ alertModal('Aucun compte disponible.'); return; }
  openModal({
    title: `Rembourser "${d.name}"`,
    sub: `Restant dû : ${formatFCFA(d.restant)}`,
    submitLabel: 'Enregistrer',
    fields: [
      {id:'amount', label:'Montant du remboursement (FCFA)', type:'number', value:d.mensualite},
      {id:'account', label:'Compte utilisé', type:'select', value:accounts[0].id,
        options: accounts.map(a => ({value:a.id, label:`${accountTypeInfo(a.type).icon} ${a.name} (${formatFCFA(a.balance)})`}))},
    ],
    onSubmit(v){
      const amount = Number(v.amount);
      if(!amount || amount <= 0){ alertModal('Montant invalide.'); return; }
      const account = accountById(v.account);
      if(!account) return;
      account.balance -= amount;
      d.restant = Math.max(0, d.restant - amount);
      DATA.transactions.push({id: genId('txn'), type:'depense', amount, date: todayStr(), category:'dettes', subcategory:d.name, personId:'foyer', accountId:account.id, toAccountId:'', note:`Remboursement : ${d.name}`, recurringId:''});
      saveData();
      renderAll();
      if(d.restant <= 0) showToast(`🎉 Dette "${d.name}" totalement remboursée !`);
      else showToast('Remboursement enregistré ✅');
    }
  });
}
window.repayDebt = repayDebt;
function editDebt(id){
  const d = debtById(id);
  if(!d) return;
  openModal({
    title: 'Corriger le montant restant',
    submitLabel: 'Enregistrer',
    fields: [{id:'restant', label:'Montant restant (FCFA)', type:'number', value:d.restant}],
    onSubmit(v){
      const nr = Number(v.restant);
      if(!isNaN(nr) && nr>=0) d.restant = nr;
      saveData();
      renderAll();
      showToast('Dette mise à jour ✅');
    }
  });
}
window.editDebt = editDebt;
function deleteDebt(id){
  confirmModal('Supprimer cette dette de votre suivi ?', () => {
    DATA.debts = (DATA.debts||[]).filter(x => x.id !== id);
    saveData();
    renderAll();
  }, {title:'Supprimer cette dette', submitLabel:'Supprimer'});
}
window.deleteDebt = deleteDebt;
function renderDebts(){
  const el = document.getElementById('debtsList');
  const debts = (DATA.debts || []).slice().sort((a,b) => b.restant - a.restant);
  el.innerHTML = debts.length ? debts.map(d => {
    const pctPaid = d.initial > 0 ? Math.round(((d.initial-d.restant)/d.initial)*100) : 0;
    return `
      <div class="row-item" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;align-items:center;gap:12px;width:100%;">
          <div class="row-icon">💳</div>
          <div class="row-body">
            <div class="row-title">${escapeHtml(d.name)}${d.creancier?` <span class="row-sub" style="display:inline;">(${escapeHtml(d.creancier)})</span>`:''}</div>
            <div class="row-sub">Restant ${formatFCFA(d.restant)} / ${formatFCFA(d.initial)} · mensualité ${formatFCFA(d.mensualite)}${d.taux?` · ${d.taux}%`:''}</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn" title="Enregistrer un remboursement" onclick="repayDebt('${d.id}')">✔</button>
            <button class="icon-btn" title="Modifier" onclick="editDebt('${d.id}')">✎</button>
            <button class="icon-btn danger" title="Supprimer" onclick="deleteDebt('${d.id}')">🗑</button>
          </div>
        </div>
        <div class="progress-outer" style="width:100%;"><div class="progress-inner green" style="width:${pctPaid}%"></div></div>
        <div class="progress-label"><span>${pctPaid}% remboursé</span><span></span></div>
      </div>`;
  }).join('') : `<div class="empty">Aucune dette enregistrée.</div>`;
}

/* ============ PRÉVISIONS ============ */
let forecastMonth = currentMonthKey();
function shiftForecastMonth(n){
  forecastMonth = addMonthsToKey(forecastMonth, n);
  renderForecast();
}
window.shiftForecastMonth = shiftForecastMonth;
function upcomingRecurringFor(key, type){
  return (DATA.recurring||[]).filter(r => r.type === type && r.lastRecordedMonth !== key);
}
function unpaidBillsFor(key){
  return (DATA.bills||[]).filter(b => !b.paid && monthKeyOf(b.due) === key);
}
function renderForecast(){
  document.getElementById('forecastMonthLabel').textContent = monthLabel(forecastMonth);
  const soldeActuel = totalUsable();
  const revenus = upcomingRecurringFor(forecastMonth, 'revenu');
  const depensesRec = upcomingRecurringFor(forecastMonth, 'depense');
  const bills = unpaidBillsFor(forecastMonth);
  const totalRevenus = sumAmount(revenus);
  const totalDepenses = sumAmount(depensesRec) + sumAmount(bills);
  const soldePrevisionnel = soldeActuel + totalRevenus - totalDepenses;
  const lineHtml = (icon, label, amount, sign) => `
    <div class="row-item"><div class="row-icon">${icon}</div><div class="row-body"><div class="row-title">${escapeHtml(label)}</div></div><div class="row-amount ${sign==='+'?'pos':'neg'}">${sign}${formatFCFA(amount)}</div></div>`;
  let html = `<div class="stat-row"><div class="stat-box"><div class="label">Solde actuel (utilisable)</div><div class="value">${formatFCFA(soldeActuel)}</div></div>
    <div class="stat-box"><div class="label">Solde prévisionnel</div><div class="value ${soldePrevisionnel>=0?'pos':'neg'}">${formatFCFA(soldePrevisionnel)}</div></div></div>`;
  html += `<h2 style="margin-top:18px;">Revenus prévus</h2>`;
  html += revenus.length ? revenus.map(r => lineHtml(categoryInfo(r.category,'revenu').icon, r.label, r.amount, '+')).join('') : `<div class="empty">Aucun revenu récurrent prévu ce mois.</div>`;
  html += `<h2 style="margin-top:18px;">Dépenses prévues</h2>`;
  const depenseLines = [
    ...depensesRec.map(r => lineHtml(categoryInfo(r.category,'depense').icon, r.label, r.amount, '-')),
    ...bills.map(b => lineHtml('🧾', b.name, b.amount, '-')),
  ];
  html += depenseLines.length ? depenseLines.join('') : `<div class="empty">Aucune dépense prévue ce mois.</div>`;
  document.getElementById('forecastDetail').innerHTML = html;
}

/* ============ CALENDRIER ============ */
let calMonth = currentMonthKey();
let selectedCalDate = null;
function shiftCalMonth(n){
  calMonth = addMonthsToKey(calMonth, n);
  renderCalendar();
}
window.shiftCalMonth = shiftCalMonth;
function itemsByDateForMonth(key){
  const map = {};
  const push = (date, item) => { (map[date] = map[date] || []).push(item); };
  (DATA.transactions||[]).filter(t => monthKeyOf(t.date) === key).forEach(t => {
    if(t.type === 'revenu') push(t.date, {label: categoryInfo(t.category,'revenu').label, amount:t.amount, cls:'pos', sign:'+'});
    else if(t.type === 'depense') push(t.date, {label: t.subcategory || categoryInfo(t.category,'depense').label, amount:t.amount, cls:'neg', sign:'-'});
    else if(t.type === 'transfert') push(t.date, {label:'Transfert', amount:t.amount, cls:'pending', sign:'↔'});
  });
  upcomingRecurringFor(key, 'revenu').forEach(r => push(dateForDayInMonth(key, r.day), {label:r.label+' (prévu)', amount:r.amount, cls:'pending', sign:'+'}));
  upcomingRecurringFor(key, 'depense').forEach(r => push(dateForDayInMonth(key, r.day), {label:r.label+' (prévu)', amount:r.amount, cls:'pending', sign:'-'}));
  unpaidBillsFor(key).forEach(b => push(b.due, {label:b.name+' (facture)', amount:b.amount, cls:'pending', sign:'-'}));
  return map;
}
function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = monthLabel(calMonth);
  const map = itemsByDateForMonth(calMonth);
  const [year, month] = calMonth.split('-').map(Number);
  const firstDay = new Date(year, month-1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = daysInMonthOf(calMonth);
  const prevMonthDays = new Date(year, month-1, 0).getDate();
  const todayIso = todayStr();
  let cells = [];
  for(let i = startOffset - 1; i >= 0; i--) cells.push({day: prevMonthDays - i, outside:true, dateStr:null});
  for(let d = 1; d <= daysInMonth; d++) cells.push({day:d, outside:false, dateStr: dateForDayInMonth(calMonth, d)});
  while(cells.length % 7 !== 0) cells.push({day:'', outside:true, dateStr:null});
  const el = document.getElementById('calGrid');
  el.innerHTML = cells.map(c => {
    if(c.outside) return `<div class="cal-day outside"><div class="num">${c.day}</div></div>`;
    const items = map[c.dateStr] || [];
    const isToday = c.dateStr === todayIso;
    const pills = items.slice(0,3).map(it => `<span class="cal-pill ${it.cls}">${it.sign}${formatFCFA(it.amount)}</span>`).join('');
    const more = items.length > 3 ? `<span class="cal-pill more">+${items.length-3}</span>` : '';
    return `<div class="cal-day ${isToday?'today':''} ${items.length?'has-items':''}" onclick="showCalDay('${c.dateStr}')"><div class="num">${c.day}</div>${pills}${more}</div>`;
  }).join('');
  if(selectedCalDate) showCalDay(selectedCalDate);
}
function showCalDay(dateStr){
  selectedCalDate = dateStr;
  const map = itemsByDateForMonth(calMonth);
  const items = map[dateStr] || [];
  const card = document.getElementById('calDayCard');
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('calDayTitle').textContent = d.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  document.getElementById('calDayItems').innerHTML = items.length ? items.map(it => `
    <div class="row-item"><div class="row-body"><div class="row-title">${escapeHtml(it.label)}</div></div><div class="row-amount ${it.cls==='pos'?'pos':(it.cls==='neg'?'neg':'')}">${it.sign}${formatFCFA(it.amount)}</div></div>
  `).join('') : `<div class="empty">Rien ce jour-là.</div>`;
  card.style.display = 'block';
}
window.showCalDay = showCalDay;

/* ============ RAPPORTS ============ */
let reportMonth = currentMonthKey();
function shiftReportMonth(n){
  reportMonth = addMonthsToKey(reportMonth, n);
  renderReports();
}
window.shiftReportMonth = shiftReportMonth;
document.getElementById('reportComparisonCategory').addEventListener('change', renderReportComparison);
function renderReports(){
  document.getElementById('reportMonthLabel').textContent = monthLabel(reportMonth);
  const revenus = sumAmount((DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===reportMonth));
  const depenses = sumAmount(expensesForMonth(reportMonth));
  const epargneAjout = sumAmount((DATA.transactions||[]).filter(t => t.type==='epargne_ajout' && monthKeyOf(t.date)===reportMonth));
  const epargneRetrait = sumAmount((DATA.transactions||[]).filter(t => t.type==='epargne_retrait' && monthKeyOf(t.date)===reportMonth));
  const epargne = epargneAjout - epargneRetrait;
  const reste = revenus - depenses - epargne;
  document.getElementById('reportRevenus').textContent = formatFCFA(revenus);
  document.getElementById('reportDepenses').textContent = formatFCFA(depenses);
  document.getElementById('reportEpargne').textContent = formatFCFA(epargne);
  document.getElementById('reportReste').textContent = formatFCFA(reste);
  const byCat = {};
  expensesForMonth(reportMonth).forEach(t => { byCat[t.category] = (byCat[t.category]||0) + t.amount; });
  const entries = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const el = document.getElementById('reportRepartition');
  el.innerHTML = entries.length ? entries.map(([cat, amount]) => {
    const info = categoryInfo(cat, 'depense');
    const pct = depenses > 0 ? Math.round((amount/depenses)*100) : 0;
    return `<div class="repart-row"><span class="repart-name">${info.icon} ${escapeHtml(info.label)}</span><div class="repart-bar-outer"><div class="repart-bar-inner" style="width:${pct}%"></div></div><span class="repart-pct">${pct}%</span></div>`;
  }).join('') : `<div class="empty">Aucune dépense ce mois-ci.</div>`;
  renderReportComparison();
}
function renderReportComparison(){
  const cat = document.getElementById('reportComparisonCategory').value;
  if(!cat) return;
  const months = [5,4,3,2,1,0].map(n => addMonthsToKey(reportMonth, -n));
  const totals = months.map(k => sumAmount(expensesForMonth(k, cat)));
  const rows = months.map((k,i) => {
    let change = '';
    if(i > 0 && totals[i-1] > 0){
      const pct = Math.round(((totals[i]-totals[i-1])/totals[i-1])*100);
      change = ` <span class="tag ${pct>0?'red':'green'}">${pct>0?'+':''}${pct}%</span>`;
    }
    return `<div class="budget-block"><div class="budget-block-top"><span class="name">${monthLabel(k)}</span><span class="nums">${formatFCFA(totals[i])}${change}</span></div></div>`;
  }).join('');
  document.getElementById('reportComparisonTable').innerHTML = rows;
}

/* ============ EXPORT PDF ============
   Génère un PDF du mois affiché dans Rapports (revenus et dépenses séparés,
   avec totaux) via jsPDF + jsPDF-AutoTable, chargés en CDN dans index.html.
   Un formateur de nombres dédié évite l'espace insécable "fine" que produit
   Intl.NumberFormat('fr-FR') — mal supporté par les polices PDF standard. */
function formatFCFAPdf(n){
  const v = Math.round(Number(n) || 0);
  const neg = v < 0;
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '-' : '') + s + ' FCFA';
}
function exportReportPDF(){
  if(!window.jspdf || !window.jspdf.jsPDF){
    alertModal('Le générateur de PDF est en cours de chargement, réessayez dans un instant.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const key = reportMonth;
  const revenusTxns = (DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===key).sort((a,b)=>a.date.localeCompare(b.date));
  const depensesTxns = expensesForMonth(key).sort((a,b)=>a.date.localeCompare(b.date));
  const totalRevenus = sumAmount(revenusTxns);
  const totalDepenses = sumAmount(depensesTxns);

  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  doc.text('MA FAMILLE — Rapport mensuel', 14, 18);
  doc.setFont('helvetica','normal');
  doc.setFontSize(11);
  doc.text(`Foyer : ${DATA.foyer.nom || '-'}`, 14, 26);
  doc.text(`Période : ${monthLabel(key)}`, 14, 32);
  doc.text(`Généré le ${formatDateLong(todayStr())}`, 14, 38);

  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text(`Revenus — total ${formatFCFAPdf(totalRevenus)}`, 14, 50);
  doc.autoTable({
    startY: 54,
    head: [['Date','Catégorie','Personne','Compte','Montant']],
    body: revenusTxns.length ? revenusTxns.map(t => [
      t.date,
      categoryInfo(t.category,'revenu').label,
      personLabel(t.personId||'foyer'),
      accountById(t.accountId) ? accountById(t.accountId).name : '-',
      formatFCFAPdf(t.amount),
    ]) : [['—','Aucun revenu ce mois','','','']],
    styles:{fontSize:9},
    headStyles:{fillColor:[193,89,46]},
    margin:{left:14,right:14},
  });

  let y2 = doc.lastAutoTable.finalY + 12;
  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text(`Dépenses — total ${formatFCFAPdf(totalDepenses)}`, 14, y2);
  doc.autoTable({
    startY: y2 + 4,
    head: [['Date','Catégorie','Personne','Compte','Montant']],
    body: depensesTxns.length ? depensesTxns.map(t => [
      t.date,
      categoryInfo(t.category,'depense').label + (t.subcategory ? ` (${t.subcategory})` : ''),
      personLabel(t.personId||'foyer'),
      accountById(t.accountId) ? accountById(t.accountId).name : '-',
      formatFCFAPdf(t.amount),
    ]) : [['—','Aucune dépense ce mois','','','']],
    styles:{fontSize:9},
    headStyles:{fillColor:[209,72,63]},
    margin:{left:14,right:14},
  });

  const y3 = doc.lastAutoTable.finalY + 14;
  doc.setFont('helvetica','bold');
  doc.setFontSize(12);
  doc.text(`Solde du mois : ${formatFCFAPdf(totalRevenus - totalDepenses)}`, 14, y3);

  doc.save(`ma-famille-rapport-${key}.pdf`);
}
window.exportReportPDF = exportReportPDF;

/* ============ EXPORT CSV ============
   Même contenu que le PDF (revenus + dépenses du mois affiché dans Rapports),
   au format CSV pour ouverture directe dans Excel ou tout tableur. Séparateur
   point-virgule et BOM UTF-8 : ce sont les réglages attendus par défaut par
   Excel en français (sinon les accents et les colonnes s'affichent mal). */
function csvEscape(val){
  const s = String(val === undefined || val === null ? '' : val);
  if(/["\n;]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function exportReportCSV(){
  const key = reportMonth;
  const revenusTxns = (DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===key).sort((a,b)=>a.date.localeCompare(b.date));
  const depensesTxns = expensesForMonth(key).sort((a,b)=>a.date.localeCompare(b.date));
  const rows = [['Type','Date','Catégorie','Personne','Compte','Montant (FCFA)']];
  revenusTxns.forEach(t => rows.push(['Revenu', t.date, categoryInfo(t.category,'revenu').label, personLabel(t.personId||'foyer'), accountById(t.accountId)?accountById(t.accountId).name:'-', Math.round(t.amount)]));
  depensesTxns.forEach(t => rows.push(['Dépense', t.date, categoryInfo(t.category,'depense').label + (t.subcategory?` (${t.subcategory})`:''), personLabel(t.personId||'foyer'), accountById(t.accountId)?accountById(t.accountId).name:'-', -Math.round(t.amount)]));
  const csv = '\uFEFF' + rows.map(r => r.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ma-famille-rapport-${key}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.exportReportCSV = exportReportCSV;

/* ============ PARAMÈTRES ============ */
function renderSettings(){
  const soi = soiPersonne() || {prenom:'', nom:'', telephone:''};
  document.getElementById('settingsProfile').innerHTML = `
    <div class="settings-row"><div><div class="label">${escapeHtml(soi.prenom)} ${escapeHtml(soi.nom||'')}</div></div></div>
    <div class="settings-row"><div><div class="label">Téléphone</div><div class="desc">${escapeHtml(soi.telephone) || 'Non renseigné'}</div></div></div>
    <div class="settings-row"><div><div class="label">Foyer</div><div class="desc">${escapeHtml(DATA.foyer.nom)}</div></div></div>`;
  const accEl = document.getElementById('settingsAccount');
  if(accEl){
    const email = (auth.currentUser && auth.currentUser.email) || '—';
    accEl.innerHTML = `<div class="settings-row"><div><div class="label">Adresse de connexion</div><div class="desc">${escapeHtml(email)}</div></div></div>`;
  }
  const el = document.getElementById('settingsCategoriesList');
  const customCats = DATA.categories || [];
  el.innerHTML = customCats.length ? customCats.map(c => `
    <div class="row-item"><div class="row-icon">🏷️</div><div class="row-body"><div class="row-title">${escapeHtml(c.label)}</div><div class="row-sub">${c.type==='revenu'?'Revenu':'Dépense'}${c.type==='depense' ? ' · '+(c.nature==='fixe'?'Fixe':'Variable') : ''}</div></div>
    <div class="row-actions"><button class="icon-btn danger" title="Supprimer" onclick="deleteCategory('${c.id}')">🗑</button></div></div>
  `).join('') : `<div class="empty">Aucune catégorie personnalisée.</div>`;
}
function editProfile(){
  const soi = soiPersonne();
  if(!soi){ alertModal('Aucun profil trouvé.'); return; }
  openModal({
    title: 'Modifier mon profil',
    submitLabel: 'Enregistrer',
    fields: [
      {id:'prenom', label:'Prénom', type:'text', value:soi.prenom},
      {id:'nom', label:'Nom', type:'text', value:soi.nom||''},
      {id:'telephone', label:'Téléphone', type:'tel', value:soi.telephone||''},
    ],
    onSubmit(v){
      soi.prenom = v.prenom.trim();
      soi.nom = v.nom.trim();
      soi.telephone = v.telephone.trim();
      saveData();
      renderSettings();
      renderDashboard();
      showToast('Profil mis à jour ✅');
    }
  });
}
window.editProfile = editProfile;
/* Le champ "Nature" (fixe/variable) n'a de sens que pour une catégorie de
   dépense — il se masque automatiquement pour une catégorie de revenu. */
function updateCatNatureVisibility(){
  const typeEl = document.getElementById('catType');
  const natureEl = document.getElementById('catNature');
  if(!typeEl || !natureEl) return;
  natureEl.style.display = typeEl.value === 'depense' ? '' : 'none';
}
document.getElementById('catType').addEventListener('change', updateCatNatureVisibility);
updateCatNatureVisibility();
document.getElementById('newCategoryForm').addEventListener('submit', e => {
  e.preventDefault();
  const label = document.getElementById('catLabel').value.trim();
  const type = document.getElementById('catType').value;
  const nature = document.getElementById('catNature').value;
  if(!label) return;
  const id = 'custom_' + label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if((DATA.categories||[]).some(c => c.id === id)){ alertModal('Cette catégorie existe déjà.'); return; }
  const cat = {id, label, type, custom:true};
  if(type === 'depense') cat.nature = nature;
  DATA.categories.push(cat);
  saveData();
  e.target.reset();
  updateCatNatureVisibility();
  renderAll();
  renderSettings();
  showToast('Catégorie ajoutée ✅');
});
function deleteCategory(id){
  confirmModal('Supprimer cette catégorie personnalisée ? Les mouvements déjà enregistrés avec elle resteront inchangés.', () => {
    DATA.categories = (DATA.categories||[]).filter(c => c.id !== id);
    saveData();
    renderAll();
    renderSettings();
  }, {title:'Supprimer cette catégorie', submitLabel:'Supprimer'});
}
window.deleteCategory = deleteCategory;
function exportData(){
  const backup = Object.assign({exportedAt: new Date().toISOString()}, DATA);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ma-famille-sauvegarde-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
window.exportData = exportData;
function importData(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let parsed;
    try{ parsed = JSON.parse(e.target.result); }
    catch(err){ alertModal('Fichier invalide : ce n\'est pas un JSON lisible.'); return; }
    if(!parsed.accounts || !parsed.transactions){ alertModal('Fichier invalide : structure inattendue.'); return; }
    confirmModal('Remplacer TOUTES les données actuelles par cette sauvegarde ? Cette action est irréversible.', () => {
      delete parsed.exportedAt;
      parsed = migrateLegacyIfNeeded(parsed);
      DATA = Object.assign(defaultFoyerData(), parsed);
      if(!Array.isArray(DATA.personnes)) DATA.personnes = [];
      saveData();
      renderAll();
      showToast('Sauvegarde restaurée ✅');
    }, {title:'Restaurer la sauvegarde', submitLabel:'Remplacer'});
  };
  reader.readAsText(file);
  document.getElementById('importFile').value = '';
}
window.importData = importData;

/* ============ TABLEAU DE BORD ============
   Compare ce qui est reçu ce mois-ci à ce qui est réellement dépensé —
   complète les alertes par catégorie (budgetAlerts) avec une vue d'ensemble,
   comme demandé pour la nouvelle carte "Alertes budget" du tableau de bord. */
function revenueVsExpenseAlert(){
  const key = currentMonthKey();
  const rev = sumAmount((DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===key));
  const dep = sumAmount(expensesForMonth(key));
  if(!rev && !dep) return null;
  if(dep > rev){
    return {level:'red', text:`Vous avez dépensé ${formatFCFA(dep)} ce mois-ci pour ${formatFCFA(rev)} reçus — soit ${formatFCFA(dep-rev)} de plus que vos revenus.`};
  }
  if(rev > 0 && dep >= rev * 0.9){
    return {level:'orange', text:`Vous avez déjà dépensé ${Math.round((dep/rev)*100)}% de vos revenus de ce mois (${formatFCFA(dep)} / ${formatFCFA(rev)}).`};
  }
  return null;
}
function renderDashboard(){
  const key = currentMonthKey();
  const soi = soiPersonne();
  document.getElementById('dashFoyerTitle').textContent = `Bon retour${soi && soi.prenom ? ', '+soi.prenom : ''}`;
  const activeCount = activePersonnes().length;
  document.getElementById('dashSub').textContent = activeCount <= 1 ? 'Vous gérez ce foyer en solo.' : `Foyer de ${activeCount} personnes.`;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  const usable = totalUsable();
  document.getElementById('dashTotalDisponible').textContent = formatFCFA(usable);
  const goals = DATA.savingsGoals || [];
  document.getElementById('dashEpargneTotale').textContent = formatFCFA(totalReserved());
  document.getElementById('dashEpargneSub').textContent = goals.length ? `${goals.length} objectif${goals.length>1?'s':''} d'épargne` : 'Aucun objectif pour le moment';
  const revMonth = sumAmount((DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===key));
  const monthExpenses = expensesForMonth(key);
  const depFixeMonth = sumAmount(monthExpenses.filter(t => categoryNature(t.category) === 'fixe'));
  const depVarMonth = sumAmount(monthExpenses.filter(t => categoryNature(t.category) !== 'fixe'));
  document.getElementById('dashRevenusMonth').textContent = formatFCFA(revMonth);
  document.getElementById('dashDepenseFixeMonth').textContent = formatFCFA(depFixeMonth);
  document.getElementById('dashDepenseVariableMonth').textContent = formatFCFA(depVarMonth);
  const nextKey = addMonthsToKey(key, 1);
  const upcoming30 = [
    ...unpaidBillsFor(key).filter(b => daysUntil(b.due) <= 30 && daysUntil(b.due) >= 0),
    ...unpaidBillsFor(nextKey).filter(b => daysUntil(b.due) <= 30 && daysUntil(b.due) >= 0),
  ];
  // Prochaine occurrence de chaque récurrence-dépense non encore enregistrée : si la date de ce
  // mois est déjà passée, on regarde l'occurrence du mois suivant (une récurrence est perpétuelle,
  // elle ne s'arrête pas à la fin du mois en cours).
  const upcomingRecItems = (DATA.recurring||[]).filter(r => r.type === 'depense').map(r => {
    let date = r.lastRecordedMonth !== key ? dateForDayInMonth(key, r.day) : null;
    if(!date || daysUntil(date) < 0) date = dateForDayInMonth(nextKey, r.day);
    return {label:r.label, amount:r.amount, date};
  }).filter(it => daysUntil(it.date) >= 0 && daysUntil(it.date) <= 30);
  const upcomingRecAmount = sumAmount(upcomingRecItems);
  const upcomingBillsAmount = sumAmount(upcoming30);
  const reelDisponible = usable - upcomingRecAmount - upcomingBillsAmount;
  const reelEl = document.getElementById('dashReelDisponible');
  reelEl.textContent = formatFCFA(reelDisponible);
  reelEl.className = 'value ' + (reelDisponible >= 0 ? 'pos' : 'neg');
  const budgets = Object.entries(DATA.budgets||{});
  const totalBudget = budgets.reduce((s,[,v]) => s+v, 0);
  const totalSpentBudgeted = budgets.reduce((s,[cat]) => s + sumAmount(expensesForMonth(key,cat)), 0);
  const pctGlobal = totalBudget > 0 ? Math.min(100, Math.round((totalSpentBudgeted/totalBudget)*100)) : 0;
  document.getElementById('dashBudgetGlobalBar').style.width = pctGlobal + '%';
  document.getElementById('dashBudgetGlobalBar').className = 'progress-inner ' + budgetBarClass(pctGlobal, DATA.thresholds);
  document.getElementById('dashBudgetGlobalLabel').innerHTML = `<span>${pctGlobal}% réellement dépensé</span>`;
  document.getElementById('dashBudgetPrevu').textContent = formatFCFA(totalBudget);
  document.getElementById('dashBudgetReel').textContent = formatFCFA(totalSpentBudgeted);
  const upcomingItems = [
    ...upcoming30.map(b => ({label:b.name, amount:b.amount, date:b.due})),
    ...upcomingRecItems,
  ].sort((a,b) => a.date.localeCompare(b.date));
  document.getElementById('dashUpcomingList').innerHTML = upcomingItems.length ? upcomingItems.slice(0,6).map(it => `
    <div class="row-item"><div class="row-icon">📅</div><div class="row-body"><div class="row-title">${escapeHtml(it.label)}${relativeDatePill(it.date)}</div><div class="row-sub">${new Date(it.date+'T00:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</div></div><div class="row-amount neg">${formatFCFA(it.amount)}</div></div>
  `).join('') : `<div class="empty">Rien de prévu dans les prochains jours 👌</div>`;
  const accEl = document.getElementById('dashAccountsList');
  accEl.innerHTML = (DATA.accounts||[]).slice().sort((a,b) => a.name.localeCompare(b.name,'fr')).map(a => {
    const t = accountTypeInfo(a.type);
    return `<div class="row-item"><div class="row-icon">${t.icon}</div><div class="row-body"><div class="row-title">${escapeHtml(a.name)}</div></div><div class="row-amount">${formatFCFA(a.balance)}</div></div>`;
  }).join('') || `<div class="empty">Aucun compte pour le moment.</div>`;
  const revExpAlert = revenueVsExpenseAlert();
  const alerts = (revExpAlert ? [revExpAlert] : []).concat(budgetAlerts());
  document.getElementById('dashBudgetAlerts').innerHTML = alerts.length ? alerts.map(a => `<div class="alert ${a.level}"><span>${a.level==='red'?'🔴':(a.level==='orange'?'🟠':'🔵')}</span><div><p>${escapeHtml(a.text)}</p></div></div>`).join('') : `<div class="alert green"><span>🟢</span><div><b>Tout va bien</b><p>Vous dépensez moins que vous ne recevez, et aucun budget n'approche sa limite.</p></div></div>`;
}

/* ============ INIT ============
   Rien à appeler ici : auth.onAuthStateChanged() ci-dessus s'enregistre dès
   l'exécution du script et déclenche automatiquement l'écran adapté
   (connexion, questionnaire, ou application) selon l'état de la session. */
