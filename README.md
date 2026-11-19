# POC Segurança Viária · Pumatronix

React + Node + MySQL, com a câmera conectada pela **API HTTP** (túnel na porta 80).
Plano completo por fases: [`docs/PLANO.md`](docs/PLANO.md) · Protótipo visual: [`prototipo/seguranca-viaria-prototipo.html`](prototipo/seguranca-viaria-prototipo.html)

```
poc_seguranca_viaria/
├─ db/          schema.sql (modelos) e seed.sql (analíticos + códigos da câmera)
├─ server/      API Node (Express, mysql2, WebSocket) + integração com a câmera
│  ├─ src/dahua/      cliente HTTP com Digest, fluxo de eventos, ITSAPI (push)
│  ├─ src/services/   conexão por câmera (reconexão) e gravação dos eventos
│  └─ scripts/        db-init, camera-test, mock-camera
├─ web/         React (Vite) — login, Ao Vivo, Registros, Câmeras, Diagnóstico…
├─ docs/        PLANO.md
└─ prototipo/   HTML de referência
```

## Pré-requisitos
- Node 20 ou mais novo (`node -v`)
- MySQL 8 (ou MariaDB 10.6+) rodando na máquina

## 1. Primeiro teste da câmera (sem banco, sem tela)
Com o túnel aberto (`http://localhost:63519`):

```powershell
cd server
npm install
npm run camera:test -- http://localhost:63519 admin SENHA_DA_CAMERA 60
```
Mostra modelo, série e firmware, salva `snapshot-teste.jpg` e escuta os eventos por 60 s
(primeiro `attachFileProc`, depois `eventManager`). Passe um carro / provoque uma detecção.

## 2. Banco e API
Banco da aplicação: **seguranca_viaria** · usuário **root** / senha **root** (já configurado em `server\.env`).

Se o root do seu MySQL ainda não usa a senha `root`, rode uma vez (pede a senha atual do root):
```powershell
cmd /c "mysql -u root -p < db\criar-banco.sql"
```
No `server\.env`, preencha só a senha da câmera em `CAM1_PASSWORD`. Depois:

```powershell
cd server
npm run db:init     # cria as tabelas no seguranca_viaria, analíticos, usuário admin e a CAM-01 (túnel)
npm run dev         # API em http://localhost:3001 (reinicia sozinha ao salvar arquivo)
```

## 3. Front
Em outro terminal:
```powershell
cd web
npm install
npm run dev         # http://localhost:5173
```
Entre com `admin / admin123` (ou o que estiver no `.env`).

## Sem a câmera? Use a simulada
```powershell
cd server
npm run mock                                   # câmera falsa em http://127.0.0.1:8099 (admin / mock123)
npm run mock -- --push http://localhost:3001   # também envia pushes ITSAPI para a API
```
Cadastre (ou edite a CAM-01) com a URL `http://127.0.0.1:8099`.

## Vídeo ao vivo (RTSP) — botão "Vídeo" no Ao Vivo
Snapshot e MJPEG passam pela porta 80. Vídeo de verdade (H.264) vem pelo **RTSP, porta 554**, e o navegador não toca RTSP direto:
o **go2rtc** converte para WebRTC.

1. **Túnel da porta 554** da câmera para uma porta local livre, por exemplo `localhost:63554`.
2. **go2rtc**: baixe `go2rtc_win64.zip` em https://github.com/AlexxIT/go2rtc/releases, extraia o `go2rtc.exe` na pasta `video\` e rode:
   ```powershell
   cd video
   .\go2rtc.exe
   ```
3. Na câmera, confira **URL RTSP** em Câmeras → Editar (padrão já preenchido pelo `db:init`):
   `rtsp://localhost:63554/cam/realmonitor?channel=1&subtype=0` (sem usuário/senha — o servidor coloca os da câmera).
4. No Ao Vivo, clique em **Vídeo**.

Dicas: o stream principal da câmera precisa estar em **H.264** (H.265 não toca em WebRTC no navegador);
se estiver em H.265, use `subtype=1` (substream) em H.264. Sem o túnel 554, use **MJPEG**: configure o
substream da câmera com codificação MJPEG e ele passa pela porta 80.

## O que conversa com a câmera (fase 1)
| Função | Chamada na câmera |
|---|---|
| Testar conexão | `GET /cgi-bin/magicBox.cgi?action=getSystemInfo` · `getSoftwareVersion` · `getDeviceType` · `global.cgi?action=getCurrentTime` |
| Ao vivo (snapshot) | `GET /cgi-bin/snapshot.cgi?channel=1` |
| Ao vivo (MJPEG) | `GET /cgi-bin/mjpg/video.cgi?channel=1&subtype=1` (substream precisa estar em MJPEG) |
| Eventos com imagem | `GET /cgi-bin/snapManager.cgi?action=attachFileProc&Flags[0]=Event&Events=[All]&heartbeat=5` |
| Eventos só texto | `GET /cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=5` |
| ITSAPI (fase 2) | a câmera faz `POST /NotificationInfo/TollgateInfo` e `/TrafficViolationInfo` nesta API |

Autenticação Digest (RFC 2617), como manda o protocolo. Senhas das câmeras ficam criptografadas (AES-256-GCM) no banco.

## Produção (um processo só)
```powershell
cd web && npm run build
cd ../server && npm start      # serve a API e o front em http://localhost:3001
```
