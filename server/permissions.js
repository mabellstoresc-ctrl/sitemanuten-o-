import { MODULES, MODULE_KEYS, moduleActions } from '../shared/constants.js';
import { forbidden, badRequest } from './http.js';

/** user.permissions: { modulo: ['ver', 'editar', ...] } */
export function can(user, module, action) {
  if (!user) return false;
  if (user.is_master) return true;
  return Boolean(user.permissions?.[module]?.includes(action));
}

export function requirePerm(user, module, action) {
  if (!can(user, module, action)) throw forbidden();
}

export function requireAny(user, pairs) {
  if (!pairs.some(([m, a]) => can(user, m, a))) throw forbidden();
}

export async function loadPermissions(db, userId) {
  const { rows } = await db.query('select module, actions from user_permissions where user_id = $1', [userId]);
  const out = {};
  for (const r of rows) if (r.actions.length) out[r.module] = r.actions;
  return out;
}

/** Normaliza o objeto recebido: remove módulos/ações inexistentes e duplicados. */
export function sanitizePermissions(input) {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest('Permissões inválidas.');
  const out = {};
  for (const [mod, acts] of Object.entries(input)) {
    if (!MODULE_KEYS.includes(mod)) continue;
    if (!Array.isArray(acts)) throw badRequest('Permissões inválidas.');
    const allowed = moduleActions(mod);
    const clean = [...new Set(acts.map(String))].filter((a) => allowed.includes(a));
    // Qualquer ação implica poder visualizar
    if (clean.length && !clean.includes('ver')) clean.unshift('ver');
    if (clean.length) out[mod] = allowed.filter((a) => clean.includes(a));
  }
  return out;
}

/** Um usuário que não é o Administrador Principal só pode conceder o que ele mesmo tem. */
export function assertCanGrant(actor, perms) {
  if (actor.is_master) return;
  for (const [mod, acts] of Object.entries(perms)) {
    for (const a of acts) {
      if (!can(actor, mod, a)) {
        const label = MODULES.find((m) => m.key === mod)?.label || mod;
        throw forbidden(`Você não pode conceder a permissão "${a}" em "${label}" porque não a possui.`);
      }
    }
  }
}

export async function savePermissions(db, userId, perms) {
  await db.query('delete from user_permissions where user_id = $1', [userId]);
  for (const [mod, acts] of Object.entries(perms)) {
    await db.query('insert into user_permissions (user_id, module, actions) values ($1, $2, $3)', [userId, mod, acts]);
  }
}
