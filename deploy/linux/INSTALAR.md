# Instalar no servidor Linux

Testado em Ubuntu/Debian. Ajuste nomes de usuário e caminhos se quiser outros.

## 1. Pré-requisitos

```bash
sudo apt install -y mysql-server            # ou mariadb-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd -r -m -d /opt/seguranca-viaria -s /usr/sbin/nologin svapp
```

## 2. Copiar a aplicação

Copie a pasta `poc_seguranca_viaria` para `/opt/seguranca-viaria` (sem as pastas `node_modules`) e:

```bash
cd /opt/seguranca-viaria/server && sudo -u svapp npm ci --omit=dev
cd /opt/seguranca-viaria/web    && sudo -u svapp npm ci && sudo -u svapp npm run build
```

O `npm run build` gera `web/dist`; o servidor Node passa a entregar o site sozinho na porta 3001
(não precisa do `npm run dev` do web em produção).

## 3. Configurar `server/.env`

Copie o `.env` da máquina Windows e revise:

| Variável | Produção |
|---|---|
| `DB_USER` / `DB_PASSWORD` | um usuário só da aplicação (evite root) |
| `JWT_SECRET`, `CRYPTO_KEY` | **mantenha os mesmos** se for levar o banco junto (senha das câmeras é criptografada com o `CRYPTO_KEY`) |
| `CAM1_URL` | endereço da câmera pela VPN (ex.: `http://10.x.x.x`) |
| `RESTART_BY_EXIT=1` | libera o botão "Reiniciar servidor" (o systemd sobe de novo) |
| `VPN_RESTART_CMD` | ex.: `sudo -n /usr/bin/systemctl restart openvpn-client@pumatronix` |
| `VPN_STATUS_CMD` | ex.: `systemctl is-active openvpn-client@pumatronix; ip -brief addr show tun0` |

Depois: `cd /opt/seguranca-viaria/server && sudo -u svapp npm run db:init`

## 4. Serviço e VPN

```bash
sudo cp deploy/linux/seguranca-viaria.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now seguranca-viaria
sudo visudo -f /etc/sudoers.d/seguranca-viaria      # cole a linha da sua VPN (ver sudoers-seguranca-viaria)
```

Acesse `http://IP-DO-SERVIDOR:3001`. Em **Diagnóstico → Sistema e log** ficam o log ao vivo,
o teste de rede da câmera e os botões Reconectar câmeras / Reiniciar VPN / Reiniciar servidor.

Log também em `journalctl -u seguranca-viaria -f` e em `server/storage/logs/servidor-AAAA-MM-DD.log`.
