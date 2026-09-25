import { randomUUID } from 'node:crypto';
import { badRequest, notFound, HttpError } from '../http.js';
import { requirePerm } from '../permissions.js';
import { audit, vehicleEvent } from '../audit.js';
import { putObject, getObject, sniffMime, EXT } from '../storage.js';
import { UPLOAD_MAX_BYTES, UPLOAD_MIME } from '../../shared/constants.js';

// Cada tipo de registro que aceita anexos: tabela e módulo de permissão.
// Novas fases adicionam entradas aqui (abastecimento, manutenção, pneu, documento...).
export const ENTITIES = {
  vehicle: { table: 'vehicles', module: 'veiculos', label: 'plate' },
  driver: { table: 'drivers', module: 'motoristas', label: 'full_name' },
};

const CATEGORIES = ['foto', 'documento', 'comprovante', 'nota_fiscal', 'outros'];

function entityDef(name) {
  const def = ENTITIES[name];
  if (!def) throw badRequest('Tipo de registro inválido para anexo.');
  return def;
}

async function loadAttachment(db, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Arquivo não encontrado.');
  const { rows } = await db.query('select * from attachments where id = $1 and deleted_at is null', [id]);
  if (!rows[0]) throw notFound('Arquivo não encontrado.');
  return rows[0];
}

export default function (r) {
  r.post(
    '/files',
    async (ctx) => {
      const { entity, entity_id: entityId } = ctx.query;
      const category = CATEGORIES.includes(ctx.query.category) ? ctx.query.category : 'outros';
      const def = entityDef(entity);
      // Anexar exige poder cadastrar ou editar no módulo
      try {
        requirePerm(ctx.user, def.module, 'editar');
      } catch {
        requirePerm(ctx.user, def.module, 'cadastrar');
      }
      if (!/^[0-9a-f-]{36}$/i.test(entityId || '')) throw badRequest('Registro inválido.');
      const { rows } = await ctx.db.query(`select id, ${def.label} as label from ${def.table} where id = $1`, [entityId]);
      if (!rows[0]) throw notFound('Registro não encontrado.');

      const buf = ctx.rawBody;
      if (!buf?.length) throw badRequest('Arquivo vazio.');
      if (buf.length > UPLOAD_MAX_BYTES) throw new HttpError(413, `Arquivo muito grande (máximo ${UPLOAD_MAX_BYTES / 1024 / 1024} MB).`);
      const mime = sniffMime(buf);
      if (!mime || !UPLOAD_MIME.includes(mime)) throw badRequest('Tipo de arquivo não permitido. Envie JPG, PNG, WEBP ou PDF.');
      if (category === 'foto' && !mime.startsWith('image/')) throw badRequest('A foto deve ser uma imagem.');

      let filename = 'arquivo';
      try {
        filename = decodeURIComponent(ctx.req.headers.get('x-filename') || 'arquivo');
      } catch {
        /* nome inválido: usa padrão */
      }
      // eslint-disable-next-line no-control-regex -- remove caracteres de controle do nome
      filename = filename.replace(/[\\/\0-\x1f]/g, '_').slice(0, 150) || 'arquivo';

      const id = randomUUID();
      const key = `${entity}/${entityId}/${id}.${EXT[mime]}`;
      await putObject(key, buf, mime);

      await ctx.tx(async (c) => {
        await c.query(
          `insert into attachments (id, entity, entity_id, category, filename, mime, size, storage_key, uploaded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, entity, entityId, category, filename, mime, buf.length, key, ctx.user.id],
        );
        if (entity === 'vehicle' && category === 'foto') {
          await c.query('update vehicles set photo_id = $2, updated_at = now() where id = $1', [entityId, id]);
          await vehicleEvent(c, ctx, entityId, { type: 'edicao', title: 'Foto do veículo atualizada' });
        }
        await audit(c, ctx, {
          module: def.module,
          action: 'anexar',
          entity,
          entityId,
          label: rows[0].label,
          changes: [{ campo: 'arquivo', anterior: null, novo: `${filename} (${category})` }],
        });
      });
      return { id, filename, mime, size: buf.length, category };
    },
    { raw: true },
  );

  r.get('/files', async (ctx) => {
    const def = entityDef(ctx.query.entity);
    requirePerm(ctx.user, def.module, 'ver');
    const { rows } = await ctx.db.query(
      `select a.id, a.category, a.filename, a.mime, a.size, a.created_at, u.username as uploaded_by_name
         from attachments a left join users u on u.id = a.uploaded_by
        where a.entity = $1 and a.entity_id = $2 and a.deleted_at is null order by a.created_at desc`,
      [ctx.query.entity, ctx.query.entity_id],
    );
    return { files: rows };
  });

  r.get('/files/:id', async (ctx) => {
    const a = await loadAttachment(ctx.db, ctx.params.id);
    requirePerm(ctx.user, entityDef(a.entity).module, 'ver');
    const buf = await getObject(a.storage_key);
    const disposition = ctx.query.download === '1' ? 'attachment' : 'inline';
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': a.mime,
        'content-length': String(buf.length),
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        // O visualizador de PDF do navegador não funciona com CSP restritiva; o tipo real já foi validado no envio
        ...(a.mime.startsWith('image/') ? { 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
      },
    });
  });

  r.del('/files/:id', async (ctx) => {
    const a = await loadAttachment(ctx.db, ctx.params.id);
    const def = entityDef(a.entity);
    requirePerm(ctx.user, def.module, 'editar');
    const reason = String(ctx.body?.reason ?? '').trim() || null;
    await ctx.tx(async (c) => {
      await c.query('update attachments set deleted_at = now(), deleted_by = $2 where id = $1', [a.id, ctx.user.id]);
      if (a.entity === 'vehicle') await c.query('update vehicles set photo_id = null where photo_id = $1', [a.id]);
      await audit(c, ctx, {
        module: def.module,
        action: 'remover_anexo',
        entity: a.entity,
        entityId: a.entity_id,
        label: a.filename,
        changes: [{ campo: 'arquivo', anterior: a.filename, novo: null }],
        reason,
      });
    });
    return { ok: true };
  });
}
