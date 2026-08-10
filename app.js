import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, setDoc, getDoc, getDocs, writeBatch, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------------------------------------------------------------
// Catégories de référence (héritées de l'analyse du budget mariage)
// ---------------------------------------------------------------
const BUDGET_CATEGORIES = [
  "Dot & Coutumier", "Tenues & Accessoires", "Restauration",
  "Boissons", "Décoration", "Photo & Vidéo", "Location & Transport",
  "Administratif", "Divers"
];
const GUEST_CATEGORIES = ["VIP", "Famille", "Amis", "Église", "Comité"];

const DEFAULT_BUDGET_SEED = [
  { nom: "Dot complète (accord des familles)", categorie: "Dot & Coutumier", qte: 1, prixUnitaire: 1112005, prixReel: 0, priseEnCharge: "Les deux" },
  { nom: "Robe de mariée, voile, gants", categorie: "Tenues & Accessoires", qte: 1, prixUnitaire: 300000, prixReel: 0, priseEnCharge: "" },
  { nom: "Costume, chaussures, accessoires marié", categorie: "Tenues & Accessoires", qte: 1, prixUnitaire: 210000, prixReel: 0, priseEnCharge: "" },
  { nom: "Traiteur (entrée, plat, dessert)", categorie: "Restauration", qte: 1, prixUnitaire: 900000, prixReel: 0, priseEnCharge: "" },
  { nom: "Boissons et rafraîchissements", categorie: "Boissons", qte: 1, prixUnitaire: 185000, prixReel: 0, priseEnCharge: "" },
  { nom: "Décoration complète (église, salle, voiture)", categorie: "Décoration", qte: 1, prixUnitaire: 300000, prixReel: 0, priseEnCharge: "" },
  { nom: "Photographe et vidéaste", categorie: "Photo & Vidéo", qte: 1, prixUnitaire: 300000, prixReel: 0, priseEnCharge: "" },
  { nom: "Location de véhicules", categorie: "Location & Transport", qte: 1, prixUnitaire: 275000, prixReel: 0, priseEnCharge: "" },
  { nom: "Location salle de réception", categorie: "Location & Transport", qte: 1, prixUnitaire: 300000, prixReel: 0, priseEnCharge: "" },
  { nom: "Dossiers administratifs (mairie, actes, CNI)", categorie: "Administratif", qte: 1, prixUnitaire: 86100, prixReel: 0, priseEnCharge: "" },
  { nom: "Alliances", categorie: "Divers", qte: 1, prixUnitaire: 300000, prixReel: 0, priseEnCharge: "" },
  { nom: "Cartes d'invitation", categorie: "Divers", qte: 1, prixUnitaire: 75000, prixReel: 0, priseEnCharge: "" },
  { nom: "Imprévus & réserve financière", categorie: "Divers", qte: 1, prixUnitaire: 50000, prixReel: 0, priseEnCharge: "" }
];

const DEFAULT_TASKS_SEED = [
  { titre: "Choisir les membres du comité d'organisation", categorie: "Organisation", critique: true },
  { titre: "Récupérer la liste de la dot", categorie: "Dot", critique: true },
  { titre: "Renseignements mairie (frais, documents)", categorie: "Administratif", critique: true },
  { titre: "Prospection tenues de dot (homme & femme)", categorie: "Dot", critique: false },
  { titre: "Prospection salle de réception", categorie: "Réception", critique: true },
  { titre: "Prospection tenues de mariage (confection)", categorie: "Tenues", critique: false },
  { titre: "Renseignements BURIDA sur droits d'organisation", categorie: "Administratif", critique: false },
  { titre: "Choisir la décoratrice (église, salle, voiture)", categorie: "Décoration", critique: true },
  { titre: "Choisir DJ et MC", categorie: "Animation", critique: false },
  { titre: "Choisir le traiteur", categorie: "Restauration", critique: true },
  { titre: "Prospection confection des alliances", categorie: "Divers", critique: false },
  { titre: "Choisir le photographe / vidéaste", categorie: "Photo & Vidéo", critique: true },
  { titre: "Confection et envoi des invitations", categorie: "Divers", critique: false },
  { titre: "Réserver les véhicules", categorie: "Logistique", critique: false },
  { titre: "Prévoir le lieu de préparation des mariés", categorie: "Jour J", critique: false },
  { titre: "Réserver l'hôtel pour la nuit de noces", categorie: "Divers", critique: false }
];

// ---------------------------------------------------------------
// État local
// ---------------------------------------------------------------
let code = null;
let meta = { dateMariage: null, nombreInvites: 300, nomMoi: "", nomPartenaire: "" };
let budgetItems = [];
let tasks = [];
let guests = [];
let taskFilter = "all";
let guestFilter = "all";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------
// Portail d'entrée (code officiel unique et partagé)
// ---------------------------------------------------------------
function normalizeCode(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

const configRef = () => doc(db, "config", "current");
let configUnsub = null;
let gateError = null;

function showGateError(msg) {
  gateError = msg;
  let el = $("#gate-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "gate-error";
    el.style.cssText = "color:#6E1E33;font-size:13px;margin:-6px 0 12px;font-weight:600;";
    $("#gate-input").insertAdjacentElement("afterend", el);
  }
  el.textContent = msg;
}
function clearGateError() {
  gateError = null;
  const el = $("#gate-error");
  if (el) el.remove();
}

function boot() {
  const saved = localStorage.getItem("weddingCode");
  if (saved) {
    tryEnter(saved, { fromCache: true });
  } else {
    $("#gate").classList.remove("hidden");
  }
  $("#gate-submit").addEventListener("click", () => {
    const val = normalizeCode($("#gate-input").value);
    if (!val) return;
    tryEnter(val, { fromCache: false });
  });
  $("#change-code").addEventListener("click", openChangeCodeModal);
}

// Vérifie le code face au code officiel partagé (config/current) avant d'entrer.
// - Si aucun code officiel n'existe encore : celui-ci le devient (tout premier lancement).
// - Sinon : doit correspondre exactement, sinon on refuse (pas de nouvel espace créé par erreur).
async function tryEnter(val, { fromCache }) {
  try {
    const snap = await getDoc(configRef());
    if (!snap.exists()) {
      await setDoc(configRef(), { code: val, updatedAt: serverTimestamp() });
    } else if (snap.data().code !== val) {
      if (fromCache) {
        // Le code officiel a changé pendant que cet appareil était déconnecté.
        localStorage.removeItem("weddingCode");
        $("#gate").classList.remove("hidden");
        $("#app").classList.add("hidden");
        showGateError("Le code du mariage a été changé. Entrez le nouveau code.");
        return;
      }
      showGateError("Code incorrect. Vérifiez le code auprès de votre partenaire.");
      return;
    }
    clearGateError();
    localStorage.setItem("weddingCode", val);
    enterApp(val);
  } catch (e) {
    showGateError("Connexion impossible. Vérifiez votre réseau et réessayez.");
  }
}

function openChangeCodeModal() {
  const html = `
    <h3>Changer le code de mariage</h3>
    <p style="font-size:13px;color:rgba(31,42,36,0.65);margin-bottom:14px;line-height:1.5;">
      Ce nouveau code devient le seul valable pour vous deux. Votre partenaire sera automatiquement
      déconnecté(e) de l'ancien code et devra entrer celui-ci pour continuer.
    </p>
    <input id="m-newcode" type="text" placeholder="Nouveau code">
    <div class="modal-actions">
      <button class="btn btn-ghost" id="m-cancel">Annuler</button>
      <button class="btn btn-primary" id="m-confirm">Changer pour vous deux</button>
    </div>`;
  openModal(html, () => {
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-confirm").addEventListener("click", async () => {
      const newCode = normalizeCode($("#m-newcode").value);
      if (!newCode) return;
      await setDoc(configRef(), { code: newCode, updatedAt: serverTimestamp() });
      localStorage.setItem("weddingCode", newCode);
      closeModal();
      location.reload();
    });
  });
}

async function enterApp(c) {
  code = c;
  $("#gate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await seedIfNeeded();
  listenMeta();
  listenBudget();
  listenTasks();
  listenGuests();
  setupNav();
  setupModals();
  watchOfficialCode();
}

// Si le code officiel change pendant que l'app est ouverte (l'autre personne
// vient de le modifier), on déconnecte cet appareil immédiatement.
function watchOfficialCode() {
  if (configUnsub) configUnsub();
  configUnsub = onSnapshot(configRef(), (snap) => {
    if (!snap.exists()) return;
    if (snap.data().code !== code) {
      localStorage.removeItem("weddingCode");
      alert("Le code du mariage a été changé par votre partenaire. Entrez le nouveau code pour continuer.");
      location.reload();
    }
  });
}

// ---------------------------------------------------------------
// Amorçage des données par défaut (une seule fois, si vide)
// ---------------------------------------------------------------
async function seedIfNeeded() {
  const metaRef = doc(db, "mariages", code);

  // Verrou atomique : si deux téléphones arrivent en même temps sur un code
  // tout neuf, un seul des deux gagnera cette transaction. L'autre la verra
  // déjà "prise" et n'amorcera rien, ce qui évite les doublons de budget/tâches.
  let shouldSeed = false;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(metaRef);
    if (!snap.exists()) {
      tx.set(metaRef, {
        dateMariage: null, nombreInvites: 300, nomMoi: "", nomPartenaire: "",
        createdAt: serverTimestamp()
      });
      shouldSeed = true;
    }
  });

  if (shouldSeed) {
    const batch = writeBatch(db);
    DEFAULT_BUDGET_SEED.forEach(item => {
      const ref = doc(collection(db, "mariages", code, "budget"));
      batch.set(ref, { ...item, createdAt: serverTimestamp() });
    });
    DEFAULT_TASKS_SEED.forEach(t => {
      const ref = doc(collection(db, "mariages", code, "taches"));
      batch.set(ref, {
        titre: t.titre, categorie: t.categorie, critique: t.critique,
        echeance: null, responsable: "", statut: "a_faire",
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
}

// ---------------------------------------------------------------
// Listeners temps réel
// ---------------------------------------------------------------
function listenMeta() {
  onSnapshot(doc(db, "mariages", code), (snap) => {
    if (!snap.exists()) return;
    meta = snap.data();
    $("#setting-date").value = meta.dateMariage || "";
    $("#setting-guests").value = meta.nombreInvites || "";
    $("#setting-name-me").value = meta.nomMoi || "";
    $("#setting-name-partner").value = meta.nomPartenaire || "";
    renderCountdown();
    renderDashboard();
  });
}

function listenBudget() {
  onSnapshot(collection(db, "mariages", code, "budget"), (snap) => {
    budgetItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBudget();
    renderDashboard();
  });
}

function listenTasks() {
  onSnapshot(collection(db, "mariages", code, "taches"), (snap) => {
    tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks();
    renderDashboard();
  });
}

function listenGuests() {
  onSnapshot(collection(db, "mariages", code, "invites"), (snap) => {
    guests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGuests();
  });
}

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
function setupNav() {
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  $("#settings-btn").addEventListener("click", () => switchView("settings"));
  $("#save-settings").addEventListener("click", saveSettings);

  $$("#task-filters .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $$("#task-filters .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      taskFilter = chip.dataset.filter;
      renderTasks();
    });
  });
  $$("#guest-filters .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $$("#guest-filters .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      guestFilter = chip.dataset.filter;
      renderGuests();
    });
  });
}

function switchView(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  const target = $("#view-" + view);
  if (target) target.classList.add("active");
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
}

async function saveSettings() {
  await updateDoc(doc(db, "mariages", code), {
    dateMariage: $("#setting-date").value || null,
    nombreInvites: parseInt($("#setting-guests").value) || 0,
    nomMoi: $("#setting-name-me").value.trim(),
    nomPartenaire: $("#setting-name-partner").value.trim()
  });
  switchView("dashboard");
}

// ---------------------------------------------------------------
// Compte à rebours
// ---------------------------------------------------------------
function renderCountdown() {
  if (!meta.dateMariage) {
    $("#countdown-days").textContent = "—";
    $("#wedding-date-display").textContent = "Date à définir";
    return;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const wDate = new Date(meta.dateMariage);
  const diff = Math.round((wDate - today) / 86400000);
  $("#countdown-days").textContent = diff >= 0 ? diff : 0;
  $("#wedding-date-display").textContent = wDate.toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });
}

// ---------------------------------------------------------------
// Tableau de bord — alertes & rappels
// ---------------------------------------------------------------
function daysBetween(d1, d2) { return Math.round((d1 - d2) / 86400000); }

function renderDashboard() {
  const today = new Date(); today.setHours(0,0,0,0);
  const activeTasks = tasks.filter(t => t.statut !== "fait");

  // Alertes : tâches en retard
  const overdue = activeTasks.filter(t => t.echeance && new Date(t.echeance) < today);
  const alertStack = $("#alert-stack");
  alertStack.innerHTML = overdue.length
    ? overdue.map(t => `<div class="alert">⏰ En retard : <strong>${escapeHtml(t.titre)}</strong></div>`).join("")
    : "";

  // Cette semaine (échéance dans 0-7 jours)
  const upcoming = activeTasks
    .filter(t => t.echeance && daysBetween(new Date(t.echeance), today) >= 0 && daysBetween(new Date(t.echeance), today) <= 7)
    .sort((a,b) => new Date(a.echeance) - new Date(b.echeance));
  $("#dashboard-upcoming").innerHTML = upcoming.length
    ? upcoming.map(taskItemHtml).join("")
    : `<li class="empty-state">Rien de prévu dans les 7 prochains jours.</li>`;

  // Risque d'oubli : tâches critiques, sans échéance, non touchées depuis 14 jours
  const forgotten = activeTasks.filter(t => {
    if (!t.critique || t.echeance) return false;
    const created = t.createdAt?.toDate ? t.createdAt.toDate() : new Date();
    return daysBetween(today, created) >= 14;
  });
  $("#dashboard-forgotten").innerHTML = forgotten.length
    ? forgotten.map(taskItemHtml).join("")
    : `<li class="empty-state">Aucune tâche critique laissée de côté. 👍</li>`;

  attachTaskListeners("#dashboard-upcoming");
  attachTaskListeners("#dashboard-forgotten");

  // Budget résumé
  renderDashboardBudget();
}

function renderDashboardBudget() {
  const byCat = groupBudgetByCategory();
  const el = $("#dashboard-budget");
  el.innerHTML = Object.entries(byCat).map(([cat, items]) => {
    const estime = items.reduce((s,i) => s + i.qte * i.prixUnitaire, 0);
    const reel = items.reduce((s,i) => s + (i.prixReel||0), 0);
    const pct = estime > 0 ? Math.min(100, Math.round(reel/estime*100)) : 0;
    return `<div class="budget-row">
      <div class="budget-row-top"><span>${cat}</span><span>${pct}%</span></div>
      <div class="budget-row-figures">${fmt(reel)} / ${fmt(estime)} FCFA</div>
      <div class="mini-bar-track"><div class="mini-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("") || `<p class="empty-state">Pas encore de dépenses enregistrées.</p>`;
}

// ---------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------
function taskItemHtml(t) {
  const today = new Date(); today.setHours(0,0,0,0);
  let badge = "";
  if (t.echeance) {
    const diff = daysBetween(new Date(t.echeance), today);
    if (diff < 0) badge = `<span class="task-badge badge-overdue">Retard</span>`;
    else if (diff <= 7) badge = `<span class="task-badge badge-soon">J-${diff}</span>`;
    else badge = `<span class="task-badge badge-ok">${new Date(t.echeance).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</span>`;
  } else if (t.critique) {
    badge = `<span class="task-badge badge-soon">Sans date</span>`;
  }
  const done = t.statut === "fait";
  return `<li class="task-item" data-id="${t.id}">
    <button class="task-check ${done?"done":""}" data-toggle="${t.id}">${done?"✓":""}</button>
    <div class="task-body" data-edit="${t.id}">
      <div class="task-title ${done?"done":""}">${escapeHtml(t.titre)}</div>
      <div class="task-meta">${t.categorie || ""}${t.responsable ? " · " + escapeHtml(t.responsable) : ""}</div>
    </div>
    ${badge}
  </li>`;
}

function renderTasks() {
  let list = [...tasks];
  if (taskFilter === "mine") list = list.filter(t => t.responsable === meta.nomMoi);
  if (taskFilter === "partner") list = list.filter(t => t.responsable === meta.nomPartenaire);
  if (taskFilter === "done") list = list.filter(t => t.statut === "fait");
  if (taskFilter === "all") list = list.filter(t => t.statut !== "fait");

  list.sort((a,b) => {
    if (a.echeance && b.echeance) return new Date(a.echeance) - new Date(b.echeance);
    if (a.echeance) return -1;
    if (b.echeance) return 1;
    return 0;
  });

  $("#task-full-list").innerHTML = list.length
    ? list.map(taskItemHtml).join("")
    : `<li class="empty-state">Aucune tâche ici.</li>`;
  attachTaskListeners("#task-full-list");
}

function attachTaskListeners(containerSel) {
  $$(`${containerSel} [data-toggle]`).forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.toggle;
      const t = tasks.find(x => x.id === id);
      await updateDoc(doc(db, "mariages", code, "taches", id), {
        statut: t.statut === "fait" ? "a_faire" : "fait"
      });
    });
  });
  $$(`${containerSel} [data-edit]`).forEach(el => {
    el.addEventListener("click", () => openTaskModal(tasks.find(x => x.id === el.dataset.edit)));
  });
}

function openTaskModal(existing) {
  const isNew = !existing;
  const html = `
    <h3>${isNew ? "Nouvelle tâche" : "Modifier la tâche"}</h3>
    <input id="m-titre" type="text" placeholder="Titre de la tâche" value="${existing ? escapeAttr(existing.titre) : ""}">
    <select id="m-categorie">
      ${["Organisation","Dot","Administratif","Réception","Tenues","Décoration","Animation","Restauration","Divers","Logistique","Photo & Vidéo","Jour J"]
        .map(c => `<option ${existing?.categorie===c?"selected":""}>${c}</option>`).join("")}
    </select>
    <input id="m-echeance" type="date" value="${existing?.echeance || ""}">
    <select id="m-responsable">
      <option value="">Responsable (optionnel)</option>
      <option ${existing?.responsable===meta.nomMoi?"selected":""}>${meta.nomMoi||"Moi"}</option>
      <option ${existing?.responsable===meta.nomPartenaire?"selected":""}>${meta.nomPartenaire||"Partenaire"}</option>
      <option ${existing?.responsable==="Les deux"?"selected":""}>Les deux</option>
    </select>
    <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;margin-bottom:14px;">
      <input id="m-critique" type="checkbox" style="width:auto;margin:0;" ${existing?.critique?"checked":""}>
      Tâche critique (à surveiller si oubliée)
    </label>
    <div class="modal-actions">
      ${existing ? `<button class="btn btn-danger" id="m-delete">Supprimer</button>` : ""}
      <button class="btn btn-primary" id="m-save">Enregistrer</button>
    </div>`;
  openModal(html, () => {
    $("#m-save").addEventListener("click", async () => {
      const data = {
        titre: $("#m-titre").value.trim(),
        categorie: $("#m-categorie").value,
        echeance: $("#m-echeance").value || null,
        responsable: $("#m-responsable").value,
        critique: $("#m-critique").checked
      };
      if (!data.titre) return;
      if (isNew) {
        await addDoc(collection(db, "mariages", code, "taches"), { ...data, statut: "a_faire", createdAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "mariages", code, "taches", existing.id), data);
      }
      closeModal();
    });
    if (existing) {
      $("#m-delete").addEventListener("click", async () => {
        if (!confirm("Supprimer cette tâche ?")) return;
        await deleteDoc(doc(db, "mariages", code, "taches", existing.id));
        closeModal();
      });
    }
  });
}

// ---------------------------------------------------------------
// Budget
// ---------------------------------------------------------------
function groupBudgetByCategory() {
  const byCat = {};
  budgetItems.forEach(item => {
    if (!byCat[item.categorie]) byCat[item.categorie] = [];
    byCat[item.categorie].push(item);
  });
  return byCat;
}

function fmt(n) { return (n||0).toLocaleString("fr-FR"); }

function renderBudget() {
  const totalEstime = budgetItems.reduce((s,i) => s + i.qte * i.prixUnitaire, 0);
  const totalReel = budgetItems.reduce((s,i) => s + (i.prixReel||0), 0);
  $("#budget-total-planned").textContent = fmt(totalEstime);
  $("#budget-total-real").textContent = fmt(totalReel);
  const pct = totalEstime > 0 ? Math.min(100, Math.round(totalReel/totalEstime*100)) : 0;
  $("#budget-total-bar").style.width = pct + "%";

  const byCat = groupBudgetByCategory();
  const container = $("#budget-categories");
  container.innerHTML = BUDGET_CATEGORIES.filter(c => byCat[c]?.length).map(cat => {
    const items = byCat[cat];
    return `<div class="budget-category">
      <div class="budget-category-title">${cat}</div>
      ${items.map(i => `
        <div class="budget-item" data-edit="${i.id}">
          <div>
            <div class="budget-item-name">${escapeHtml(i.nom)}</div>
            ${i.priseEnCharge ? `<div class="budget-item-owner">${escapeHtml(i.priseEnCharge)}</div>` : ""}
          </div>
          <div class="budget-item-figures">${fmt(i.prixReel||0)}<br>/ ${fmt(i.qte*i.prixUnitaire)}</div>
        </div>`).join("")}
    </div>`;
  }).join("") || `<p class="empty-state">Aucune dépense pour le moment.</p>`;

  $$(`#budget-categories [data-edit]`).forEach(el => {
    el.addEventListener("click", () => openBudgetModal(budgetItems.find(x => x.id === el.dataset.edit)));
  });
}

function openBudgetModal(existing) {
  const isNew = !existing;
  const html = `
    <h3>${isNew ? "Nouvelle dépense" : "Modifier la dépense"}</h3>
    <input id="m-nom" type="text" placeholder="Nom de la dépense" value="${existing ? escapeAttr(existing.nom) : ""}">
    <select id="m-cat">${BUDGET_CATEGORIES.map(c => `<option ${existing?.categorie===c?"selected":""}>${c}</option>`).join("")}</select>
    <input id="m-qte" type="number" placeholder="Quantité" value="${existing?.qte ?? 1}">
    <input id="m-pu" type="number" placeholder="Prix unitaire estimé (FCFA)" value="${existing?.prixUnitaire ?? ""}">
    <input id="m-reel" type="number" placeholder="Montant réellement payé (FCFA)" value="${existing?.prixReel ?? ""}">
    <select id="m-charge">
      <option value="">Pris en charge par...</option>
      <option ${existing?.priseEnCharge===meta.nomMoi?"selected":""}>${meta.nomMoi||"Moi"}</option>
      <option ${existing?.priseEnCharge===meta.nomPartenaire?"selected":""}>${meta.nomPartenaire||"Partenaire"}</option>
      <option ${existing?.priseEnCharge==="Les deux"?"selected":""}>Les deux</option>
      <option ${existing?.priseEnCharge==="Famille"?"selected":""}>Famille</option>
    </select>
    <div class="modal-actions">
      ${existing ? `<button class="btn btn-danger" id="m-delete">Supprimer</button>` : ""}
      <button class="btn btn-primary" id="m-save">Enregistrer</button>
    </div>`;
  openModal(html, () => {
    $("#m-save").addEventListener("click", async () => {
      const data = {
        nom: $("#m-nom").value.trim(),
        categorie: $("#m-cat").value,
        qte: parseFloat($("#m-qte").value) || 0,
        prixUnitaire: parseFloat($("#m-pu").value) || 0,
        prixReel: parseFloat($("#m-reel").value) || 0,
        priseEnCharge: $("#m-charge").value
      };
      if (!data.nom) return;
      if (isNew) {
        await addDoc(collection(db, "mariages", code, "budget"), { ...data, createdAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "mariages", code, "budget", existing.id), data);
      }
      closeModal();
    });
    if (existing) {
      $("#m-delete").addEventListener("click", async () => {
        if (!confirm("Supprimer cette dépense ?")) return;
        await deleteDoc(doc(db, "mariages", code, "budget", existing.id));
        closeModal();
      });
    }
  });
}

// ---------------------------------------------------------------
// Invités
// ---------------------------------------------------------------
function renderGuests() {
  const total = guests.length;
  const confirmed = guests.filter(g => g.statut === "confirme").length;
  const pending = guests.filter(g => g.statut === "attente").length;
  $("#guest-summary").innerHTML = `
    <div class="guest-stat"><div class="guest-stat-num">${total}</div><div class="guest-stat-label">Total</div></div>
    <div class="guest-stat"><div class="guest-stat-num">${confirmed}</div><div class="guest-stat-label">Confirmés</div></div>
    <div class="guest-stat"><div class="guest-stat-num">${pending}</div><div class="guest-stat-label">En attente</div></div>`;

  let list = guestFilter === "all" ? guests : guests.filter(g => g.categorie === guestFilter);
  $("#guest-full-list").innerHTML = list.length ? list.map(g => `
    <li class="guest-item" data-edit="${g.id}">
      <span class="status-dot status-${g.statut||"attente"}"></span>
      <div class="task-body">
        <div class="task-title">${escapeHtml(g.nom)}</div>
        <div class="task-meta">${g.cote||""}</div>
      </div>
      <span class="guest-item-cat">${g.categorie||""}</span>
    </li>`).join("") : `<li class="empty-state">Aucun invité dans cette catégorie.</li>`;

  $$(`#guest-full-list [data-edit]`).forEach(el => {
    el.addEventListener("click", () => openGuestModal(guests.find(x => x.id === el.dataset.edit)));
  });
}

function openGuestModal(existing) {
  const isNew = !existing;
  const html = `
    <h3>${isNew ? "Nouvel invité" : "Modifier l'invité"}</h3>
    <input id="m-nom" type="text" placeholder="Nom complet" value="${existing ? escapeAttr(existing.nom) : ""}">
    <select id="m-cat">${GUEST_CATEGORIES.map(c => `<option ${existing?.categorie===c?"selected":""}>${c}</option>`).join("")}</select>
    <select id="m-cote">
      <option ${existing?.cote==="Marié"?"selected":""}>Marié</option>
      <option ${existing?.cote==="Mariée"?"selected":""}>Mariée</option>
      <option ${existing?.cote==="Les deux"?"selected":""}>Les deux</option>
    </select>
    <select id="m-statut">
      <option value="attente" ${existing?.statut==="attente"?"selected":""}>En attente</option>
      <option value="confirme" ${existing?.statut==="confirme"?"selected":""}>Confirmé</option>
      <option value="decline" ${existing?.statut==="decline"?"selected":""}>Décliné</option>
    </select>
    <div class="modal-actions">
      ${existing ? `<button class="btn btn-danger" id="m-delete">Supprimer</button>` : ""}
      <button class="btn btn-primary" id="m-save">Enregistrer</button>
    </div>`;
  openModal(html, () => {
    $("#m-save").addEventListener("click", async () => {
      const data = {
        nom: $("#m-nom").value.trim(),
        categorie: $("#m-cat").value,
        cote: $("#m-cote").value,
        statut: $("#m-statut").value
      };
      if (!data.nom) return;
      if (isNew) {
        await addDoc(collection(db, "mariages", code, "invites"), { ...data, createdAt: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "mariages", code, "invites", existing.id), data);
      }
      closeModal();
    });
    if (existing) {
      $("#m-delete").addEventListener("click", async () => {
        if (!confirm("Supprimer cet invité ?")) return;
        await deleteDoc(doc(db, "mariages", code, "invites", existing.id));
        closeModal();
      });
    }
  });
}

// ---------------------------------------------------------------
// Modale générique
// ---------------------------------------------------------------
function setupModals() {
  $("#add-task").addEventListener("click", () => openTaskModal(null));
  $("#add-budget-item").addEventListener("click", () => openBudgetModal(null));
  $("#add-guest").addEventListener("click", () => openGuestModal(null));
  $("#modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
}
function openModal(html, onMount) {
  $("#modal-content").innerHTML = html;
  $("#modal-backdrop").classList.remove("hidden");
  onMount();
}
function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  $("#modal-content").innerHTML = "";
}

// ---------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------
function escapeHtml(str="") {
  return str.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function escapeAttr(str="") { return escapeHtml(str); }

boot();

// Le cache hors-ligne (service worker) causait des blocages sur d'anciennes
// versions de l'app sur iOS. On le retire et on nettoie automatiquement tout
// ce qui aurait pu être installé précédemment, pour garantir que l'app
// affiche toujours la dernière version en ligne.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
  if (window.caches) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
  }
}
