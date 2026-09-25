import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Formato: scrypt$N$r$p$salt(base64)$hash(base64)
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(password), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) {
    // Mantém tempo de resposta parecido quando o usuário não existe
    await scryptAsync(String(password), 'dummy-salt-0000', KEYLEN, PARAMS);
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export const PASSWORD_MIN = 6;

export function checkNewPassword(pw) {
  const s = String(pw ?? '');
  if (s.length < PASSWORD_MIN) return `A senha deve ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (s.length > 128) return 'Senha muito longa.';
  return null;
}

// Regras de sessão
export const SESSION = {
  normal: { absoluteMs: 12 * 3600e3, idleMs: 4 * 3600e3 },
  remember: { absoluteMs: 30 * 24 * 3600e3, idleMs: 7 * 24 * 3600e3 },
};

// Proteção contra força bruta
export const LOCKOUT = {
  maxAttempts: 5,
  lockMs: 15 * 60e3,
  ipWindowMs: 15 * 60e3,
  ipMaxFailures: 20,
};

export function cookieName(secure) {
  // __Host- impede que o cookie seja definido por subdomínios (exige https)
  return secure ? '__Host-rdm_sess' : 'rdm_sess';
}

export function sessionCookie(token, { secure, remember }) {
  const parts = [`${cookieName(secure)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  if (remember) parts.push(`Max-Age=${Math.floor(SESSION.remember.absoluteMs / 1000)}`);
  return parts.join('; ');
}

export function clearCookie(secure) {
  const parts = [`${cookieName(secure)}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
