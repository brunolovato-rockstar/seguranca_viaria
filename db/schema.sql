-- =====================================================================
-- POC Segurança Viária · modelo de dados inicial (MySQL 8 / MariaDB 10.6+)
-- Executado por: server> npm run db:init   (cria o banco se não existir)
-- =====================================================================

-- ---------- Usuários e acesso ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario          VARCHAR(60)  NOT NULL UNIQUE,
  nome             VARCHAR(120) NOT NULL,
  email            VARCHAR(160) NULL,
  senha_hash       VARCHAR(100) NOT NULL,
  perfil           ENUM('admin','operador') NOT NULL DEFAULT 'operador',
  ativo            TINYINT(1)   NOT NULL DEFAULT 1,
  tentativas_falha INT          NOT NULL DEFAULT 0,
  bloqueado_ate    DATETIME     NULL,
  ultimo_acesso    DATETIME     NULL,
  criado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS log_acesso (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NULL,
  usuario_txt VARCHAR(60)  NOT NULL,
  resultado   ENUM('sucesso','falha','bloqueio','logout') NOT NULL,
  detalhe     VARCHAR(200) NULL,
  ip          VARCHAR(64)  NULL,
  user_agent  VARCHAR(300) NULL,
  criado_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_log_acesso_data (criado_em),
  CONSTRAINT fk_log_acesso_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Analíticos (catálogo) ----------
CREATE TABLE IF NOT EXISTS analiticos (
  chave     VARCHAR(30)  PRIMARY KEY,           -- ex.: cinto, celular, capacete
  nome      VARCHAR(80)  NOT NULL,
  grupo     ENUM('cond','moto','circ','traf') NOT NULL,
  descricao VARCHAR(200) NULL,
  infracao  TINYINT(1)   NOT NULL DEFAULT 1,    -- 0 = só informativo (ANPR, congestionamento)
  destaque  TINYINT(1)   NOT NULL DEFAULT 0,
  ativo     TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Código que a câmera envia  ->  analítico do sistema (editável, sem mexer no código)
CREATE TABLE IF NOT EXISTS analitico_codigos (
  codigo VARCHAR(80) PRIMARY KEY,               -- ex.: TrafficWithoutSafeBelt
  chave  VARCHAR(30) NOT NULL,
  CONSTRAINT fk_cod_analitico FOREIGN KEY (chave) REFERENCES analiticos(chave) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Câmeras ----------
CREATE TABLE IF NOT EXISTS cameras (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo       VARCHAR(20)  NOT NULL UNIQUE,     -- CAM-01
  nome         VARCHAR(120) NOT NULL,
  finalidade   ENUM('interior','moto','via','ocr','custom') NOT NULL DEFAULT 'custom',
  url_base     VARCHAR(200) NOT NULL,            -- http://localhost:63519 (túnel) ou http://192.168.1.108
  usuario      VARCHAR(60)  NOT NULL DEFAULT 'admin',
  senha_enc    VARCHAR(300) NULL,                -- AES-256-GCM (chave no .env)
  acesso       ENUM('http_api','sdk','itsapi_push') NOT NULL DEFAULT 'http_api',
  modo_eventos ENUM('attachFileProc','eventManager','desligado') NOT NULL DEFAULT 'attachFileProc',
  canal        INT          NOT NULL DEFAULT 1,
  faixas       INT          NOT NULL DEFAULT 2,
  rtsp_url     VARCHAR(300) NULL,
  device_id    VARCHAR(80)  NULL,                -- DeviceID enviado pelo ITSAPI (push)
  modelo       VARCHAR(80)  NULL,
  serial       VARCHAR(80)  NULL,
  firmware     VARCHAR(120) NULL,
  rodovia      VARCHAR(40)  NULL,
  km           DECIMAL(7,1) NULL,
  pista        ENUM('N','S','L','O') NULL,
  latitude     DECIMAL(10,6) NULL,
  longitude    DECIMAL(10,6) NULL,
  ativo        TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX ix_cam_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS camera_analiticos (
  camera_id INT UNSIGNED NOT NULL,
  chave     VARCHAR(30)  NOT NULL,
  PRIMARY KEY (camera_id, chave),
  CONSTRAINT fk_ca_camera FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE,
  CONSTRAINT fk_ca_analitico FOREIGN KEY (chave) REFERENCES analiticos(chave) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- Eventos / registros ----------
CREATE TABLE IF NOT EXISTS eventos (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  camera_id        INT UNSIGNED NULL,
  chave            VARCHAR(30)  NULL,              -- analítico (NULL = código sem mapeamento)
  codigo_origem    VARCHAR(80)  NOT NULL,          -- código original da câmera
  origem           ENUM('http_api','itsapi','mock') NOT NULL,
  ocorrido_em      DATETIME(3)  NOT NULL,
  recebido_em      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  placa            VARCHAR(12)  NULL,
  placa_ocr        VARCHAR(12)  NULL,              -- leitura original quando corrigida
  placa_confianca  INT          NULL,
  placa_cor        VARCHAR(20)  NULL,
  tipo_veiculo     VARCHAR(40)  NULL,
  marca            VARCHAR(40)  NULL,
  modelo           VARCHAR(60)  NULL,
  cor_veiculo      VARCHAR(30)  NULL,
  velocidade       INT          NULL,
  faixa            INT          NULL,
  sentido          VARCHAR(20)  NULL,
  bbox             JSON         NULL,              -- [x1,y1,x2,y2] normalizado 0..8191 (padrão Dahua)
  dados            JSON         NULL,              -- campos extras do evento
  status_validacao ENUM('aguardando','validado','descartado') NOT NULL DEFAULT 'aguardando',
  validado_por     INT UNSIGNED NULL,
  validado_em      DATETIME     NULL,
  status_prf       ENUM('na','aguardando','fila','enviado','erro') NOT NULL DEFAULT 'aguardando',
  INDEX ix_ev_data (ocorrido_em),
  INDEX ix_ev_camera (camera_id, ocorrido_em),
  INDEX ix_ev_placa (placa),
  INDEX ix_ev_val (status_validacao),
  CONSTRAINT fk_ev_camera FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
  CONSTRAINT fk_ev_analitico FOREIGN KEY (chave) REFERENCES analiticos(chave) ON DELETE SET NULL,
  CONSTRAINT fk_ev_validador FOREIGN KEY (validado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evento_imagens (
  id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evento_id BIGINT UNSIGNED NOT NULL,
  tipo      ENUM('evento','placa','veiculo','composta','rosto','outro') NOT NULL DEFAULT 'evento',
  caminho   VARCHAR(300) NOT NULL,                 -- relativo a STORAGE_DIR
  bytes     INT          NULL,
  CONSTRAINT fk_img_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Histórico de cada registro (validação, correção de placa, envio PRF...)
CREATE TABLE IF NOT EXISTS evento_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evento_id   BIGINT UNSIGNED NOT NULL,
  usuario_id  INT UNSIGNED NULL,
  usuario_txt VARCHAR(60)  NOT NULL DEFAULT 'sistema',
  acao        VARCHAR(60)  NOT NULL,
  detalhe     VARCHAR(300) NULL,
  motivo      VARCHAR(120) NULL,
  criado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX ix_evlog_evento (evento_id),
  INDEX ix_evlog_data (criado_em),
  CONSTRAINT fk_evlog_evento FOREIGN KEY (evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  CONSTRAINT fk_evlog_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tudo o que chega da câmera, cru (para descobrir códigos e depurar a integração)
CREATE TABLE IF NOT EXISTS eventos_brutos (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  camera_id   INT UNSIGNED NULL,
  origem      ENUM('http_api','itsapi','mock') NOT NULL,
  codigo      VARCHAR(80)  NULL,
  recebido_em DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  imagens     INT          NOT NULL DEFAULT 0,
  payload     MEDIUMTEXT   NULL,
  evento_id   BIGINT UNSIGNED NULL,
  erro        VARCHAR(300) NULL,
  INDEX ix_bruto_data (recebido_em),
  CONSTRAINT fk_bruto_camera FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
