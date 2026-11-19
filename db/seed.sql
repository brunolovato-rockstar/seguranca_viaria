-- Catálogo de analíticos (os 14 da câmera) e mapeamento dos códigos de evento.
-- Pode rodar de novo sem duplicar (INSERT ... ON DUPLICATE KEY UPDATE).

INSERT INTO analiticos (chave, nome, grupo, descricao, infracao, destaque) VALUES
 ('cinto',          'Condutor sem cinto',         'cond', 'Condutor sem cinto de segurança.', 1, 1),
 ('passageiro',     'Passageiro sem cinto',       'cond', 'Passageiro do banco dianteiro sem cinto.', 1, 1),
 ('celular',        'Uso de celular',             'cond', 'Condutor usando celular ao dirigir.', 1, 1),
 ('capacete',       'Sem capacete',               'moto', 'Motociclista ou garupa sem capacete.', 1, 1),
 ('sobrecarga',     'Sobrecarga de passageiros',  'moto', 'Mais ocupantes do que o permitido na moto.', 1, 0),
 ('fumar',          'Fumar ao dirigir',           'cond', 'Condutor fumando.', 1, 0),
 ('velocidade',     'Excesso de velocidade',      'circ', 'Acima do limite configurado.', 1, 0),
 ('devagar',        'Muito devagar',              'circ', 'Abaixo da velocidade mínima.', 1, 0),
 ('contramao',      'Contramão',                  'circ', 'Sentido oposto da faixa.', 1, 0),
 ('faixa',          'Mudança de faixa proibida',  'circ', 'Transposição de faixa contínua.', 1, 0),
 ('estacionamento', 'Estacionamento irregular',   'circ', 'Parada em local proibido.', 1, 0),
 ('naomotor',       'Veículo não motorizado',     'circ', 'Não motorizado em faixa proibida.', 1, 0),
 ('congest',        'Trânsito congestionado',     'traf', 'Fila ou congestionamento.', 0, 0),
 ('anpr',           'ANPR · leitura de placa',    'traf', 'Leitura de placa de todos os veículos.', 0, 0)
ON DUPLICATE KEY UPDATE nome=VALUES(nome), grupo=VALUES(grupo), descricao=VALUES(descricao), infracao=VALUES(infracao), destaque=VALUES(destaque);

-- Códigos do HTTP API (eventManager / snapManager) e do ITSAPI (ViolationType).
-- Se a câmera mandar um código que não está aqui, ele aparece em Diagnóstico > Eventos brutos;
-- basta incluir a linha correspondente.
INSERT INTO analitico_codigos (codigo, chave) VALUES
 ('TrafficJunction','anpr'), ('TrafficSnap','anpr'), ('Tollgate','anpr'), ('TrafficPassing','anpr'),
 ('TrafficOverSpeed','velocidade'), ('Overspeed','velocidade'),
 ('TrafficUnderSpeed','devagar'), ('UnderSpeed','devagar'),
 ('TrafficRetrograde','contramao'), ('Retrograde','contramao'),
 ('TrafficOverLine','faixa'), ('Overline','faixa'), ('TrafficCrossLane','faixa'), ('TrafficOverYellowLine','faixa'),
 ('TrafficParking','estacionamento'), ('TrafficStay','estacionamento'),
 ('TrafficWithoutSafeBelt','cinto'), ('TrafficPassengerWithoutSafeBelt','passageiro'),
 ('TrafficDriverCalling','celular'),
 ('TrafficDriverSmoking','fumar'),
 ('TrafficJam','congest'),
 ('TrafficNonMotorInMotorRoute','naomotor'), ('TrafficNonMotorOverload','sobrecarga'),
 ('TrafficNonMotorWithoutSafehat','capacete'), ('TrafficNonMotorWithoutSafeHat','capacete')
ON DUPLICATE KEY UPDATE chave=VALUES(chave);
