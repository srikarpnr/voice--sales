import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export function login(email, password) {
  const valid = email === process.env.ADMIN_EMAIL && sameSecret(password, process.env.ADMIN_PASSWORD);
  return valid ? jwt.sign({ sub: email }, process.env.JWT_SECRET, { expiresIn: '12h' }) : null;
}

// Returns null for a missing, expired or forged token.
export function verifyToken(token) {
  try {
    return jwt.verify(token ?? '', process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Please log in again' });
  next();
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
