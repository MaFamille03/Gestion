# Notre Mariage — App de coordination

Application web (PWA) pour planifier le budget, les tâches et les invités à deux, en temps réel, depuis vos téléphones. Installable sur l'écran d'accueil comme une vraie appli.

## Ce qui a déjà été fait

- Interface complète : Accueil, Budget, Tâches, Invités, Réglages
- Budget pré-rempli avec les postes de votre estimation (dot, tenues, restauration, décoration…) — modifiable/supprimable librement
- 16 tâches critiques de démarrage déjà chargées
- Rappels automatiques : tâches en retard, tâches de la semaine, tâches critiques "oubliées" (sans date, non touchées depuis 14 jours)
- Compte à rebours jusqu'au jour J

## Étape 1 — Créer votre base de données partagée (10 min, gratuit)

C'est ce qui permet à vous deux de voir les mêmes données en temps réel, sur deux téléphones différents.

1. Allez sur **https://console.firebase.google.com** et connectez-vous avec un compte Google
2. **Ajouter un projet** → donnez-lui un nom (ex. `notre-mariage`) → suivez les étapes (vous pouvez désactiver Google Analytics)
3. Une fois dans le projet, cliquez sur l'icône **`</>`** ("Web") pour ajouter une application web
4. Donnez un surnom à l'app (ex. `mariage-app`) → **Enregistrer l'application**
5. Firebase affiche un bloc `firebaseConfig = { ... }` — **copiez ces valeurs**
6. Ouvrez le fichier `js/firebase-config.js` de ce projet et remplacez les valeurs `"REMPLACE_MOI"` par les vôtres
7. Dans le menu de gauche Firebase, allez dans **Firestore Database** → **Créer une base de données** → choisissez une région proche (ex. `eur3` ou `europe-west`) → mode **production**
8. Une fois créée, allez dans l'onglet **Règles** et remplacez le contenu par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /mariages/{code}/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Ces règles ouvrent l'accès à quiconque connaît le code de votre mariage (choisi à l'étape 2). C'est volontairement simple puisque vous n'êtes que deux — gardez ce code comme un mot de passe, ne le partagez à personne d'autre.

Cliquez sur **Publier**.

## Étape 2 — Mettre l'app en ligne (gratuit, via GitHub Pages)

1. Créez un compte sur **github.com** si vous n'en avez pas
2. Créez un nouveau dépôt (repository), par exemple `notre-mariage`
3. Mettez-y tous les fichiers de ce dossier (`index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js`, `icons/`)
4. Dans le dépôt : **Settings → Pages → Source : branche `main`, dossier `/ (root)`** → Enregistrer
5. Votre app sera accessible quelques minutes après à une adresse du type :
   `https://votre-nom-utilisateur.github.io/notre-mariage/`

## Étape 3 — Installer l'app sur vos téléphones

1. Ouvrez le lien ci-dessus dans Safari (iPhone) ou Chrome (Android)
2. **iPhone** : bouton Partager → "Sur l'écran d'accueil"
   **Android** : menu (⋮) → "Ajouter à l'écran d'accueil" / "Installer l'application"
3. Au premier lancement, **choisissez ensemble un code de mariage** (ex. `berenger2027`) et entrez-le sur les deux téléphones — vous partagerez alors exactement les mêmes données

## Utilisation au quotidien

- **Accueil** : compte à rebours, alertes de retard, tâches de la semaine, tâches critiques laissées de côté, résumé du budget
- **Budget** : appuyez sur une dépense pour la modifier, sur "+ Ajouter" pour en créer une nouvelle
- **Tâches** : cochez pour terminer, appuyez pour modifier la date/le responsable, filtrez par "Moi" / "Elle-Lui"
- **Invités** : suivez les confirmations par catégorie (VIP, Famille, Amis, Église, Comité)
- **Réglages** (icône ⚙ en haut) : date du mariage, nombre d'invités visé, vos deux prénoms (utilisés pour les filtres "Moi/Partenaire")

## Pour aller plus loin (optionnel, plus tard)

- **Notifications push réelles** (hors app ouverte) demandent un petit service serveur en plus (Firebase Cloud Functions) — possible à ajouter si besoin
- **Photos d'invités/inspiration** peuvent être ajoutées via Firebase Storage
- Un export du budget en PDF ou Excel peut être ajouté sur demande
