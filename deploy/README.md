# Déploiement — Coach sur `sport.valldoy.com`

Complément de `sso-authelia-nginx-cloudflared-valldoy.md` (stack SSO dans `/opt/stack`).
L'application s'y branche comme n'importe quelle autre (§11 de ce document) : un conteneur sur
le réseau `web`, un vhost nginx, rien à toucher côté Cloudflare ni Authelia.

```
cloudflared → nginx (stack) ──auth_request──→ Authelia
                 │  Remote-User, Remote-Name, Remote-Email, Remote-Groups
                 ▼
          sport-web   nginx : interface React + relais /api        réseaux web, sport_internal
                 ▼
          sport-api   Node, bundle unique                         réseau sport_internal
                 ▼
          sport-db    PostgreSQL 17, volume sport_pgdata           réseau sport_internal
```

`sport_internal` est un réseau Docker `internal` : l'API et la base ne sont joignables ni depuis
Internet, ni depuis les autres conteneurs du stack. Aucune section `ports:`.

---

## 1. Ce que fait le SSO dans l'application

- **Un profil par compte.** L'API lit `Remote-User` (posé par nginx après validation par
  Authelia) et le rattache à un profil via `users.external_id`. À la première visite d'un
  compte, le profil est créé avec les réglages par défaut (matériel, priorités) ; le nom
  affiché vient de `Remote-Name`. `akadmin` et `lautre` ont chacun leurs séances, leur
  fatigue et leur plan.
- **Aucun écran de connexion dans l'application.** Pas de double authentification.
- **Déconnexion** : Réglages → Compte → « Se déconnecter », qui ouvre
  `https://auth.valldoy.com/logout?rd=https://sport.valldoy.com/`.
- **Session expirée** : les appels `/api` reçoivent la redirection de nginx vers le portail ;
  l'interface recharge alors la page, qui passe par le portail et revient où elle était.
- **Restreindre l'accès à un groupe** : règle Authelia avant la règle générale
  (`/opt/stack/authelia/configuration.yml`, prise en compte par `docker restart authelia`,
  qui déconnecte tout le monde) :

  ```yaml
      - domain: 'sport.valldoy.com'
        policy: 'two_factor'
        subject: 'group:admins'
  ```

**L'API croit `Remote-User` sur parole.** C'est ce qui rend le SSO transparent, et c'est
pourquoi `sport-api` ne doit jamais recevoir de `ports:` ni rejoindre le réseau `web`.

---

## 2. Installation

```bash
# Code (dépôt privé : clé de déploiement ou `gh auth login` au préalable)
git clone https://github.com/dissemblable/sport.git /opt/stack/apps/sport
cd /opt/stack/apps/sport/deploy

# Secrets
cp .env.example .env && chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" .env

# Construction et démarrage — le premier build prend quelques minutes
docker compose up -d --build
docker compose ps                        # trois services en « healthy »

# Vhost dans le nginx du stack
cp stack/sport.conf /opt/stack/nginx/sites/sport.conf
docker exec nginx nginx -t && docker exec nginx nginx -s reload
```

Au démarrage, l'API applique les migrations SQL et le référentiel d'exercices : aucune
commande manuelle. Pour un autre sous-domaine, modifier `server_name` dans
`/opt/stack/nginx/sites/sport.conf` (un seul niveau : `coach.valldoy.com`, pas
`app.sport.valldoy.com`).

---

## 3. Validation

| # | Test | Résultat attendu |
|---|---|---|
| 1 | `docker compose ps` | `sport-db`, `sport-api`, `sport-web` en `healthy` |
| 2 | `docker ps --filter name=sport- --format '{{.Names}} {{.Ports}}'` | `80/tcp`, `3000/tcp`, `5432/tcp` seulement, aucun `0.0.0.0:` |
| 3 | `curl -I https://sport.valldoy.com/` | 302 vers `https://auth.valldoy.com/?rd=https%3A%2F%2Fsport.valldoy.com%2F…` |
| 4 | `curl -I -H 'Remote-User: akadmin' https://sport.valldoy.com/api/me` | toujours 302, jamais 200 |
| 5 | Connexion dans le navigateur | l'accueil s'affiche ; Réglages → Compte montre `akadmin` |
| 6 | Connexion avec `lautre` (autre navigateur) | profil vierge, sans le plan d'`akadmin` |
| 7 | `docker exec sport-db psql -U sport -d sport -c 'select external_id, display_name from users'` | une ligne par compte venu au moins une fois |
| 8 | Réglages → Se déconnecter | retour à l'écran de connexion Authelia |

Consommation mesurée au repos : ~50 Mo pour l'API, ~40 Mo pour PostgreSQL, ~8 Mo pour nginx.

---

## 4. Mise à jour

```bash
cd /opt/stack/apps/sport && git pull
cd deploy && docker compose up -d --build
docker image prune -f                    # anciennes couches
```

Les nouvelles migrations et les évolutions du catalogue s'appliquent au redémarrage de l'API.

---

## 5. Sauvegarde et restauration

À sauvegarder : la base, et `deploy/.env`.

```bash
mkdir -p ~/backups
docker exec sport-db pg_dump -U sport -d sport -Fc > ~/backups/sport-$(date +%F).dump
```

```bash
docker exec -i sport-db pg_restore -U sport -d sport --clean --if-exists < ~/backups/sport-AAAA-MM-JJ.dump
docker compose restart api
```

`docker compose down` conserve le volume ; `docker compose down -v` **efface la base**.

---

## 6. Exploitation

| Besoin | Commande |
|---|---|
| Journaux de l'API (erreurs seulement en production) | `docker logs sport-api` |
| Requêtes HTTP, avec le compte SSO | `docker logs nginx` (nginx du stack) |
| Console SQL | `docker exec -it sport-db psql -U sport -d sport` |
| Effacer les données d'un compte (profil recréé vierge à sa prochaine visite) | `DELETE FROM users WHERE external_id = '<compte>';` |
| Rattacher à un compte un profil importé d'une base locale (le compte ne doit pas encore avoir de profil) | `UPDATE users SET external_id = '<compte>' WHERE external_id IS NULL;` |

---

## 7. Pièges

**502 Bad Gateway** — `sport-web` arrêté ou absent du réseau `web` : `docker compose ps`,
`docker network inspect web`.

**Réponse JSON `401 unauthenticated` au lieu de la page de connexion** — le vhost n'inclut pas
`authelia-authrequest.conf`, donc `Remote-User` n'arrive pas. Corriger le vhost, jamais l'API.

**L'API redémarre en boucle, `password authentication failed`** — `POSTGRES_PASSWORD` modifié
après la première initialisation : PostgreSQL garde le mot de passe d'origine dans le volume.
Remettre l'ancien, ou le changer en base (`ALTER USER sport PASSWORD '…'`).

**`AUTH_MODE invalide`** — faute de frappe dans l'environnement. L'API refuse de démarrer
plutôt que de retomber en mode local, où tous les comptes partageraient un seul profil.

**Le build échoue au téléchargement de pnpm** — corepack récupère pnpm sur npmjs.org : le
build a besoin d'un accès réseau sortant.

**Modèle de confiance** — comme toutes les applications du stack, `sport-web` accepte les
en-têtes `Remote-*` de quiconque l'atteint sur le réseau `web`. Un conteneur compromis sur ce
réseau pourrait usurper un compte : c'est la limite du forward auth du stack, pas propre à
cette application.
