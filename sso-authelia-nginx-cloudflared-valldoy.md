# Déploiement SSO — Cloudflare Tunnel + nginx + Authelia

Domaine : `valldoy.com` (enregistré chez Namecheap, DNS chez Cloudflare)
Serveur : VPS Oracle Cloud, ARM64, 2 OCPU / 12 Go
Document de référence de l'état réel du serveur, destiné à un agent d'implémentation.

**Version 3 — 2026-10-06.** Remplace Authentik par Authelia. Le reste de l'architecture
(tunnel sortant Cloudflare, nginx, cookie sur le domaine parent) est inchangé depuis la v2.
Ancienne version : `sso-authentik-nginx-cloudflared-valldoy.md` (obsolète, conservée pour archive).

---

## 1. Objectif

Toute requête vers `*.valldoy.com` doit être authentifiée avant d'atteindre l'application.
Un utilisateur non connecté est redirigé vers `auth.valldoy.com`. Une fois connecté
(mot de passe + TOTP), il accède à tous les sous-domaines sans se reconnecter.

```
Navigateur → Cloudflare edge → tunnel sortant → cloudflared → nginx → application
                                                               ↓
                                                    Authelia (auth_request)
```

- **Cloudflare Tunnel** gère l'entrée réseau et le TLS. Aucun port n'est publié par la stack.
- **nginx + `auth_request`** interroge Authelia pour chaque requête : 200 laisse passer,
  401 redirige vers le portail.

**Point critique :** le cookie de session est posé sur le domaine parent `valldoy.com`
(`session.cookies[].domain` dans la config Authelia), pas sur le sous-domaine.
C'est la seule chose qui rend le SSO possible.

---

## 2. Pourquoi Authelia, et ce que cela coûte

| | Authentik (v2) | Authelia (v3) |
|---|---|---|
| Conteneurs | server, worker, PostgreSQL, Redis | un seul |
| RAM | ~1,3 Go | ~60 Mo au repos, ~170 Mo après des connexions (Argon2 réserve 64 Mo par hash) |
| Stockage | PostgreSQL + Redis | SQLite (`/config/db.sqlite3`) |
| Utilisateurs | interface web | fichier YAML `users_database.yml` |
| Droits par application | Policy bindings dans l'UI | règles `access_control` dans `configuration.yml` |

À savoir :

- **Pas d'interface d'administration.** Ajouter un utilisateur ou un groupe = éditer un fichier.
- **Sessions en mémoire** : redémarrer Authelia déconnecte tout le monde.
- **Pas de SMTP** sur ce serveur (le port 25 est bloqué par Oracle, aucun relais configuré).
  Les codes de vérification sont écrits dans `/opt/stack/authelia/notification.txt`.
- **Provider OIDC** : Authelia sait en faire un, mais il n'est pas configuré (aucune application
  n'en a besoin pour l'instant).

---

## 3. Contreparties acceptées (Cloudflare)

Validées avec l'utilisateur, inchangées. Ne pas les remettre en cause.

- **Cloudflare déchiffre le trafic** : le TLS se termine à leur edge.
- **Limite de 100 Mo par requête** (plan gratuit).
- **Timeout de 100 s** sur la réponse d'origine, au-delà erreur 524. WebSockets non concernés.
- **Un seul niveau de sous-domaine** couvert par le certificat : `chat.valldoy.com` oui,
  `api.chat.valldoy.com` non. Garder un nommage plat.
- **Point de défaillance unique** : si `cloudflared` tombe, tout est inaccessible, SSO compris.
  L'accès SSH direct par IP reste le filet de sécurité.

---

## 4. Environnement

| Élément | Valeur |
|---|---|
| Architecture | `aarch64` |
| OS | Ubuntu LTS |
| Utilisateur | `ubuntu`, uid/gid **1001** (utilisé par `PUID`/`PGID` d'Authelia) |
| Racine du stack | `/opt/stack` |
| Image Authelia | `authelia/authelia:4.39.28` (variable `AUTHELIA_TAG` dans `.env`) |

Secrets dans `/opt/stack/.env` (chmod 600), jamais versionnés :
`AUTHELIA_SESSION_SECRET`, `AUTHELIA_STORAGE_ENCRYPTION_KEY`, `AUTHELIA_JWT_SECRET`
(chacun `openssl rand -hex 32`), plus `DOMAIN`, `AUTH_HOST`, `TUNNEL_NAME`, `TUNNEL_UUID`.

**Ne jamais régénérer `AUTHELIA_STORAGE_ENCRYPTION_KEY`** : les secrets TOTP en base sont
chiffrés avec. La perdre = ré-enrôler tout le monde.

Aucun token d'API DNS : le tunnel s'authentifie avec son fichier de credentials.

---

## 5. Cloudflare (inchangé depuis la v2)

Le domaine reste enregistré chez Namecheap ; la zone DNS est déléguée à Cloudflare.

Tunnel `valldoy`, mode locally-managed. `/opt/stack/cloudflared/config.yml` :

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /etc/cloudflared/<TUNNEL_UUID>.json
originRequest:
  connectTimeout: 30s
  noTLSVerify: false
ingress:
  - service: http://nginx:80      # attrape-tout : nginx route par server_name
```

DNS (nuage ORANGE obligatoire, c'est lui qui route dans le tunnel) :

```
CNAME   @   <TUNNEL_UUID>.cfargotunnel.com   Proxied
CNAME   *   <TUNNEL_UUID>.cfargotunnel.com   Proxied
```

| Réglage Cloudflare | Valeur |
|---|---|
| SSL/TLS → Encryption mode | Full |
| Always Use HTTPS | Activé |
| Rocket Loader / Auto Minify | **Désactivés** |
| Cache Rules | « Bypass cache » sur toute la zone |
| Cloudflare Access | **Ne pas activer** (se superposerait à Authelia) |

---

## 6. Arborescence et docker-compose

```
/opt/stack/
├── .env
├── docker-compose.yml
├── cloudflared/        config.yml + <UUID>.json
├── authelia/           configuration.yml, users_database.yml, db.sqlite3, notification.txt
├── nginx/
│   ├── nginx.conf
│   ├── snippets/       authelia-location.conf, authelia-authrequest.conf, proxy.conf
│   └── sites/          000-default.conf, auth.conf, whoami.conf, <app>.conf
└── apps/
```

`docker-compose.yml` : services `cloudflared`, `nginx`, `authelia`, `whoami`, sur le seul
réseau externe `web` (`docker network create web`).

```yaml
  authelia:
    image: authelia/authelia:${AUTHELIA_TAG}
    container_name: authelia
    restart: unless-stopped
    environment:
      PUID: "1001"
      PGID: "1001"
      AUTHELIA_SESSION_SECRET: ${AUTHELIA_SESSION_SECRET}
      AUTHELIA_STORAGE_ENCRYPTION_KEY: ${AUTHELIA_STORAGE_ENCRYPTION_KEY}
      AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET: ${AUTHELIA_JWT_SECRET}
    volumes:
      - ./authelia:/config
    networks: [web]
```

**`PUID`/`PGID` sont indispensables.** Sans eux, l'entrypoint de l'image (démarré en root) fait
`chown -R 0:0 /config` : les fichiers deviennent illisibles pour `ubuntu` et le service tourne
en root. Avec eux, il chown vers 1001 puis abaisse ses privilèges.

**Règle absolue : aucune section `ports:` nulle part.** Un `ports:` rouvrirait une porte
d'entrée non authentifiée.

---

## 7. Configuration Authelia

`/opt/stack/authelia/configuration.yml` (validée par `authelia validate-config`) :

```yaml
theme: 'auto'
default_2fa_method: 'totp'

server:
  address: 'tcp://:9091/'
  endpoints:
    authz:
      auth-request:
        implementation: 'AuthRequest'

log:
  level: 'info'

totp:
  issuer: 'valldoy.com'

authentication_backend:
  file:
    path: '/config/users_database.yml'
    watch: true
    password:
      algorithm: 'argon2'

access_control:
  default_policy: 'deny'
  rules:
    - domain: ['valldoy.com', '*.valldoy.com']
      policy: 'two_factor'

session:
  name: 'authelia_session'
  same_site: 'lax'
  inactivity: '24h'
  expiration: '24h'
  remember_me: '1M'
  cookies:
    - domain: 'valldoy.com'
      authelia_url: 'https://auth.valldoy.com'

regulation:
  max_retries: 3
  find_time: '2m'
  ban_time: '5m'

storage:
  local:
    path: '/config/db.sqlite3'

notifier:
  filesystem:
    filename: '/config/notification.txt'
```

Comptes actuels (`users_database.yml`, hash argon2id) :

| Utilisateur | Groupe | TOTP |
|---|---|---|
| `akadmin` | `admins` | enrôlé par l'utilisateur à sa première connexion |
| `lautre` | `users` | migré depuis Authentik, même secret (SHA1, 6 chiffres, 30 s) |

Restreindre une application à un groupe : ajouter une règle **avant** la règle générale.

```yaml
    - domain: 'app.valldoy.com'
      policy: 'two_factor'
      subject: 'group:admins'
```

---

## 8. nginx

nginx n'écoute qu'en HTTP sur le réseau Docker. Ni certificat, ni `listen 443`.

### 8.1 `nginx.conf` — points propres au SSO

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;      # requis pour proxy_pass en variable

map $http_x_forwarded_proto $real_scheme {   # le client est toujours en HTTPS
    default https;
}

set_real_ip_from 172.16.0.0/12;
set_real_ip_from 10.0.0.0/8;
real_ip_header   CF-Connecting-IP;

log_format main '$remote_addr - $authelia_user [$time_local] "$request" $status $body_bytes_sent';
```

(La map complète conserve les trois entrées `default/http/https` → `https`, plus la map
`$http_connection` pour les WebSockets, voir le fichier réel.)

### 8.2 `snippets/authelia-location.conf` — niveau `server` des vhosts protégés

```nginx
set $upstream_authelia http://authelia:9091/api/authz/auth-request;

location /internal/authelia/authz {
    internal;
    proxy_pass $upstream_authelia;

    proxy_set_header X-Original-Method $request_method;
    proxy_set_header X-Original-URL    $real_scheme://$host$request_uri;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header Content-Length    "";
    proxy_set_header Connection        "";

    proxy_pass_request_body off;
    proxy_http_version 1.1;
}
```

`$real_scheme` et non `$scheme` : le tunnel livre du HTTP, Authelia construirait une URL de
retour en `http://` et la connexion boucle.

### 8.3 `snippets/authelia-authrequest.conf` — dans `location /` des vhosts protégés

```nginx
auth_request /internal/authelia/authz;

auth_request_set $authelia_user   $upstream_http_remote_user;
auth_request_set $authelia_groups $upstream_http_remote_groups;
auth_request_set $authelia_name   $upstream_http_remote_name;
auth_request_set $authelia_email  $upstream_http_remote_email;

proxy_set_header Remote-User   $authelia_user;
proxy_set_header Remote-Groups $authelia_groups;
proxy_set_header Remote-Name   $authelia_name;
proxy_set_header Remote-Email  $authelia_email;

auth_request_set $authelia_redirect $upstream_http_location;
error_page 401 =302 $authelia_redirect;
```

Les `proxy_set_header` écrasent toute valeur forgée par le client (testé : un visiteur non
authentifié envoyant `Remote-User: akadmin` reçoit un 302). Ne jamais les remplacer par
`proxy_pass_header`. Les applications lisent `Remote-User`, `Remote-Groups`, `Remote-Name`,
`Remote-Email` (et non plus `X-authentik-*`).

### 8.4 `sites/auth.conf` — portail, jamais protégé

```nginx
server {
    listen 80;
    server_name auth.valldoy.com;

    location / {
        set $upstream http://authelia:9091;
        proxy_pass $upstream;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Original-URL    $real_scheme://$host$request_uri;
        proxy_set_header X-Forwarded-Proto $real_scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-URI   $request_uri;
        proxy_set_header X-Forwarded-For   $remote_addr;
    }
}
```

- **Aucun `auth_request` ici**, sinon boucle de redirection infinie.
- **Pas d'`include proxy.conf`** : il fixe `X-Forwarded-For $proxy_add_x_forwarded_for`, qui
  conserve la valeur fournie par le client. Authelia l'utilise pour son anti-bruteforce :
  un attaquant pourrait changer d'IP à volonté en forgeant l'en-tête. Ici
  `$remote_addr` est l'IP réelle (`CF-Connecting-IP`, posée par Cloudflare).

### 8.5 Vhost protégé type (`sites/whoami.conf`) et vhost par défaut

```nginx
server {
    listen 80;
    server_name whoami.valldoy.com;

    include /etc/nginx/snippets/authelia-location.conf;

    location / {
        include /etc/nginx/snippets/authelia-authrequest.conf;

        set $upstream http://whoami:80;
        proxy_pass $upstream;
        include /etc/nginx/snippets/proxy.conf;
    }
}
```

`sites/000-default.conf` : `listen 80 default_server; server_name _; return 404;`
(le wildcard DNS fait atterrir tout sous-domaine inexistant sur nginx).

---

## 9. Gérer les utilisateurs

Authelia relit `users_database.yml` à chaud (`watch: true`), sans redémarrage.

**Générer un hash** (le mot de passe est saisi de façon masquée) :

```bash
docker run --rm -it authelia/authelia:4.39.28 authelia crypto hash generate argon2
```

**Ajouter un utilisateur** : nouvelle entrée dans `users_database.yml` avec `password:` (le
digest), `email:`, `displayname:`, `groups:`. Un email est obligatoire par utilisateur.
Éviter les caractères spéciaux dans l'identifiant (l'ancien compte `l'autre` est devenu `lautre`).

**Enrôler un TOTP / changer un mot de passe** : l'interface demande une vérification d'identité
(élévation de session). Le code est envoyé au notifier, donc écrit dans :

```bash
cat /opt/stack/authelia/notification.txt
```

**Réinitialiser le TOTP d'un utilisateur** :

```bash
docker exec authelia authelia storage user totp delete <user> --config /config/configuration.yml
```

Il se ré-enrôlera à sa prochaine connexion. Pour activer l'envoi par mail, remplacer le bloc
`notifier.filesystem` par `notifier.smtp` (relais sur le port 587 ou 465, jamais 25).

---

## 10. Validation

| # | Test | Résultat attendu |
|---|---|---|
| 1 | `docker ps` | `authelia` en `healthy`, `nginx`, `cloudflared` actifs |
| 2 | `dig +short auth.valldoy.com` | IP anycast Cloudflare (188.114.x.x), pas l'IP du VPS |
| 3 | `curl https://auth.valldoy.com/api/health` | `{"status":"OK"}` |
| 4 | `curl -I https://whoami.valldoy.com/` | 302 vers `https://auth.valldoy.com/?rd=https%3A%2F%2Fwhoami.valldoy.com%2F&rm=GET` |
| 5 | Idem avec `-H 'Remote-User: akadmin'` | toujours 302, jamais 200 |
| 6 | Connexion dans le navigateur | retour sur whoami, en-tête `Remote-User` visible |
| 7 | Cookie `authelia_session` | `Domain=valldoy.com`, `Secure`, `HttpOnly` |
| 8 | Second sous-domaine protégé | accès direct, sans nouveau login |
| 9 | `https://inexistant.valldoy.com` | 404 du vhost par défaut |
| 10 | `docker ps` colonne PORTS | aucune publication hôte pour `authelia`, `nginx`, `cloudflared` |

Remarque : un nginx **système** (service `nginx.service`, site « UFS Wiki ») écoute sur
`0.0.0.0:80` de l'hôte. Il est indépendant de cette stack. Son accessibilité depuis Internet
dépend de la Security List OCI et n'a pas été vérifiée.

---

## 11. Ajouter une application

1. Déployer le conteneur sur le réseau `web`, **sans `ports:`**
2. Copier `nginx/sites/whoami.conf` vers `nginx/sites/<app>.conf`, adapter `server_name`
   et `$upstream`
3. `docker exec nginx nginx -t && docker exec nginx nginx -s reload`

Rien à modifier côté Cloudflare (wildcard + ingress attrape-tout) ni côté Authelia
(la règle `*.valldoy.com` couvre tout), sauf pour une restriction par groupe (§7).

---

## 12. Pièges connus

**Boucle de redirection après login** — `$scheme` utilisé au lieu de `$real_scheme` dans un
snippet. Vérifier `X-Original-URL` aux deux endroits (§8.2, §8.4).

**Boucle de redirection sur `auth.valldoy.com`** — un `auth_request` s'est glissé dans `auth.conf`.

**Modifier `nginx.conf` ne prend pas effet / `nginx -t` échoue dans le conteneur** — `nginx.conf`
est monté comme *fichier unique* : une réécriture par remplacement change l'inode, et le
conteneur garde l'ancien. Les répertoires `snippets/` et `sites/` n'ont pas ce problème.
Recréer le conteneur : `docker compose up -d --force-recreate --no-deps nginx`
(`docker compose up -d` seul ne détecte pas le changement). Tester d'abord sans toucher à la
prod avec un nginx jetable :
`docker run --rm --network web -v /opt/stack/nginx/nginx.conf:/etc/nginx/nginx.conf:ro -v /opt/stack/nginx/snippets:/etc/nginx/snippets:ro -v /opt/stack/nginx/sites:/etc/nginx/sites:ro nginx:alpine nginx -t`

**`/opt/stack/authelia` devient `root:root`** — `PUID`/`PGID` absents du compose (§6).
Réparer en les ajoutant puis `docker compose up -d --no-deps authelia`.

**`tail` sur le journal nginx bloque** — dans l'image officielle, `access.log` est un lien vers
`/dev/stdout`. Utiliser `docker logs nginx`.

**Authelia ne démarre pas** — lire `docker logs authelia` ; valider la config avec
`docker run --rm -v /opt/stack/authelia:/config -e AUTHELIA_SESSION_SECRET=x -e AUTHELIA_STORAGE_ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxx -e AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET=x authelia/authelia:4.39.28 authelia validate-config --config /config/configuration.yml`
(valeurs factices : seule la syntaxe est contrôlée).

**Codes TOTP systématiquement refusés** — horloge du serveur décalée : vérifier `timedatectl`.

**Connexion bloquée quelques minutes** — `regulation` : 3 échecs en 2 minutes, ban de 5 minutes.

**Erreur 502 côté Cloudflare** — `cloudflared` ne joint pas nginx, ou nginx ne joint pas Authelia :
vérifier que les conteneurs sont sur le réseau `web`.

**Site qui ne répond pas alors que le tunnel est Healthy** — enregistrement DNS en nuage gris.

**Erreurs 524 / 413** — limites Cloudflare du plan gratuit (100 s / 100 Mo).

**Certificat invalide sur un sous-domaine à deux niveaux** — Universal SSL ne couvre qu'un niveau.

**Applications avec leur propre écran de connexion** — double authentification. Trois issues :
authentification par en-tête de confiance (`Remote-User`), OIDC Authelia si l'application le
supporte, ou accepter la double connexion.

**Clients non-navigateur (API, mobile, webhooks)** — le forward auth renvoie un 302 vers du HTML.
Soit un `location /api/` sans `auth_request` protégé par un token applicatif, soit les
stratégies d'authentification par en-tête d'Authelia (`authn_strategies` de l'endpoint
`auth-request`, non configurées ici, à étudier dans la documentation avant usage). Attention :
la politique actuelle est `two_factor`, qu'une authentification par en-tête ne peut pas satisfaire.

**WebSockets qui tombent après une minute** — map `$http_connection` ou timeouts longs absents
de `proxy.conf`.

**nginx refuse de démarrer si un conteneur amont est arrêté** — garder `resolver 127.0.0.11` et
`proxy_pass $upstream;` en variable. Ne jamais revenir à un `proxy_pass http://app:3000;` en dur.

---

## 13. Sauvegarde, retour arrière, reste à purger

**À sauvegarder** : `/opt/stack/authelia/` en entier (`db.sqlite3` = secrets TOTP chiffrés,
`users_database.yml`, `configuration.yml`), `.env` (notamment `AUTHELIA_STORAGE_ENCRYPTION_KEY`),
et `cloudflared/<UUID>.json` (non régénérable sans recréer le tunnel). Copie hors du VPS.

**Sauvegarde pré-migration** : `/home/ubuntu/backups/authentik-pre-authelia-2026-10-06/`
(chmod 700) — `authentik-db.sql.gz` (pg_dump complet) et `opt-stack.tar.gz` (l'ancien
`/opt/stack`, y compris compose, nginx et `.env`).

**Retour arrière vers Authentik** (tant que la purge ci-dessous n'a pas eu lieu) :

1. `cd /opt/stack && docker compose stop authelia`
2. Restaurer l'ancien `docker-compose.yml`, `nginx/nginx.conf`, `nginx/sites/*`,
   `nginx/snippets/authentik*.conf` depuis `opt-stack.tar.gz`
3. `docker start stack-postgresql-1 stack-redis-1 stack-authentik-server-1 stack-authentik-worker-1`
4. `docker compose up -d --force-recreate --no-deps nginx`

**Reste de l'ancienne installation, volontairement conservé** (en attente de validation
par l'utilisateur, à ne supprimer que sur sa demande explicite) :

- conteneurs arrêtés `stack-authentik-server-1`, `stack-authentik-worker-1`,
  `stack-postgresql-1`, `stack-redis-1`
- volumes `stack_database` et `stack_redis`, réseau `authentik`
- images `ghcr.io/goauthentik/server:2026.8.2`, `postgres:16-alpine`, `redis:alpine`
- dossiers `/opt/stack/media`, `/opt/stack/certs`, `/opt/stack/custom-templates` (vides)
- variables `AUTHENTIK_*`, `PG_*`, `SMTP_*` dans `.env`
