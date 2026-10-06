# Coach — entraînement à domicile

Application de coaching sportif conçue pour l'entraînement à la maison, avec pour seul
matériel : **barre de traction, haltères, élastiques et poids du corps**.

Sa particularité n'est pas de proposer des programmes, mais de **refuser d'en proposer de
mauvais**. Un moteur de récupération suit la fatigue de chacun des 17 groupes musculaires et
garantit structurellement 48 à 72 heures de repos avant de reprogrammer un muscle — même si
cela signifie réécrire la séance du jour.

---

## Démarrage

```bash
docker compose up -d          # PostgreSQL 17 sur le port 5433
cp .env.example .env
pnpm install
pnpm db:migrate               # applique le schéma
pnpm db:seed                  # référentiel : 17 muscles, 80 exercices, profil
pnpm db:seed:demo             # optionnel : 4 semaines d'historique réaliste
pnpm dev                      # API sur :3000, interface sur :5173
```

Ouvrez <http://localhost:5173>.

| Commande | Effet |
|---|---|
| `pnpm dev` | API et interface en parallèle |
| `pnpm test` | Suite complète (moteur + intégration API) |
| `pnpm test:core` | Tests du moteur seuls, sans base de données |
| `pnpm typecheck` | Vérification TypeScript de tous les paquets |
| `pnpm db:studio` | Explorateur de base Drizzle |
| `pnpm db:reset -- --yes` | Réinitialise complètement la base |
| `pnpm db:rebuild-fatigue` | Reconstruit le cache de récupération depuis le journal |

Prérequis : Node ≥ 20.11, pnpm 10, Docker.

## Déploiement

En production, l'application tourne derrière le SSO de valldoy.com (Cloudflare Tunnel →
nginx → Authelia) : trois conteneurs sans port publié, un profil par compte SSO créé à la
première visite. Procédure complète dans [deploy/README.md](deploy/README.md).

```bash
cd deploy && cp .env.example .env    # puis renseigner POSTGRES_PASSWORD
docker compose up -d --build
```

---

## Architecture

```
apps/
  api/        Hono — orchestration entre la base et le moteur
  web/        Vite + React 19 — interface mobile-first
packages/
  shared/     Contrat API ↔ web : énumérations, types, schémas zod
  core/       ⭐ Moteur métier pur — aucune I/O, aucun Date.now()
  db/         Schéma PostgreSQL (Drizzle), migrations, amorçage
```

**Pourquoi le moteur dans un paquet séparé ?** `@sport/core` ne contient que des fonctions
pures : l'horloge et l'état entrent par les paramètres, rien n'est lu ni écrit. Ce n'est pas
une préférence esthétique — c'est ce qui permet de dérouler quatre semaines d'entraînement
simulé en 200 millisecondes et de **vérifier par test que la règle des 48 heures n'est jamais
violée**, sur toutes les fréquences et tous les niveaux. Avec un moteur couplé à la base,
cette garantie ne serait qu'une intention.

`apps/api` reste le backend : il lit la base, appelle le moteur, écrit le résultat.

---

## Le moteur de récupération

### Du geste à la fatigue

Chaque série effectuée est convertie en charge de fatigue, répartie sur les muscles selon leur
contribution réelle au mouvement :

```
stimulus = contribution × f(RIR) × f(répétitions) × charge systémique
```

- **contribution** — 1,0 pour un moteur principal, 0,5 pour un secondaire, 0,2 pour un
  stabilisateur. Une traction compte 1 série pour les dorsaux et 0,7 pour les biceps. Sans
  cette pondération, un programme de tirage lourd amènerait mécaniquement les biceps au-delà
  de leur volume récupérable.
- **f(RIR)** — la proximité de l'échec est le premier déterminant de la fatigue produite.
- **charge systémique** — une traction lestée coûte à l'organisme bien plus que les muscles
  qu'elle cible ; une extension mollet à l'élastique, non.

Unité de référence : *une série menée à l'échec sur un moteur principal vaut 1,0*.

### Décroissance

```
fatigue(M, t) = Σᵢ stimulusᵢ × 2^( −(t − tᵢ) / demi-vieᵢ )
```

Demi-vies de base : **28 h** pour les grands groupes, **22 h** pour les moyens, **17 h** pour
les petits. Ces valeurs ne sont pas arbitraires — elles sont dérivées de la fenêtre visée. Une
séance pleine porte la fatigue à ~0,87 fois la capacité ; le retour au statut « frais » demande
donc `demi-vie × log₂(0,87 / 0,15) ≈ demi-vie × 2,54` heures, soit **71 h** pour un grand
muscle, dans la fenêtre.

Chaque événement porte **sa propre demi-vie, figée à l'enregistrement** après modulation par
le sommeil, le stress, l'âge et le niveau du jour. Une mauvaise nuit ralentit la récupération à
venir ; elle ne réécrit jamais celle qui a déjà eu lieu.

### La garantie 48–72 h

```
disponible(M, t)  ⟺  (t − dernier travail direct) ≥ 48 h
                      ET  fatigue(M, t) / capacité < 0,65
```

Deux verrous **cumulatifs**. Le plancher horaire est dur : le score continu ne peut que
repousser l'échéance, jamais l'avancer. Un réglage utilisateur peut allonger le repos d'un
muscle, jamais le raccourcir.

Le second verrou apporte ce qu'une règle horaire seule ne peut pas voir : après trois séances
lourdes rapprochées, chaque intervalle respecte formellement les 48 h, mais la fatigue cumulée
bloque quand même. C'est un cas testé explicitement.

**Travail direct contre participation.** Seul le travail direct — moteur principal ou
secondaire à contribution ≥ 0,5 — déclenche le plancher. Sans cette distinction, le rôle de
stabilisateur des lombaires sur un squat immobiliserait le bas du dos pendant deux jours et
l'application deviendrait inutilisable. Le même seuil interdit de retenir un exercice : on ne
peut donc pas contourner la règle par les muscles secondaires.

| fatigue / capacité | Statut | Conséquence |
|---|---|---|
| < 0,15 | Frais | Volume plein |
| 0,15 – 0,40 | Prêt | Volume plein |
| 0,40 – 0,65 | En récupération | Volume × 0,6, pas d'échec musculaire |
| 0,65 – 0,90 | Fatigué | **Bloqué** |
| > 0,90 | Surmené | **Bloqué**, décharge proposée |

### Courbatures et fatigue générale

Une courbature déclarée ≥ 3/5 injecte un événement de fatigue à demi-vie courte (12 h) : le
muscle est effectivement repoussé, sans que l'historique passé soit altéré.

La fatigue systémique combine la moyenne des fatigues pondérée par la masse musculaire, le RPE
moyen sur 7 jours et le déficit de sommeil. Une décharge est proposée après trois jours
au-dessus du seuil, deux séances sans progression, ou tout muscle en surmenage.

---

## Planification dynamique

### Le découpage découle de la contrainte, pas l'inverse

| Séances/sem | Découpage | Écart minimal obtenu |
|---|---|---|
| 2 | Full body A / B | 72 h |
| 3 | Full body A / B / C | 96 h |
| 4 | Haut / Bas × 2 | 72 h |
| 5 | Push / Pull / Jambes + Haut / Bas | 72 h |
| 6 | Push / Pull / Jambes × 2 | 72 h |

Au-delà de 3 séances, un full body devient mathématiquement incompatible avec 48 h de repos :
il faut découper. Les créneaux voisins partagent volontairement peu de muscles, pour qu'une
séance avancée de quelques heures ne bute pas contre le plancher.

Le placement des jours est résolu par **énumération exhaustive** : au plus 35 combinaisons ×
6 rotations, soit une solution optimale et parfaitement déterministe — pas une heuristique.

### Changer de fréquence

Le principe : **c'est le volume hebdomadaire qui produit l'hypertrophie, pas le nombre de
séances.** Passer de 3 à 4 entraînements ne doit donc pas augmenter la charge de travail — cela
répartit le même volume sur plus de séances, qui deviennent plus courtes et de meilleure
qualité.

`PATCH /api/plan/frequency` :

1. calcule le nouveau découpage et replace les jours en respectant le plancher de repos ;
2. **conserve la cible hebdomadaire de chaque muscle** — vérifié par test à ± 0 ;
3. crée une **nouvelle version de plan** ; l'ancienne est archivée, jamais écrasée ;
4. laisse **intactes les séances déjà réalisées**, régénère seulement les séances futures ;
5. avertit si la fréquence dépasse ce que le niveau permet de soutenir, sans l'interdire —
   c'est la décision de l'utilisateur.

Avec `preview: true`, tout est calculé sans rien écrire : l'interface affiche la comparaison
avant/après, muscle par muscle, avant que l'utilisateur ne confirme.

---

## Génération d'une séance

```
1. cliché de récupération  →  écarter les muscles non disponibles
2. dette de volume         =  cible hebdomadaire − réalisé cette semaine
3. vivier d'exercices      =  matériel possédé ∩ niveau ∩ sans contre-indication
4. sélection gloutonne sous contraintes
5. prescription (charges réelles, double progression)
6. ordonnancement : échauffement → polyarticulaires → isolation → gainage
7. compte rendu expliquant chaque décision
```

L'étape 1 précède tout le reste : la récupération n'est pas un critère parmi d'autres que l'on
pondère, c'est un **filtre appliqué avant même de se demander quoi entraîner**.

La fonction de score combine dette de volume, priorité utilisateur, disponibilité, couverture
des patrons moteurs imposés, variété par rapport à la séance précédente, et **ratio
stimulus / fatigue** — à couverture musculaire égale, le mouvement le moins coûteux gagne, ce
qui fait préférer un goblet squat à un squat sauté.

Deux contraintes de cohérence évitent des séances absurdes :

- un exercice n'est retenu que si l'un de ses **moteurs principaux appartient au créneau du
  jour** — sans quoi un swing, très rentable pour la dette globale, s'inviterait dans une
  séance haut du corps et bloquerait la séance jambes du lendemain ;
- si plus de 60 % du créneau est bloqué, l'algorithme **bascule sur une séance de repli**
  orientée vers les groupes réellement disponibles, plutôt que de rendre une séance amputée.

Le moteur n'utilise **aucune source d'aléa** : à état identique, la séance générée est
strictement la même. La variété vient de l'état réel de l'athlète.

### Progression

En salle, on ajoute 2,5 kg à la barre. À domicile cet axe est vite épuisé, le moteur en exploite
donc quatre, dans cet ordre :

1. **répétitions** — monter dans la fourchette ;
2. **charge** — palier d'haltère ou d'élastique suivant, en repartant en bas de fourchette ;
3. **levier** — variante plus difficile de la famille (pompes → déclinées → archer → une main) ;
4. **tempo** — en dernier recours, ralentir l'excentrique.

Déclenchement : toutes les séries au sommet de la fourchette à 1 répétition de l'échec au plus.
Deux échecs consécutifs déclenchent une régression. **Seules des charges réellement possédées
sont prescrites** — jamais « 12,5 kg » à quelqu'un qui n'a que des haltères de 5 et 10.

---

## Modèle de données

23 tables. Le cœur du système tient en deux :

```
muscle_fatigue_events   journal immuable, en ajout seul  ← source de vérité
muscle_fatigue_states   projection recalculée            ← cache de lecture
```

Pourquoi ne pas simplement stocker un score et le mettre à jour ?

1. **Reproductibilité** — la demi-vie de chaque événement est figée à l'enregistrement. Le
   score à n'importe quelle date passée est recalculable à l'identique.
2. **Auditabilité** — quand l'application refuse de programmer les pectoraux, elle peut montrer
   quelles séries, quel jour, à quelle intensité.
3. **Correction sans réécriture** — une courbature déclarée après coup ajoute un événement,
   elle n'altère pas le passé.

Le cache ne contient **aucune information qui ne soit reconstructible** depuis le journal :
`pnpm db:rebuild-fatigue` le régénère intégralement, et la commande existe précisément pour
rendre cette propriété vérifiable.

Les plans sont **versionnés** (`training_plans.version`) : chaque changement de fréquence crée
une version et archive la précédente. Chaque séance planifiée conserve son
`generation_snapshot` — l'état de fatigue au moment du calcul, les muscles écartés et leur
motif. N'importe quelle décision passée de l'algorithme reste explicable des mois plus tard.

Autres tables notables : `exercise_muscles` (cartographie pondérée, socle de tout le suivi),
`exercise_progression_states` (double progression), `user_muscle_settings` (priorités et
exclusions pour blessure), `recovery_checkins` et `muscle_soreness_reports`.

---

## API

```
GET    /api/health
GET    /api/me                         compte SSO connecté, adresse de déconnexion
GET    /api/profile                    PATCH /api/profile
GET    /api/equipment                  PUT   /api/profile/equipment
PUT    /api/profile/muscles            PUT   /api/profile/exercise-preference
GET    /api/muscles
GET    /api/exercises                  GET   /api/exercises/:slug

GET    /api/recovery/state             ⭐ les 17 muscles : score, statut, disponible à
GET    /api/recovery/timeline?days=14  passé et projection
GET    /api/recovery/systemic          fatigue globale + recommandation de décharge
POST   /api/recovery/checkin           point de forme + courbatures
GET    /api/recovery/checkins

GET    /api/plan/current               GET  /api/plan/versions
POST   /api/plan/generate
PATCH  /api/plan/frequency             ⭐ nouvelle version + redistribution du volume
POST   /api/plan/deload

GET    /api/sessions                   GET  /api/sessions/:id
POST   /api/sessions/:id/regenerate    recalcule avec la fatigue de l'instant
POST   /api/sessions/:id/move          revalide les contraintes de repos
POST   /api/sessions/:id/skip
POST   /api/sessions/preview           « que puis-je faire maintenant ? »

POST   /api/workouts/start             GET  /api/workouts/active
POST   /api/workouts/:id/sets          DELETE /api/workouts/:id/sets/:setId
POST   /api/workouts/:id/finish        ⭐ séries → fatigue + progression + records

GET    /api/stats/volume?weeks=8       volume par muscle vs MEV / MAV / MRV
GET    /api/stats/progression/:id      GET /api/stats/summary
```

Toutes les erreurs suivent la même forme, en français :

```json
{ "error": { "code": "not_found", "message": "Séance introuvable.", "details": null } }
```

L'en-tête `x-simulated-now` permet de se placer à n'importe quel instant — indispensable pour
vérifier la fenêtre de 48 h sans attendre deux jours. C'est ainsi que les tests d'intégration
traversent une semaine en quelques millisecondes.

---

## Interface

Mobile-first, thème sombre : l'usage réel est un téléphone posé au sol dans un salon, souvent le
soir.

| Écran | Rôle |
|---|---|
| **Accueil** | Séance du jour, jauge de fatigue générale, muscles bientôt disponibles |
| **Récup** ⭐ | Silhouette colorée par statut ; au clic, score, dernière sollicitation, heure de retour, volume 7 j. Point de forme quotidien |
| **Séance** | Un exercice à la fois, gros boutons, chronomètre de repos, badge de progression |
| **Planning** | Sélecteur de fréquence 2–6 **avec aperçu de l'impact avant validation** |
| **Stats** | Volume par muscle contre MEV / MAV / MRV |
| **Exercices** | Catalogue filtrable, avec la répartition musculaire pondérée |
| **Réglages** | Matériel possédé, priorités musculaires, exclusions |

---

## Tests

**136 tests** — 110 sur le moteur, 26 d'intégration API.

```bash
pnpm test:core     # moteur seul, sans base — < 1 s
pnpm test          # tout, nécessite PostgreSQL
```

Les tests d'intégration utilisent une base `sport_test` séparée :

```bash
docker exec sport_postgres psql -U sport -d postgres -c "CREATE DATABASE sport_test"
```

Les tests qui comptent vraiment :

- **`ne sollicite jamais deux fois un muscle à moins de 48 h, sur un bloc complet`** — déroule
  des mésocycles entiers à chaque fréquence (2 à 6) et chaque niveau, en réinjectant à chaque
  séance le travail prescrit dans le journal de fatigue. C'est la garantie exécutable de
  l'exigence centrale, vérifiée sur le comportement du système entier et non sur une règle
  isolée. Une variante rejoue les 8 combinaisons de matériel.
- **`libère le muscle exactement à 48 h`** et **`déclare la récupération complète à l'intérieur
  de la fenêtre de 72 h`** — les bornes de la fenêtre, vérifiées numériquement.
- **`repousse la disponibilité au-delà du plancher de 48 h`** — quatre séances lourdes
  espacées de 24 h : chaque intervalle respecte formellement la règle horaire, mais la fatigue
  cumulée bloque. Ce que le score continu apporte au-delà du plancher.
- **`conserve la cible hebdomadaire muscle par muscle`** — sur les 30 transitions de fréquence
  possibles.
- **`ne prescrit jamais un exercice nécessitant du matériel absent`** — exhaustif sur les 16
  combinaisons créneau × matériel.
- **`refuse de reprogrammer un muscle avant 48 h et l'explique`** — à travers l'API réelle : on
  enregistre une vraie séance, on avance de 24 h, et on vérifie qu'aucun exercice proposé ne
  charge un muscle bloqué.
- **`n'impute jamais au volume ce qui relève de la durée`** — les explications données à
  l'utilisateur doivent correspondre à la vraie cause. Dire « faute de temps » quand le volume
  hebdomadaire est simplement atteint le pousserait à rallonger ses séances sans raison.

---

## Choix techniques

| Sujet | Choix | Raison |
|---|---|---|
| Monorepo | pnpm workspaces | Résolution stricte, `workspace:*`, pas d'étape de build interne |
| Base | PostgreSQL 17 + Drizzle | Types natifs, JSONB pour les comptes rendus, migrations SQL versionnées |
| Backend | Hono | Léger, `app.request()` teste les routes sans ouvrir de port |
| Frontend | Vite 6 + React 19 + Tailwind 4 | Démarrage instantané, thème par tokens CSS |
| Comptes | SSO par en-tête de confiance (`Remote-User`), profil local unique en développement | Aucun mot de passe géré par l'application ; `user_id` présent partout, un profil par compte |
| Imports | Sans extension `.js` | `drizzle-kit` charge le schéma via esbuild en CJS et ne résout pas les extensions TypeScript |

Les paquets internes exposent directement leurs sources TypeScript : `tsx` et Vite les
transpilent, ce qui supprime toute étape de build intermédiaire en développement.

---

## Limites connues

- **Authentification déléguée au SSO.** En mode `forward-auth`, l'API croit l'en-tête
  `Remote-User` sur parole : elle ne doit être joignable qu'à travers le nginx qui valide la
  session auprès d'Authelia, jamais exposée directement.
- **Le catalogue est servi depuis le code**, pas depuis la base. Les tables `exercises` et
  `exercise_muscles` assurent l'intégrité référentielle et les agrégats SQL, mais ajouter un
  exercice personnalisé demanderait de lire le catalogue depuis PostgreSQL.
- **Les séances planifiées à l'avance reposent sur une projection de fatigue.** Si la réalité
  s'en écarte, `POST /api/sessions/:id/regenerate` recalcule à l'instant présent — l'interface
  le propose sur chaque séance.
- **Pas d'i18n.** Français uniquement, les libellés sont centralisés dans
  `packages/shared/src/labels.ts`.
