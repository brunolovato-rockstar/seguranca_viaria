# POC Segurança Viária — plano por fases

Sistema Pumatronix de segurança viária usando câmera com IA embarcada (cinto, celular, capacete e demais analíticos).
Stack: **React (Vite) + Node (Express) + MySQL**. Protótipo de referência visual: `prototipo/seguranca-viaria-prototipo.html`.

```
Câmera ──(túnel :80)──► Node ──► MySQL + pasta storage/ (imagens)
  │  HTTP API (CGI, Digest)        │
  │  • snapshot / MJPEG ───────────┼──► React: Ao Vivo
  │  • fluxo de eventos ───────────┼──► WebSocket: detecções em tempo real
  │                                │
  └─ ITSAPI push (fase 2) ─────────┘   (a câmera faz POST /NotificationInfo/*)
```

## Fase 1 — Base + câmera ao vivo pela API ✅ (esta entrega)
- Modelos no MySQL (`db/schema.sql`): usuários, log de acesso, câmeras, catálogo de analíticos + mapeamento de códigos,
  eventos, imagens, histórico do registro, eventos brutos.
- Login com usuário/senha (bcrypt + JWT), bloqueio após 5 tentativas, **log de acesso**.
- Cadastro de câmeras (URL, usuário/senha criptografada, finalidade, analíticos, localização) e **Testar conexão**
  (lê modelo, série, firmware, hora da câmera).
- **Ao Vivo pela API**: snapshot em sequência (1–8 fps, com cache no servidor) ou MJPEG.
- **Eventos pela API**: fluxo `snapManager attachFileProc` (texto + imagem) ou `eventManager attach` (texto + snapshot),
  com reconexão automática; grava bruto, registro, imagens e histórico; empurra para o front por WebSocket.
- Registros com filtros, **validação com assinatura do usuário**, **correção de placa** e **log de alterações**.
- **Diagnóstico**: estado da conexão e tudo o que a câmera mandou (para descobrir códigos ainda não mapeados).
- Receptor **ITSAPI** já pronto (`/NotificationInfo/DeviceInfo, KeepAlive, TollgateInfo, TrafficViolationInfo`).
- Câmera simulada (`npm run mock`) e teste de linha de comando (`npm run camera:test`).

## Fase 2 — Operação completa
- Tela **Captura Ao Vivo** (faixa de dados + imagens + últimas detecções), como no protótipo.
- **Mapa** com a posição das câmeras (Leaflet + OpenStreetMap, usando latitude/longitude do cadastro).
- Ativar **ITSAPI push** com a câmera alcançando o servidor (IP público, VPN ou túnel reverso) e comparar com o HTTP API.
- Tela para editar o mapeamento código → analítico; descarte de falso positivo com motivo.
- Exportação CSV/ZIP (com imagens) e prazo de retenção (LGPD).

## Fase 3 — Vídeo de verdade (adiantado: botão "Vídeo" já integrado ao go2rtc)
- Liberar a porta **554 (RTSP)** no túnel e colocar um gateway (go2rtc ou MediaMTX) convertendo RTSP → WebRTC.
- Ao Vivo com vídeo em baixa latência; snapshot continua como plano B.
- Opção **SDK nativo** (porta 37777) via serviço auxiliar, se a API HTTP não cobrir algum evento.

## Fase 4 — Envio à PRF
- Conector REST (formato e autenticação a definir) consumindo a fila (`status_prf = 'fila'`),
  com reenvio automático e protocolo de retorno gravado no histórico do registro.

## Portas da câmera (padrão de fábrica)
| Serviço | Porta | Uso no sistema |
|---|---|---|
| HTTP (interface web e API CGI) | 80 | **Fase 1** — túnel em `http://localhost:63519` |
| HTTPS | 443 | opcional |
| TCP (SDK) | 37777 | fase 3 (SDK nativo) |
| RTSP (vídeo) | 554 | fase 3 (vídeo ao vivo) |
| SSH | 22 | não usado |

IP de fábrica: `192.168.1.108`, usuário `admin` (senha criada no primeiro acesso).

## Pontos de atenção
- Pelo túnel só a porta 80 chega até a câmera: por isso a fase 1 usa **somente a API HTTP** (o servidor busca).
  O **ITSAPI** é o contrário (a câmera envia para o servidor) e só funciona quando a câmera alcança este PC.
- Os nomes dos códigos de evento variam com o firmware. Tudo que chega fica em **Diagnóstico**;
  se aparecer “sem mapeamento”, inclua o código em `analitico_codigos`.
- As coordenadas `BoundingBox` da câmera vêm na escala 0–8191 (padrão do protocolo); o front converte para %.
