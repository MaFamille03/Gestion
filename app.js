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
const db = firebase.firestore();
/* Sur certains réseaux/opérateurs, la connexion "streaming" que Firestore essaie
   en premier échoue silencieusement puis rebascule sur du "long polling" après
   un long délai (c'est exactement ce qui cause un premier chargement très lent,
   ~20-30s, alors que tout le reste du site est instantané). Cette option force
   la détection immédiate du bon mode de connexion au lieu d'attendre l'échec. */
db.settings({ experimentalAutoDetectLongPolling: true });
/* Pas de connexion : toutes les données vivent dans UN SEUL document fixe.
   Cet identifiant doit correspondre exactement à celui utilisé dans la règle
   Firestore (Console > Firestore Database > Règles). */
const FOYER_DOC_ID = 'DsNWFrLX3QgaYNtLIjiXRnb8C8y1';
const DOC_REF = db.collection('foyers').doc(FOYER_DOC_ID);

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
const EXPENSE_CATEGORIES = [
  {id:'maison', label:'Maison', icon:'🏠'},
  {id:'alimentation', label:'Alimentation', icon:'🍚'},
  {id:'personnel', label:'Dépense personnelle', icon:'👤'},
  {id:'transport', label:'Transport', icon:'🚗'},
  {id:'sante', label:'Santé', icon:'🏥'},
  {id:'education', label:'Éducation', icon:'🎓'},
  {id:'loisirs', label:'Loisirs', icon:'🎉'},
  {id:'dettes', label:'Dettes', icon:'💳'},
  {id:'autre', label:'Autre', icon:'📦'},
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

/* ============ MODÈLE DE DONNÉES « FOYER DYNAMIQUE » ============
   Un seul document Firestore : collection 'foyers', id fixe = FOYER_DOC_ID.
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
  setSyncBadge('saving');
  DOC_REF.set(DATA).then(() => setSyncBadge('ok')).catch(err => {
    console.error('Erreur de sauvegarde Firestore :', err);
    setSyncBadge('err');
    alert('La sauvegarde a échoué. Vérifiez votre connexion internet et réessayez. (Détail dans la console F12)');
  });
}

/* ============ ÉCRANS ============ */
function hideAllGateScreens(){
  ['loadingScreen','setupScreen','appRoot'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
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

/* ============ SYNCHRONISATION ============
   Pas d'authentification : l'application se connecte directement au document
   fixe FOYER_DOC_ID dès le chargement de la page. L'accès aux données repose
   uniquement sur la confidentialité du lien du site — voir la carte "Accès"
   dans Paramètres. */
function startSync(){
  DOC_REF.onSnapshot(snap => {
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
}

/* ============ NAVIGATION ============
   5 onglets principaux ; tout le reste vit derrière l'onglet "Plus" (menu en
   grille) pour ne pas surcharger l'interface quelle que soit la taille du foyer. */
const MAIN_VIEWS = ['dashboard','accounts','transactions','budget','plus'];
const PLUS_CHILDREN = ['bills','savings','debts','foyer','forecast','calendar','reports','settings'];
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
  renderRecurring();
  renderTransactions();
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
  const txnCat = document.getElementById('txnFilterCategory');
  if(txnCat){
    const prev = txnCat.value;
    const all = allExpenseCategories().concat(allIncomeCategories());
    const seen = new Set();
    const opts = ['<option value="">Toutes catégories</option>'];
    all.forEach(c => {
      if(seen.has(c.id)) return;
      seen.add(c.id);
      opts.push(`<option value="${c.id}">${c.icon} ${escapeHtml(c.label)}</option>`);
    });
    txnCat.innerHTML = opts.join('');
    txnCat.value = prev;
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
  const wrap = document.getElementById('addPersonFormWrap');
  wrap.style.display = 'block';
  wrap.innerHTML = `
    <div class="person-form-card">
      <div class="pf-head"><span class="pf-badge">＋</span> Nouvelle personne</div>
      <div class="form-grid" style="background:transparent;border:none;padding:0;">
        <div class="field-group"><label class="field-label">Prénom</label><input type="text" id="apPrenom" required></div>
        <div class="field-group"><label class="field-label">Lien avec vous</label>
          <select id="apRelation">${RELATIONS.filter(r=>r.id!=='soi').map(r=>`<option value="${r.id}">${r.icon} ${r.label}</option>`).join('')}</select>
        </div>
        <div class="field-group"><label class="field-label">Date de naissance (facultatif)</label><input type="date" id="apNaissance"></div>
      </div>
      <label class="role-filter-toggle"><input type="checkbox" id="apACharge"><span>À charge financièrement</span></label>
      <label class="role-filter-toggle"><input type="checkbox" id="apContribution"><span>Contribue aux revenus du foyer</span></label>
      <div class="setup-grid" id="apAideFields" style="display:none;grid-column:1/-1;margin-top:8px;">
        <div class="field-group"><label class="field-label">Rôle</label><input type="text" id="apRole" placeholder="Ex. Aide ménagère"></div>
        <div class="field-group"><label class="field-label">Fréquence</label><input type="text" id="apFrequence" placeholder="Ex. Tous les jours"></div>
        <div class="field-group"><label class="field-label">Rémunération (FCFA)</label><input type="number" id="apRemuneration" min="0"></div>
        <div class="field-group"><label class="field-label">Transport (FCFA)</label><input type="number" id="apTransport" min="0"></div>
        <div class="field-group"><label class="field-label">Autres frais (FCFA)</label><input type="number" id="apAutres" min="0"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;">
        <button type="button" class="cta-inline" onclick="submitAddPerson()">Ajouter</button>
        <button type="button" class="icon-btn wide" onclick="cancelAddPerson()">Annuler</button>
      </div>
    </div>`;
  document.getElementById('apRelation').addEventListener('change', function(){
    document.getElementById('apAideFields').style.display = this.value === 'aide_domestique' ? 'grid' : 'none';
  });
}
window.openAddPerson = openAddPerson;
function cancelAddPerson(){
  const wrap = document.getElementById('addPersonFormWrap');
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}
window.cancelAddPerson = cancelAddPerson;
function submitAddPerson(){
  const prenom = document.getElementById('apPrenom').value.trim();
  if(!prenom){ alert('Le prénom est obligatoire.'); return; }
  const relation = document.getElementById('apRelation').value;
  const isAide = relation === 'aide_domestique';
  const p = {
    id: genId('p'), prenom, nom:'', relation,
    dateNaissance: document.getElementById('apNaissance').value,
    telephone:'',
    aCharge: document.getElementById('apACharge').checked,
    contribution: document.getElementById('apContribution').checked,
    role: isAide ? document.getElementById('apRole').value.trim() : '',
    frequence: isAide ? document.getElementById('apFrequence').value.trim() : '',
    remuneration: isAide ? (Number(document.getElementById('apRemuneration').value)||0) : 0,
    transport: isAide ? (Number(document.getElementById('apTransport').value)||0) : 0,
    autres: isAide ? (Number(document.getElementById('apAutres').value)||0) : 0,
    presente: true, dateArrivee: todayStr(), dateDepart: null,
  };
  DATA.personnes.push(p);
  saveData();
  cancelAddPerson();
  renderAll();
  renderFoyer();
  showToast(`${prenom} a rejoint le foyer ✅`);
}
window.submitAddPerson = submitAddPerson;
function editPerson(id){
  const p = personById(id);
  if(!p) return;
  const newPrenom = prompt('Prénom :', p.prenom);
  if(newPrenom === null) return;
  if(newPrenom.trim()) p.prenom = newPrenom.trim();
  const newNaissance = prompt('Date de naissance (AAAA-MM-JJ, laisser vide si inconnue) :', p.dateNaissance || '');
  if(newNaissance !== null) p.dateNaissance = newNaissance.trim();
  if(p.relation !== 'soi'){
    p.aCharge = confirm(`"${p.prenom}" est-elle/il à charge financièrement du foyer ?\nOK = oui, Annuler = non.`);
    p.contribution = confirm(`"${p.prenom}" contribue-t-elle/il aux revenus du foyer ?\nOK = oui, Annuler = non.`);
  }
  if(p.relation === 'aide_domestique'){
    const newRem = prompt('Rémunération mensuelle (FCFA) :', p.remuneration||0);
    if(newRem !== null) p.remuneration = Number(newRem) || 0;
    const newTr = prompt('Transport (FCFA) :', p.transport||0);
    if(newTr !== null) p.transport = Number(newTr) || 0;
    const newAu = prompt('Autres frais (FCFA) :', p.autres||0);
    if(newAu !== null) p.autres = Number(newAu) || 0;
  }
  saveData();
  renderFoyer();
  renderDashboard();
  showToast('Personne mise à jour ✅');
}
window.editPerson = editPerson;
function deactivatePerson(id){
  const p = personById(id);
  if(!p) return;
  if(p.relation === 'soi'){ alert('Vous ne pouvez pas vous retirer vous-même du foyer.'); return; }
  if(!confirm(`Faire partir "${p.prenom}" du foyer ? Son historique financier (transactions passées) sera entièrement conservé — cette action est réversible depuis "Personnes parties du foyer".`)) return;
  p.presente = false;
  p.dateDepart = todayStr();
  saveData();
  renderAll();
  renderFoyer();
  showToast(`${p.prenom} est marqué(e) comme parti(e) du foyer.`);
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
  fillAccountSelect(document.getElementById('trFrom'), true, false);
  fillAccountSelect(document.getElementById('trTo'), true, false);
  fillAccountSelect(document.getElementById('inAccount'), true, false);
  fillAccountSelect(document.getElementById('exAccount'), true, false);
  fillAccountSelect(document.getElementById('blAccount'), true, true);
}
function renderAccounts(){
  document.getElementById('acctTotalAll').textContent = formatFCFA(totalAllAccounts());
  document.getElementById('acctTotalReserved').textContent = formatFCFA(totalReserved());
  document.getElementById('acctTotalUsable').textContent = formatFCFA(totalUsable());
  const el = document.getElementById('accountsList');
  const accounts = DATA.accounts || [];
  el.innerHTML = accounts.length ? accounts.map(a => {
    const t = accountTypeInfo(a.type);
    return `
      <div class="row-item">
        <div class="row-icon">${t.icon}</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(a.name)}</div>
          <div class="row-sub">${t.label}</div>
        </div>
        <div class="row-amount">${formatFCFA(a.balance)}</div>
        <div class="row-actions">
          <button class="icon-btn" title="Modifier" onclick="editAccount('${a.id}')">✎</button>
          <button class="icon-btn danger" title="Supprimer" onclick="deleteAccount('${a.id}')">🗑</button>
        </div>
      </div>`;
  }).join('') : `<div class="empty">Aucun moyen financier pour l'instant.</div>`;
}
document.getElementById('newAccountForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('naName').value.trim();
  const type = document.getElementById('naType').value;
  const balance = Number(document.getElementById('naBalance').value) || 0;
  if(!name) return;
  DATA.accounts.push({id: genId('acc'), name, type, balance});
  saveData();
  e.target.reset();
  document.getElementById('naBalance').value = 0;
  renderAll();
  showToast('Compte ajouté ✅');
});
function editAccount(id){
  const a = accountById(id);
  if(!a) return;
  const newName = prompt('Nom du compte :', a.name);
  if(newName === null) return;
  const newBalance = prompt('Corriger le solde actuel (FCFA) — à utiliser seulement pour un ajustement, pas pour une dépense/un revenu :', a.balance);
  if(newBalance === null) return;
  if(newName.trim()) a.name = newName.trim();
  const nb = Number(newBalance);
  if(!isNaN(nb)) a.balance = nb;
  saveData();
  renderAll();
}
window.editAccount = editAccount;
function deleteAccount(id){
  const a = accountById(id);
  if(!a) return;
  if((DATA.accounts||[]).length <= 1){
    alert('Impossible de supprimer le dernier moyen financier restant.');
    return;
  }
  if(!confirm(`Supprimer "${a.name}" ? Son solde (${formatFCFA(a.balance)}) sera perdu de votre total. Cette action est irréversible.`)) return;
  DATA.accounts = DATA.accounts.filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteAccount = deleteAccount;
document.getElementById('transferForm').addEventListener('submit', e => {
  e.preventDefault();
  const fromId = document.getElementById('trFrom').value;
  const toId = document.getElementById('trTo').value;
  const amount = Number(document.getElementById('trAmount').value);
  const note = document.getElementById('trNote').value.trim();
  if(!fromId || !toId || fromId === toId || !amount || amount <= 0) {
    alert('Choisissez deux comptes différents et un montant valide.');
    return;
  }
  const from = accountById(fromId), to = accountById(toId);
  if(!from || !to) return;
  from.balance -= amount;
  to.balance += amount;
  DATA.transactions.push({
    id: genId('txn'), type:'transfert', amount, date: todayStr(),
    accountId: fromId, toAccountId: toId, note, category:'', subcategory:'', personId:'foyer'
  });
  saveData();
  e.target.reset();
  renderAll();
  showToast(`Transfert effectué : ${from.name} → ${to.name}`);
});

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
  if(!amount || amount <= 0 || !date || !accountId){ alert('Vérifiez le montant, la date et le compte.'); return; }
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
  if(!amount || amount <= 0 || !date || !accountId){ alert('Vérifiez le montant, la date et le compte.'); return; }
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
  if(!confirm('Supprimer ce mouvement ? Le solde du compte concerné sera réajusté.')) return;
  if(t.type === 'revenu'){
    const a = accountById(t.accountId); if(a) a.balance -= t.amount;
  } else if(t.type === 'depense'){
    const a = accountById(t.accountId); if(a) a.balance += t.amount;
  } else if(t.type === 'transfert'){
    const from = accountById(t.accountId), to = accountById(t.toAccountId);
    if(from) from.balance += t.amount;
    if(to) to.balance -= t.amount;
  }
  DATA.transactions = DATA.transactions.filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteTransaction = deleteTransaction;

/* ============ RÉCURRENCES & CHARGES FIXES ============ */
function renderRecurring(){
  const el = document.getElementById('recurringList');
  const list = DATA.recurring || [];
  const key = currentMonthKey();
  el.innerHTML = list.length ? list.map(r => {
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
  }).join('') : `<div class="empty">Aucune récurrence pour le moment. Cochez "récurrent(e)" sur un revenu ou une dépense pour en créer une.</div>`;
}
function recordRecurring(id){
  const r = (DATA.recurring||[]).find(x => x.id === id);
  if(!r) return;
  const key = currentMonthKey();
  if(r.lastRecordedMonth === key){ alert('Déjà enregistré ce mois-ci.'); return; }
  const account = accountById(r.accountId);
  if(!account){ alert('Le compte associé à cette récurrence n\'existe plus.'); return; }
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
  if(!confirm('Supprimer cette récurrence ? Les transactions déjà enregistrées restent intactes.')) return;
  DATA.recurring = (DATA.recurring||[]).filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteRecurring = deleteRecurring;

/* ============ HISTORIQUE ============ */
function clearTxnFilters(){
  document.getElementById('txnFilterType').value = 'all';
  document.getElementById('txnFilterMonth').value = '';
  document.getElementById('txnFilterCategory').value = '';
  renderTransactions();
}
window.clearTxnFilters = clearTxnFilters;
['txnFilterType','txnFilterMonth','txnFilterCategory'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderTransactions);
});
function txnRowHtml(t){
  const from = accountById(t.accountId);
  const to = accountById(t.toAccountId);
  let icon = '↔️', title = 'Transfert', sub = `${from?from.name:'—'} → ${to?to.name:'—'}`, sign = '', cls = '';
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
  const dateStr = new Date(t.date + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'short', year:'numeric'});
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
function renderTransactions(){
  const typeFilter = document.getElementById('txnFilterType').value;
  const monthFilter = document.getElementById('txnFilterMonth').value;
  const catFilter = document.getElementById('txnFilterCategory').value;
  let list = (DATA.transactions || []).slice();
  if(typeFilter !== 'all') list = list.filter(t => t.type === typeFilter);
  if(monthFilter) list = list.filter(t => monthKeyOf(t.date) === monthFilter);
  if(catFilter) list = list.filter(t => t.category === catFilter);
  list.sort((a,b) => b.date.localeCompare(a.date));
  const el = document.getElementById('txnList');
  el.innerHTML = list.length ? list.slice(0,200).map(txnRowHtml).join('') : `<div class="empty">Aucun mouvement pour ces filtres.</div>`;
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
  const entries = Object.entries(DATA.budgets || {});
  if(!entries.length){
    el.innerHTML = `<div class="empty">Aucun budget défini pour le moment.</div>`;
    return;
  }
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
function pickAccount(promptMessage){
  const accounts = DATA.accounts || [];
  if(!accounts.length) return null;
  const listText = accounts.map((a,i) => `${i+1}) ${a.name} (${formatFCFA(a.balance)})`).join('\n');
  const answer = prompt(`${promptMessage}\n\n${listText}\n\nEntrez le numéro du compte :`, '1');
  if(answer === null) return null;
  const idx = parseInt(answer, 10) - 1;
  return accounts[idx] || null;
}
function toggleBillPaid(id){
  const b = (DATA.bills||[]).find(x => x.id === id);
  if(!b) return;
  if(!b.paid){
    let account = accountById(b.accountId);
    if(!account) account = pickAccount(`Avec quel compte payez-vous "${b.name}" (${formatFCFA(b.amount)}) ?`);
    if(!account){ alert('Paiement annulé : aucun compte sélectionné.'); return; }
    account.balance -= b.amount;
    const txn = {id: genId('txn'), type:'depense', amount:b.amount, date: todayStr(), category:'maison', subcategory:b.name, personId:'foyer', accountId:account.id, toAccountId:'', note:`Facture : ${b.name}`, recurringId:''};
    DATA.transactions.push(txn);
    b.paid = true;
    b.paidTxnId = txn.id;
    b.accountId = account.id;
  } else {
    if(!confirm('Annuler le paiement de cette facture ? La dépense correspondante sera supprimée et le solde réajusté.')) return;
    const txn = (DATA.transactions||[]).find(t => t.id === b.paidTxnId);
    if(txn){
      const account = accountById(txn.accountId);
      if(account) account.balance += txn.amount;
      DATA.transactions = DATA.transactions.filter(t => t.id !== b.paidTxnId);
    }
    b.paid = false;
    b.paidTxnId = '';
  }
  saveData();
  renderAll();
}
window.toggleBillPaid = toggleBillPaid;
function deleteBill(id){
  const b = (DATA.bills||[]).find(x => x.id === id);
  if(!b) return;
  if(b.paid){ alert('Cette facture est déjà payée. Annulez d\'abord le paiement avant de la supprimer.'); return; }
  if(!confirm(`Supprimer la facture "${b.name}" ?`)) return;
  DATA.bills = DATA.bills.filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteBill = deleteBill;
function renderBills(){
  const el = document.getElementById('billsList');
  const bills = (DATA.bills || []).slice().sort((a,b) => a.due.localeCompare(b.due));
  el.innerHTML = bills.length ? bills.map(b => {
    const n = daysUntil(b.due);
    let statusTag = b.paid ? '<span class="tag green">Payée</span>' : (n < 0 ? '<span class="tag red">En retard</span>' : '<span class="tag orange">À payer</span>');
    const dateStr = new Date(b.due + 'T00:00:00').toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'});
    return `
      <div class="row-item ${!b.paid && n<0 ? 'alert-row':''}">
        <div class="row-icon">🧾</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(b.name)} ${statusTag}</div>
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
  const label = direction > 0 ? 'ajouter à' : 'retirer de';
  const amountStr = prompt(`Montant à ${label} l'objectif "${g.name}" (FCFA) :`, '');
  if(amountStr === null) return;
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ alert('Montant invalide.'); return; }
  if(direction < 0 && amount > g.current){ alert('Ce montant dépasse ce qui est actuellement épargné sur cet objectif.'); return; }
  if(direction > 0 && amount > totalUsable()){
    if(!confirm(`Attention : cela dépasse votre argent utilisable actuel (${formatFCFA(totalUsable())}). Continuer quand même ?`)) return;
  }
  g.current += direction * amount;
  DATA.transactions.push({
    id: genId('txn'), type: direction>0?'epargne_ajout':'epargne_retrait', amount, date: todayStr(),
    category:'', subcategory:'', personId:'foyer', accountId:'', toAccountId:'', note:g.name, recurringId:''
  });
  saveData();
  renderAll();
  if(direction>0 && g.current >= g.target){
    showToast(`🎉 Objectif "${g.name}" atteint !`);
  } else {
    showToast('Épargne mise à jour ✅');
  }
}
window.adjustGoal = adjustGoal;
function editGoal(id){
  const g = goalById(id);
  if(!g) return;
  const newName = prompt('Nom de l\'objectif :', g.name);
  if(newName === null) return;
  const newTarget = prompt('Montant cible (FCFA) :', g.target);
  if(newTarget === null) return;
  if(newName.trim()) g.name = newName.trim();
  const nt = Number(newTarget);
  if(nt > 0) g.target = nt;
  saveData();
  renderAll();
}
window.editGoal = editGoal;
function deleteGoal(id){
  const g = goalById(id);
  if(!g) return;
  if(!confirm(`Supprimer l'objectif "${g.name}" ? Les ${formatFCFA(g.current)} déjà épargnés redeviennent immédiatement utilisables.`)) return;
  DATA.savingsGoals = DATA.savingsGoals.filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteGoal = deleteGoal;
function renderSavings(){
  const el = document.getElementById('goalsList');
  const goals = DATA.savingsGoals || [];
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
  const amountStr = prompt(`Montant du remboursement pour "${d.name}" (FCFA) :`, d.mensualite);
  if(amountStr === null) return;
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ alert('Montant invalide.'); return; }
  const account = pickAccount(`Avec quel compte remboursez-vous "${d.name}" ?`);
  if(!account){ alert('Remboursement annulé.'); return; }
  account.balance -= amount;
  d.restant = Math.max(0, d.restant - amount);
  DATA.transactions.push({id: genId('txn'), type:'depense', amount, date: todayStr(), category:'dettes', subcategory:d.name, personId:'foyer', accountId:account.id, toAccountId:'', note:`Remboursement : ${d.name}`, recurringId:''});
  saveData();
  renderAll();
  if(d.restant <= 0) showToast(`🎉 Dette "${d.name}" totalement remboursée !`);
  else showToast('Remboursement enregistré ✅');
}
window.repayDebt = repayDebt;
function editDebt(id){
  const d = debtById(id);
  if(!d) return;
  const newRestant = prompt('Corriger le montant restant (FCFA) :', d.restant);
  if(newRestant === null) return;
  const nr = Number(newRestant);
  if(!isNaN(nr) && nr>=0) d.restant = nr;
  saveData();
  renderAll();
}
window.editDebt = editDebt;
function deleteDebt(id){
  if(!confirm('Supprimer cette dette de votre suivi ?')) return;
  DATA.debts = (DATA.debts||[]).filter(x => x.id !== id);
  saveData();
  renderAll();
}
window.deleteDebt = deleteDebt;
function renderDebts(){
  const el = document.getElementById('debtsList');
  const debts = DATA.debts || [];
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
  const months = [addMonthsToKey(reportMonth,-2), addMonthsToKey(reportMonth,-1), reportMonth];
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

/* ============ PARAMÈTRES ============ */
function renderSettings(){
  const soi = soiPersonne() || {prenom:'', nom:'', telephone:''};
  document.getElementById('settingsProfile').innerHTML = `
    <div class="settings-row"><div><div class="label">${escapeHtml(soi.prenom)} ${escapeHtml(soi.nom||'')}</div></div></div>
    <div class="settings-row"><div><div class="label">Téléphone</div><div class="desc">${escapeHtml(soi.telephone) || 'Non renseigné'}</div></div></div>
    <div class="settings-row"><div><div class="label">Foyer</div><div class="desc">${escapeHtml(DATA.foyer.nom)}</div></div></div>`;
  const el = document.getElementById('settingsCategoriesList');
  const customCats = DATA.categories || [];
  el.innerHTML = customCats.length ? customCats.map(c => `
    <div class="row-item"><div class="row-icon">🏷️</div><div class="row-body"><div class="row-title">${escapeHtml(c.label)}</div><div class="row-sub">${c.type==='revenu'?'Revenu':'Dépense'}</div></div>
    <div class="row-actions"><button class="icon-btn danger" title="Supprimer" onclick="deleteCategory('${c.id}')">🗑</button></div></div>
  `).join('') : `<div class="empty">Aucune catégorie personnalisée.</div>`;
}
function editProfile(){
  const soi = soiPersonne();
  if(!soi){ alert('Aucun profil trouvé.'); return; }
  const newPrenom = prompt('Votre prénom :', soi.prenom);
  if(newPrenom === null) return;
  const newNom = prompt('Votre nom :', soi.nom || '');
  if(newNom === null) return;
  const newTel = prompt('Votre téléphone :', soi.telephone || '');
  if(newTel === null) return;
  soi.prenom = newPrenom.trim();
  soi.nom = newNom.trim();
  soi.telephone = newTel.trim();
  saveData();
  renderSettings();
  renderDashboard();
  showToast('Profil mis à jour ✅');
}
window.editProfile = editProfile;
document.getElementById('newCategoryForm').addEventListener('submit', e => {
  e.preventDefault();
  const label = document.getElementById('catLabel').value.trim();
  const type = document.getElementById('catType').value;
  if(!label) return;
  const id = 'custom_' + label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if((DATA.categories||[]).some(c => c.id === id)){ alert('Cette catégorie existe déjà.'); return; }
  DATA.categories.push({id, label, type, custom:true});
  saveData();
  e.target.reset();
  renderAll();
  renderSettings();
  showToast('Catégorie ajoutée ✅');
});
function deleteCategory(id){
  if(!confirm('Supprimer cette catégorie personnalisée ? Les mouvements déjà enregistrés avec elle resteront inchangés.')) return;
  DATA.categories = (DATA.categories||[]).filter(c => c.id !== id);
  saveData();
  renderAll();
  renderSettings();
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
    catch(err){ alert('Fichier invalide : ce n\'est pas un JSON lisible.'); return; }
    if(!parsed.accounts || !parsed.transactions){ alert('Fichier invalide : structure inattendue.'); return; }
    if(!confirm('Remplacer TOUTES les données actuelles par cette sauvegarde ? Cette action est irréversible.')) return;
    delete parsed.exportedAt;
    parsed = migrateLegacyIfNeeded(parsed);
    DATA = Object.assign(defaultFoyerData(), parsed);
    if(!Array.isArray(DATA.personnes)) DATA.personnes = [];
    saveData();
    renderAll();
    showToast('Sauvegarde restaurée ✅');
  };
  reader.readAsText(file);
  document.getElementById('importFile').value = '';
}
window.importData = importData;

/* ============ TABLEAU DE BORD ============ */
function renderDashboard(){
  const key = currentMonthKey();
  const soi = soiPersonne();
  document.getElementById('dashFoyerTitle').textContent = `Bon retour${soi && soi.prenom ? ', '+soi.prenom : ''}`;
  const activeCount = activePersonnes().length;
  document.getElementById('dashSub').textContent = activeCount <= 1 ? 'Vous gérez ce foyer en solo.' : `Foyer de ${activeCount} personnes.`;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  const usable = totalUsable();
  document.getElementById('dashTotalDisponible').textContent = formatFCFA(usable);
  document.getElementById('dashTotalSub').textContent = `Total ${formatFCFA(totalAllAccounts())} · Épargne réservée ${formatFCFA(totalReserved())}`;
  const revMonth = sumAmount((DATA.transactions||[]).filter(t => t.type==='revenu' && monthKeyOf(t.date)===key));
  const depMonth = sumAmount(expensesForMonth(key));
  document.getElementById('dashRevenusMonth').textContent = formatFCFA(revMonth);
  document.getElementById('dashDepensesMonth').textContent = formatFCFA(depMonth);
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
  document.getElementById('dashBudgetGlobalLabel').innerHTML = `<span>${formatFCFA(totalSpentBudgeted)} dépensé</span><span>${pctGlobal}%</span>`;
  const upcomingItems = [
    ...upcoming30.map(b => ({label:b.name, amount:b.amount, date:b.due})),
    ...upcomingRecItems,
  ].sort((a,b) => a.date.localeCompare(b.date));
  document.getElementById('dashUpcomingList').innerHTML = upcomingItems.length ? upcomingItems.slice(0,6).map(it => `
    <div class="row-item"><div class="row-icon">📅</div><div class="row-body"><div class="row-title">${escapeHtml(it.label)}</div><div class="row-sub">${new Date(it.date+'T00:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</div></div><div class="row-amount neg">${formatFCFA(it.amount)}</div></div>
  `).join('') : `<div class="empty">Rien de prévu dans les prochains jours 👌</div>`;
  const accEl = document.getElementById('dashAccountsList');
  accEl.innerHTML = (DATA.accounts||[]).map(a => {
    const t = accountTypeInfo(a.type);
    return `<div class="row-item"><div class="row-icon">${t.icon}</div><div class="row-body"><div class="row-title">${escapeHtml(a.name)}</div></div><div class="row-amount">${formatFCFA(a.balance)}</div></div>`;
  }).join('') || `<div class="empty">Aucun compte pour le moment.</div>`;
  const alerts = budgetAlerts();
  document.getElementById('dashBudgetAlerts').innerHTML = alerts.length ? alerts.map(a => `<div class="alert ${a.level}"><span>${a.level==='red'?'🔴':(a.level==='orange'?'🟠':'🔵')}</span><div><p>${escapeHtml(a.text)}</p></div></div>`).join('') : `<div class="alert green"><span>🟢</span><div><b>Tout va bien</b><p>Aucun budget proche du dépassement.</p></div></div>`;
}

/* ============ INIT ============ */
startSync();
