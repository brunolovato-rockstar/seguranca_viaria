#!/usr/bin/env bash
# Atualiza a aplicação a partir do GitHub e reinicia o serviço.
# Uso (no servidor):  sudo bash /opt/seguranca-viaria/deploy/linux/atualizar.sh
set -euo pipefail
APP=/opt/seguranca-viaria
USR=svapp
cd "$APP"
as() { sudo -u "$USR" -H "$@"; }

echo "→ Baixando atualizações do GitHub"
antes=$(as git rev-parse --short HEAD)
as git pull --ff-only
depois=$(as git rev-parse --short HEAD)
[ "$antes" = "$depois" ] && echo "  já estava na versão mais nova ($depois)" || as git log --oneline "$antes..$depois"

echo "→ Dependências do servidor"
(cd server && as npm ci --omit=dev --no-audit --no-fund)

echo "→ Compilando o site"
(cd web && as npm ci --no-audit --no-fund && as npm run build)

echo "→ Banco (tabelas e analíticos novos; não apaga dados)"
(cd server && as npm run db:init)

echo "→ Reiniciando o serviço"
# reinstala o arquivo do serviço (pega ajustes novos, ex.: permissão para a porta 80)
sed "s|^ExecStart=.*|ExecStart=$(command -v node) src/index.js|" "$APP/deploy/linux/seguranca-viaria.service" > /etc/systemd/system/seguranca-viaria.service
systemctl daemon-reload
systemctl restart seguranca-viaria
sleep 3
systemctl --no-pager --lines=5 status seguranca-viaria || true
echo "Pronto: versão $depois no ar."
