-- Banco e usuário da POC Segurança Viária (MySQL 8 / MariaDB)
-- Rode como administrador do MySQL, por exemplo:
--   PowerShell:  cmd /c "mysql -u root -p < db\criar-banco.sql"
--   ou abra no MySQL Workbench e execute.
-- Depois: cd server && npm run db:init   (cria as tabelas, analíticos, admin e CAM-01)

CREATE DATABASE IF NOT EXISTS seguranca_viaria CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Usuário da aplicação = root / senha root (ambiente local de desenvolvimento).
-- Se o root do seu MySQL já tem outra senha, esta linha passa a senha para "root":
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
FLUSH PRIVILEGES;
