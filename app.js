/* ============================================================
   MA FAMILLE — gestion financière et familiale du foyer (FCFA)
   Application mono-utilisateur : un seul compte, une seule base
   de données (Firestore), aucune connexion directe aux banques
   ou portefeuilles mobiles — vous saisissez vous-même vos soldes
   et mouvements.
   ============================================================ */

/* ============ FIREBASE ============
   Remplacez ces valeurs par celles de VOTRE projet Firebase
   (Console Firebase > Paramètres du projet > Vos applications).
   Voir le guide de déploiement (DEPLOIEMENT.md) fourni avec ce projet. */
const firebaseConfig = {
  apiKey: "REMPLACER_PAR_VOTRE_API_KEY",
  authDomain: "REMPLACER.firebaseapp.com",
  projectId: "REMPLACER",
  storageBucket: "REMPLACER.firebasestorage.app",
  messagingSenderId: "REMPLACER",
  appId: "REMPLACER"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let DOC_REF = null; // défini après connexion : db.collection('foyers').doc(uid)

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
  {id:'bebe', label:'Bébé', icon:'👶'},
  {id:'homme', label:'Homme (personnel)', icon:'👨'},
  {id:'femme', label:'Femme (personnel)', icon:'👩'},
  {id:'aide', label:'Aide à la maison', icon:'👧'},
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
const DEFAULT_THRESHOLDS = [50, 75, 90];
const LOCAL_KEY = 'mafamille_local_v1';
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

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

/* ============ MODÈLE DE DONNÉES ============
   Un seul document Firestore par utilisateur : collection 'foyers', id = uid.
   {
     profil: { nom, prenom, telephone },
     foyer: { nom },
     membres: { homme:{prenom}, femme:{prenom},
                bebe:{actif, prenom, naissance},
                aide:{actif, prenom, role, frequence, remuneration, transport, autres} },
     accounts: [ {id,name,type,balance} ],
     transactions: [ {id,type:'revenu'|'depense'|'transfert'|'epargne_ajout'|'epargne_retrait',
                       amount,date,category,subcategory,person,scope,accountId,toAccountId,note,recurringId} ],
     recurring: [ {id,label,type:'revenu'|'depense',amount,category,scope,accountId,day,fixedCharge,lastRecordedMonth} ],
     budgets: { [categoryId]: montant },
     thresholds: [50,75,90],
     bills: [ {id,name,amount,due,accountId,paid,paidTxnId} ],
     savingsGoals: [ {id,name,target,current} ],
     debts: [ {id,name,creancier,initial,restant,mensualite,taux,dateDebut,dateFin} ],
     categories: [ {id,label,type,icon,custom:true} ]
   } */
function defaultFoyerData(){
  return {
    profil: {nom:'', prenom:'', telephone:''},
    foyer: {nom:''},
    membres: {
      homme: {prenom:''},
      femme: {prenom:''},
      bebe: {actif:false, prenom:'', naissance:''},
      aide: {actif:false, prenom:'', role:'', frequence:'', remuneration:0, transport:0, autres:0},
    },
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
  ['loginScreen','setupScreen','appRoot'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
}
function showLoginScreen(){
  hideAllGateScreens();
  document.getElementById('loginScreen').style.display = 'flex';
}
function showSetupScreen(){
  hideAllGateScreens();
  document.getElementById('setupScreen').style.display = 'flex';
}
function showAppRoot(){
  hideAllGateScreens();
  document.getElementById('appRoot').style.display = 'block';
}

/* ============ CONNEXION ============ */
function handleLogin(e){
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  auth.signInWithEmailAndPassword(email, password)
    .catch(err => {
      console.error('Erreur de connexion :', err);
      errEl.textContent = 'Identifiant ou mot de passe incorrect.';
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    });
}
function handleForgotPassword(){
  const email = (document.getElementById('loginEmail').value || '').trim();
  if(!email){
    alert('Entrez d\'abord votre adresse e-mail dans le champ ci-dessus, puis cliquez à nouveau sur "Mot de passe oublié".');
    return;
  }
  auth.sendPasswordResetEmail(email)
    .then(() => alert(`Un e-mail de réinitialisation a été envoyé à ${email}.`))
    .catch(err => {
      console.error('Erreur de réinitialisation :', err);
      alert('Impossible d\'envoyer l\'e-mail de réinitialisation. Vérifiez l\'adresse saisie.');
    });
}
function logout(){
  if(!confirm('Se déconnecter ?')) return;
  auth.signOut();
}
window.logout = logout;
let inactivityTimer = null;
let loggedOutForInactivity = false;
function resetInactivityTimer(){
  if(!auth.currentUser) return;
  if(inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    loggedOutForInactivity = true;
    auth.signOut();
  }, INACTIVITY_LIMIT_MS);
}
function clearInactivityTimer(){
  if(inactivityTimer){ clearTimeout(inactivityTimer); inactivityTimer = null; }
}
['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(evt => {
  document.addEventListener(evt, resetInactivityTimer, {passive:true});
});

/* ============ CRÉATION DU FOYER (première utilisation) ============ */
document.getElementById('stBebeCheck').addEventListener('change', function(){
  document.getElementById('stBebeFields').style.display = this.checked ? 'grid' : 'none';
});
document.getElementById('stAideCheck').addEventListener('change', function(){
  document.getElementById('stAideFields').style.display = this.checked ? 'grid' : 'none';
});
function handleSetupSubmit(e){
  e.preventDefault();
  const errEl = document.getElementById('setupError');
  errEl.textContent = '';
  const foyerNom = document.getElementById('stFoyerNom').value.trim();
  const userPrenom = document.getElementById('stUserPrenom').value.trim();
  if(!foyerNom || !userPrenom){
    errEl.textContent = 'Le nom du foyer et votre prénom sont obligatoires.';
    return;
  }
  const data = defaultFoyerData();
  data.profil = {
    nom: document.getElementById('stUserNom').value.trim(),
    prenom: userPrenom,
    telephone: document.getElementById('stUserTelephone').value.trim(),
  };
  data.foyer = {nom: foyerNom};
  data.membres.homme.prenom = document.getElementById('stHommePrenom').value.trim();
  data.membres.femme.prenom = document.getElementById('stFemmePrenom').value.trim();
  const bebeActif = document.getElementById('stBebeCheck').checked;
  data.membres.bebe = {
    actif: bebeActif,
    prenom: document.getElementById('stBebePrenom').value.trim(),
    naissance: document.getElementById('stBebeNaissance').value,
  };
  const aideActif = document.getElementById('stAideCheck').checked;
  data.membres.aide = {
    actif: aideActif,
    prenom: document.getElementById('stAidePrenom').value.trim(),
    role: '', frequence: '',
    remuneration: Number(document.getElementById('stAideRemuneration').value) || 0,
    transport: 0, autres: 0,
  };
  data.accounts.push({id: genId('acc'), name:'Espèces', type:'CASH', balance:0});
  DATA = data;
  setSyncBadge('saving');
  DOC_REF.set(DATA).then(() => {
    foyerExists = true;
    dataReady = true;
    showAppRoot();
    switchView('dashboard');
    renderAll();
    showToast('Bienvenue ! Votre foyer est prêt 🎉');
  }).catch(err => {
    console.error('Erreur de création du foyer :', err);
    errEl.textContent = 'Impossible de créer votre foyer. Vérifiez votre connexion et réessayez.';
    setSyncBadge('err');
  });
}

/* ============ SYNCHRONISATION ============ */
function startSync(){
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('forgotPasswordBtn').addEventListener('click', handleForgotPassword);
  document.getElementById('setupForm').addEventListener('submit', handleSetupSubmit);
  auth.onAuthStateChanged(user => {
    if(!user){
      dataReady = false;
      foyerExists = false;
      DOC_REF = null;
      clearInactivityTimer();
      showLoginScreen();
      if(loggedOutForInactivity){
        const errEl = document.getElementById('loginError');
        if(errEl) errEl.textContent = `Vous avez été déconnecté(e) après ${INACTIVITY_LIMIT_MS/60000} minutes d'inactivité.`;
        loggedOutForInactivity = false;
      }
      return;
    }
    resetInactivityTimer();
    DOC_REF = db.collection('foyers').doc(user.uid);
    DOC_REF.onSnapshot(snap => {
      if(snap.exists){
        const shared = snap.data();
        DATA = Object.assign(defaultFoyerData(), shared);
        DATA.membres = Object.assign(defaultFoyerData().membres, shared.membres || {});
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
    });
  });
}

/* ============ NAVIGATION ============ */
const VIEWS = ['dashboard','accounts','transactions','budget','bills','savings','debts','family','forecast','calendar','reports','settings'];
function switchView(view){
  if(!VIEWS.includes(view)) view = 'dashboard';
  currentView = view;
  saveLocalPrefs();
  VIEWS.forEach(v => {
    const nav = document.getElementById('nav' + v.charAt(0).toUpperCase() + v.slice(1));
    const el = document.getElementById('view-' + v);
    if(nav) nav.classList.toggle('active', v === view);
    if(el) el.classList.toggle('active', v === view);
  });
  if(!dataReady) return;
  if(view === 'calendar') renderCalendar();
  if(view === 'forecast') renderForecast();
  if(view === 'reports') renderReports();
  if(view === 'family') renderFamily();
  if(view === 'settings') renderSettings();
}
window.switchView = switchView;

function renderAll(){
  if(!dataReady) return;
  fillAllAccountSelects();
  fillAllCategorySelects();
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
  if(currentView === 'family') renderFamily();
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
    accountId: fromId, toAccountId: toId, note, category:'', subcategory:'', person:'', scope:''
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
  const person = document.getElementById('inPerson').value;
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
      scope:'', accountId, day: Number(date.slice(8,10)), fixedCharge:false, lastRecordedMonth: monthKeyOf(date)};
    DATA.recurring.push(rec);
    recurringId = rec.id;
  }
  account.balance += amount;
  DATA.transactions.push({id: genId('txn'), type:'revenu', amount, date, category, subcategory:'', person, scope:'', accountId, toAccountId:'', note, recurringId});
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
  const scope = document.getElementById('exScope').value;
  const accountId = document.getElementById('exAccount').value;
  const note = document.getElementById('exNote').value.trim();
  const recurrent = document.getElementById('exRecurrent').checked;
  if(!amount || amount <= 0 || !date || !accountId){ alert('Vérifiez le montant, la date et le compte.'); return; }
  const account = accountById(accountId);
  if(!account) return;
  let recurringId = '';
  if(recurrent){
    const rec = {id: genId('rec'), label: subcategory || categoryInfo(category,'depense').label, type:'depense', amount, category,
      scope, accountId, day: Number(date.slice(8,10)), fixedCharge:false, lastRecordedMonth: monthKeyOf(date)};
    DATA.recurring.push(rec);
    recurringId = rec.id;
  }
  account.balance -= amount;
  DATA.transactions.push({id: genId('txn'), type:'depense', amount, date, category, subcategory, person:'', scope, accountId, toAccountId:'', note, recurringId});
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
          <div class="row-sub">${r.type === 'revenu' ? 'Revenu' : 'Dépense'} · le ${r.day} de chaque mois · ${escapeHtml(accountById(r.accountId)?accountById(r.accountId).name:'—')}</div>
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
  if(r.type === 'revenu'){
    account.balance += r.amount;
    DATA.transactions.push({id: genId('txn'), type:'revenu', amount:r.amount, date, category:r.category, subcategory:'', person:'', scope:'', accountId:r.accountId, toAccountId:'', note:r.label, recurringId:r.id});
  } else {
    account.balance -= r.amount;
    DATA.transactions.push({id: genId('txn'), type:'depense', amount:r.amount, date, category:r.category, subcategory:r.label, person:'', scope:r.scope, accountId:r.accountId, toAccountId:'', note:'', recurringId:r.id});
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
    sub = `${from?from.name:'—'}${t.person?' · '+t.person:''}`;
    sign = '+'; cls = 'pos';
  } else if(t.type === 'depense'){
    const info = categoryInfo(t.category, 'depense');
    icon = info.icon; title = info.label + (t.subcategory?` — ${escapeHtml(t.subcategory)}`:'');
    sub = `${from?from.name:'—'}${t.scope?' · '+scopeLabel(t.scope):''}`;
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
function scopeLabel(scope){
  return {famille:'Famille', homme:'Homme', femme:'Femme', bebe:'Bébé', aide:'Aide à la maison'}[scope] || scope;
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
    const txn = {id: genId('txn'), type:'depense', amount:b.amount, date: todayStr(), category:'maison', subcategory:b.name, person:'', scope:'famille', accountId:account.id, toAccountId:'', note:`Facture : ${b.name}`, recurringId:''};
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
    category:'', subcategory:'', person:'', scope:'', accountId:'', toAccountId:'', note:g.name, recurringId:''
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
  DATA.transactions.push({id: genId('txn'), type:'depense', amount, date: todayStr(), category:'dettes', subcategory:d.name, person:'', scope:'famille', accountId:account.id, toAccountId:'', note:`Remboursement : ${d.name}`, recurringId:''});
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

/* ============ FAMILLE ============ */
document.getElementById('fmBebeCheck').addEventListener('change', function(){
  document.getElementById('fmBebeFields').style.display = this.checked ? 'grid' : 'none';
});
document.getElementById('fmAideCheck').addEventListener('change', function(){
  document.getElementById('fmAideFields').style.display = this.checked ? 'grid' : 'none';
});
document.getElementById('familyForm').addEventListener('submit', e => {
  e.preventDefault();
  DATA.foyer.nom = document.getElementById('fmFoyerNom').value.trim();
  DATA.membres.homme.prenom = document.getElementById('fmHommePrenom').value.trim();
  DATA.membres.femme.prenom = document.getElementById('fmFemmePrenom').value.trim();
  const bebeActif = document.getElementById('fmBebeCheck').checked;
  DATA.membres.bebe = {
    actif: bebeActif,
    prenom: document.getElementById('fmBebePrenom').value.trim(),
    naissance: document.getElementById('fmBebeNaissance').value,
  };
  const aideActif = document.getElementById('fmAideCheck').checked;
  DATA.membres.aide = {
    actif: aideActif,
    prenom: document.getElementById('fmAidePrenom').value.trim(),
    role: document.getElementById('fmAideRole').value.trim(),
    frequence: document.getElementById('fmAideFrequence').value.trim(),
    remuneration: Number(document.getElementById('fmAideRemuneration').value) || 0,
    transport: Number(document.getElementById('fmAideTransport').value) || 0,
    autres: Number(document.getElementById('fmAideAutres').value) || 0,
  };
  saveData();
  renderAll();
  renderFamily();
  showToast('Informations de la famille mises à jour ✅');
});
function fillFamilyForm(){
  document.getElementById('fmFoyerNom').value = DATA.foyer.nom || '';
  document.getElementById('fmHommePrenom').value = DATA.membres.homme.prenom || '';
  document.getElementById('fmFemmePrenom').value = DATA.membres.femme.prenom || '';
  const bebe = DATA.membres.bebe || {};
  document.getElementById('fmBebeCheck').checked = !!bebe.actif;
  document.getElementById('fmBebeFields').style.display = bebe.actif ? 'grid' : 'none';
  document.getElementById('fmBebePrenom').value = bebe.prenom || '';
  document.getElementById('fmBebeNaissance').value = bebe.naissance || '';
  const aide = DATA.membres.aide || {};
  document.getElementById('fmAideCheck').checked = !!aide.actif;
  document.getElementById('fmAideFields').style.display = aide.actif ? 'grid' : 'none';
  document.getElementById('fmAidePrenom').value = aide.prenom || '';
  document.getElementById('fmAideRole').value = aide.role || '';
  document.getElementById('fmAideFrequence').value = aide.frequence || '';
  document.getElementById('fmAideRemuneration').value = aide.remuneration || 0;
  document.getElementById('fmAideTransport').value = aide.transport || 0;
  document.getElementById('fmAideAutres').value = aide.autres || 0;
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
  return `${months} mois`;
}
function renderFamily(){
  fillFamilyForm();
  const bebe = DATA.membres.bebe || {};
  const babyCard = document.getElementById('babyCard');
  if(bebe.actif){
    babyCard.style.display = 'block';
    const thisMonth = currentMonthKey();
    const months = [0,-1,-2].map(n => addMonthsToKey(thisMonth, n));
    const monthTotals = months.map(k => sumAmount(expensesForMonth(k, 'bebe')));
    const avg = Math.round((monthTotals[0]+monthTotals[1]+monthTotals[2])/3);
    const sinceBirth = (DATA.transactions||[]).filter(t => t.type==='depense' && t.category==='bebe' && (!bebe.naissance || t.date >= bebe.naissance));
    const totalSince = sumAmount(sinceBirth);
    document.getElementById('babyStats').innerHTML = `
      <div class="stat-row">
        <div class="stat-box"><div class="label">${escapeHtml(bebe.prenom||'Bébé')}</div><div class="value">${ageFromBirthdate(bebe.naissance)}</div></div>
        <div class="stat-box"><div class="label">Dépenses ce mois</div><div class="value neg">${formatFCFA(monthTotals[0])}</div></div>
      </div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">${monthLabel(months[0])}</span><span class="nums">${formatFCFA(monthTotals[0])}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">${monthLabel(months[1])}</span><span class="nums">${formatFCFA(monthTotals[1])}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">${monthLabel(months[2])}</span><span class="nums">${formatFCFA(monthTotals[2])}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Moyenne mensuelle</span><span class="nums">${formatFCFA(avg)}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Total depuis la naissance</span><span class="nums">${formatFCFA(totalSince)}</span></div></div>`;
  } else {
    babyCard.style.display = 'none';
  }
  const aide = DATA.membres.aide || {};
  const aideCard = document.getElementById('aideCard');
  if(aide.actif){
    aideCard.style.display = 'block';
    const total = (Number(aide.remuneration)||0) + (Number(aide.transport)||0) + (Number(aide.autres)||0);
    const monthAideExpenses = sumAmount(expensesForMonth(currentMonthKey(), 'aide'));
    document.getElementById('aideStats').innerHTML = `
      <div class="budget-block"><div class="budget-block-top"><span class="name">Salaire</span><span class="nums">${formatFCFA(aide.remuneration)}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Transport</span><span class="nums">${formatFCFA(aide.transport)}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Autres</span><span class="nums">${formatFCFA(aide.autres)}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Coût total prévu / mois</span><span class="nums">${formatFCFA(total)}</span></div></div>
      <div class="budget-block"><div class="budget-block-top"><span class="name">Dépenses "Aide" enregistrées ce mois</span><span class="nums">${formatFCFA(monthAideExpenses)}</span></div></div>`;
  } else {
    aideCard.style.display = 'none';
  }
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
  document.getElementById('settingsProfile').innerHTML = `
    <div class="settings-row"><div><div class="label">${escapeHtml(DATA.profil.prenom)} ${escapeHtml(DATA.profil.nom)}</div><div class="desc">${escapeHtml(auth.currentUser ? auth.currentUser.email : '')}</div></div></div>
    <div class="settings-row"><div><div class="label">Téléphone</div><div class="desc">${escapeHtml(DATA.profil.telephone) || 'Non renseigné'}</div></div></div>
    <div class="settings-row"><div><div class="label">Foyer</div><div class="desc">${escapeHtml(DATA.foyer.nom)}</div></div></div>`;
  const el = document.getElementById('settingsCategoriesList');
  const customCats = DATA.categories || [];
  el.innerHTML = customCats.length ? customCats.map(c => `
    <div class="row-item"><div class="row-icon">🏷️</div><div class="row-body"><div class="row-title">${escapeHtml(c.label)}</div><div class="row-sub">${c.type==='revenu'?'Revenu':'Dépense'}</div></div>
    <div class="row-actions"><button class="icon-btn danger" title="Supprimer" onclick="deleteCategory('${c.id}')">🗑</button></div></div>
  `).join('') : `<div class="empty">Aucune catégorie personnalisée.</div>`;
}
function editProfile(){
  const newPrenom = prompt('Votre prénom :', DATA.profil.prenom);
  if(newPrenom === null) return;
  const newNom = prompt('Votre nom :', DATA.profil.nom);
  if(newNom === null) return;
  const newTel = prompt('Votre téléphone :', DATA.profil.telephone);
  if(newTel === null) return;
  DATA.profil.prenom = newPrenom.trim();
  DATA.profil.nom = newNom.trim();
  DATA.profil.telephone = newTel.trim();
  saveData();
  renderSettings();
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
    DATA = Object.assign(defaultFoyerData(), parsed);
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
  document.getElementById('dashFoyerTitle').textContent = `Bon retour, ${DATA.profil.prenom || ''}`.trim();
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
