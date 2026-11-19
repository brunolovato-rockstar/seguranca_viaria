#!/usr/bin/env bash
# Instala e configura tudo no servidor Ubuntu (22.04/24.04): Node 22, MySQL, banco, .env,
# dependências, site compilado e serviço systemd. Pode rodar de novo: não apaga dados nem refaz o .env.
# Uso:  sudo bash /opt/seguranca-viaria/deploy/linux/instalar.sh
set -euo pipefail
APP=/opt/seguranca-viaria
USR=svapp
ENV=$APP/server/.env
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
as() { sudo -u "$USR" -H "$@"; }
passo() { echo; echo "=== $* ==="; }

passo "1/7 Pacotes (Node 22 e MySQL)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates openssl python3 >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v mysqld >/dev/null || apt-get install -y -qq mysql-server >/dev/null
systemctl enable --now mysql >/dev/null 2>&1 || systemctl enable --now mariadb >/dev/null 2>&1
echo "Node $(node -v) · $(mysql --version | awk '{print $2, $3}')"

passo "2/7 Usuário da aplicação ($USR)"
id "$USR" >/dev/null 2>&1 || useradd -r -m -d /opt/svapp -s /bin/bash "$USR"
chown -R "$USR:$USR" "$APP"
echo "ok"

passo "3/7 Banco seguranca_viaria"
if [ -f "$ENV" ] && grep -q '^DB_USER=svapp$' "$ENV"; then
  SENHA_DB=$(grep '^DB_PASSWORD=' "$ENV" | cut -d= -f2-)
  echo "Usando a senha do banco que já está no .env"
else
  SENHA_DB=$(openssl rand -hex 16)
fi
mysql <<SQL
CREATE DATABASE IF NOT EXISTS seguranca_viaria CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'svapp'@'localhost' IDENTIFIED BY '$SENHA_DB';
ALTER USER 'svapp'@'localhost' IDENTIFIED BY '$SENHA_DB';
GRANT ALL ON seguranca_viaria.* TO 'svapp'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "ok (usuário do banco: svapp)"

passo "4/7 Configuração (server/.env)"
set_env() { # grava/atualiza CHAVE=valor no .env sem problema com caracteres especiais
  python3 - "$ENV" "$1" "$2" <<'PY'
import re, sys
f, k, v = sys.argv[1:4]
s = open(f, encoding='utf-8').read()
linha = f"{k}={v}"
s = re.sub(rf'(?m)^{re.escape(k)}=.*$', lambda m: linha, s) if re.search(rf'(?m)^{re.escape(k)}=', s) else s.rstrip('\n') + '\n' + linha + '\n'
open(f, 'w', encoding='utf-8').write(s)
PY
}
if [ ! -f "$ENV" ]; then
  as cp "$APP/server/.env.example" "$ENV"
  echo "Responda (Enter aceita o valor entre colchetes):"
  read -rsp "  Senha do usuário admin do sistema (login na web): " ADMIN_PW; echo
  read -rp  "  Endereço da câmera visto DESTE servidor [http://localhost:63519]: " CAM_URL
  read -rp  "  Usuário da câmera [admin]: " CAM_USER
  read -rsp "  Senha da câmera: " CAM_PW; echo
  read -rp  "  Chave pública do Mapbox (pk..., Enter para pular): " MAPBOX
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env CRYPTO_KEY "$(openssl rand -hex 32)"
  set_env DB_USER svapp
  set_env DB_PASSWORD "$SENHA_DB"
  set_env ADMIN_PASSWORD "${ADMIN_PW:-admin123}"
  set_env CAM1_URL "${CAM_URL:-http://localhost:63519}"
  set_env CAM1_USER "${CAM_USER:-admin}"
  set_env CAM1_PASSWORD "$CAM_PW"
  set_env MAPBOX_TOKEN "$MAPBOX"
  set_env RESTART_BY_EXIT 1
  echo "  .env criado"
else
  set_env DB_PASSWORD "$SENHA_DB"
  echo "  .env já existia: mantido (edite com: sudo -u $USR nano $ENV)"
fi
chown "$USR:$USR" "$ENV"; chmod 600 "$ENV"

passo "5/7 Dependências e site"
(cd "$APP/server" && as npm ci --omit=dev --no-audit --no-fund --loglevel=error)
(cd "$APP/web" && as npm ci --no-audit --no-fund --loglevel=error && as npm run build --silent)
echo "ok (site em web/dist)"

passo "6/7 Tabelas, analíticos, admin e CAM-01"
(cd "$APP/server" && as npm run db:init --silent)

passo "7/7 Serviço seguranca-viaria"
sed "s|^ExecStart=.*|ExecStart=$(command -v node) src/index.js|" "$APP/deploy/linux/seguranca-viaria.service" > /etc/systemd/system/seguranca-viaria.service
systemctl daemon-reload
systemctl enable seguranca-viaria >/dev/null 2>&1
systemctl restart seguranca-viaria
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then ufw allow 3001/tcp >/dev/null && echo "Firewall: porta 3001 liberada"; fi
sleep 4
if curl -fsS localhost:3001/api/health >/dev/null; then
  IP=$(hostname -I | awk '{print $1}')
  echo
  echo "PRONTO: http://$IP:3001   (usuário admin)"
  echo "Log: sudo journalctl -u seguranca-viaria -f   ou na tela Diagnóstico → Sistema e log"
else
  echo "O serviço não respondeu. Últimas linhas do log:"
  journalctl -u seguranca-viaria -n 30 --no-pager
  exit 1
fi
