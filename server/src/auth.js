import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { q, one } from './db.js';

const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;

export function verifyToken(token) {
  try { return jwt.verify(token, config.jwtSecret); } catch { return null; }
}

/** Aceita "Authorization: Bearer" ou ?token= (necessário para <img src> do ao vivo). */
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores.' });
  next();
}

async function logAcesso(usuarioId, usuarioTxt, resultado, detalhe, req) {
  await q('INSERT INTO log_acesso (usuario_id, usuario_txt, resultado, detalhe, ip, user_agent) VALUES (?,?,?,?,?,?)', [
    usuarioId, usuarioTxt.slice(0, 60), resultado, detalhe, req.ip, String(req.headers['user-agent'] || '').slice(0, 300),
  ]);
}

export const authRouter = express.Router();

authRouter.post('/login', async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (!usuario || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });
  const u = await one('SELECT * FROM usuarios WHERE usuario=?', [usuario]);
  if (!u) {
    await logAcesso(null, usuario, 'falha', 'Usuário inexistente', req);
    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  }
  if (!u.ativo) {
    await logAcesso(u.id, usuario, 'bloqueio', 'Usuário inativo', req);
    return res.status(403).json({ erro: 'Usuário inativo. Procure o administrador.' });
  }
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
    await logAcesso(u.id, usuario, 'bloqueio', 'Tentativa durante bloqueio', req);
    return res.status(403).json({ erro: `Conta bloqueada por excesso de tentativas. Tente após ${new Date(u.bloqueado_ate).toLocaleTimeString('pt-BR')}.` });
  }
  const ok = await bcrypt.compare(senha, u.senha_hash);
  if (!ok) {
    const falhas = u.tentativas_falha + 1;
    if (falhas >= MAX_FALHAS) {
      await q(`UPDATE usuarios SET tentativas_falha=0, bloqueado_ate=DATE_ADD(NOW(), INTERVAL ${BLOQUEIO_MIN} MINUTE) WHERE id=?`, [u.id]);
      await logAcesso(u.id, usuario, 'bloqueio', `Bloqueado por ${BLOQUEIO_MIN} min após ${MAX_FALHAS} tentativas`, req);
      return res.status(403).json({ erro: `Conta bloqueada por ${BLOQUEIO_MIN} minutos.` });
    }
    await q('UPDATE usuarios SET tentativas_falha=? WHERE id=?', [falhas, u.id]);
    await logAcesso(u.id, usuario, 'falha', 'Senha incorreta', req);
    return res.status(401).json({ erro: `Usuário ou senha inválidos (${falhas}/${MAX_FALHAS}).` });
  }
  await q('UPDATE usuarios SET tentativas_falha=0, bloqueado_ate=NULL, ultimo_acesso=NOW() WHERE id=?', [u.id]);
  await logAcesso(u.id, usuario, 'sucesso', 'Login', req);
  const payload = { id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil };
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: req.body?.manter ? '7d' : '12h' });
  res.json({ token, usuario: payload });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await logAcesso(req.user.id, req.user.usuario, 'logout', 'Logout', req);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ usuario: req.user }));
