# Instalar no servidor Linux

Testado em Ubuntu/Debian. Ajuste nomes de usuário e caminhos se quiser outros.

**Caminho rápido** (depois do clone do passo 2): um script faz os passos 1, 3, 4 e 5 sozinho —
instala Node 22 e MySQL, cria banco e usuário, gera o `.env` (pergunta senhas e endereço da câmera),
compila o site, cria as tabelas e liga o serviço:

```bash
sudo bash /opt/seguranca-viaria/deploy/linux/instalar.sh
```

O passo a passo manual abaixo faz o mesmo, caso prefira.

## 1. Pré-requisitos

```bash
sudo apt install -y git mysql-server            # ou mariadb-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd -r -m -d /opt/svapp -s /bin/bash svapp     # usuário que roda a aplicação
sudo mkdir -p /opt/seguranca-viaria && sudo chown svapp:svapp /opt/seguranca-viaria
```

## 2. Acesso do servidor ao GitHub (chave de implantação, só leitura)

```bash
sudo -u svapp ssh-keygen -t ed25519 -N "" -f /opt/svapp/.ssh/id_ed25519 -C "servidor-seguranca-viaria"
sudo cat /opt/svapp/.ssh/id_ed25519.pub
```

No GitHub (conta dona do repositório): **seguranca_viaria → Settings → Deploy keys → Add deploy key**,
cole a chave e **deixe "Allow write access" desmarcado** (o servidor só baixa, nunca envia).

```bash
sudo -u svapp git clone git@github.com:brunolovato-rockstar/seguranca_viaria.git /opt/seguranca-viaria
cd /opt/seguranca-viaria/server && sudo -u svapp npm ci --omit=dev
cd /opt/seguranca-viaria/web    && sudo -u svapp npm ci && sudo -u svapp npm run build
```

Na primeira conexão o ssh pergunta se confia em github.com: responda `yes`.
O `npm run build` gera `web/dist`; o servidor Node entrega o site sozinho na porta 3001
(em produção não se usa o `npm run dev` do web).

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

O `.env` não está no GitHub: copie o da máquina Windows para `/opt/seguranca-viaria/server/.env`
(`sudo chown svapp:svapp` nele e `chmod 600`).

Depois: `cd /opt/seguranca-viaria/server && sudo -u svapp npm run db:init`

## 4. Serviço e VPN

```bash
sudo cp /opt/seguranca-viaria/deploy/linux/seguranca-viaria.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now seguranca-viaria
sudo visudo -f /etc/sudoers.d/seguranca-viaria      # cole a linha da sua VPN (ver sudoers-seguranca-viaria)
```

Acesse `http://IP-DO-SERVIDOR:3001`. Em **Diagnóstico → Sistema e log** ficam o log ao vivo,
o teste de rede da câmera e os botões Reconectar câmeras / Reiniciar VPN / Reiniciar servidor.

Log também em `journalctl -u seguranca-viaria -f` e em `server/storage/logs/servidor-AAAA-MM-DD.log`.

## 5. Atualizar depois (a cada push no GitHub)

```bash
sudo bash /opt/seguranca-viaria/deploy/linux/atualizar.sh
```

Faz `git pull`, instala dependências, compila o site, aplica novidades do banco (`db:init`, não apaga dados)
e reinicia o serviço. O `.env`, as fotos e os logs não são tocados (estão fora do Git).
