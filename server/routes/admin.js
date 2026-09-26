// Backup completo dos dados (somente o Administrador Principal).
import { forbidden } from '../http.js';
import { audit } from '../audit.js';

// Ordem de restauração (dependências primeiro). Sessões ficam de fora.
const TABLES = [
  'settings',
  'users',
  'user_permissions',
  'attachments',
  'vehicles',
  'drivers',
  'driver_assignments',
  'vehicle_couplings',
  'km_readings',
  'vehicle_events',
  'driver_occurrences',
  'fuel_orders',
  'fuelings',
  'service_orders',
  'service_order_status_log',
  'maintenances',
  'maintenance_parts',
  'tires',
  'tire_movements',
  'tire_retreads',
  'documents',
  'document_vehicles',
  'checklist_templates',
  'checklists',
  'checklist_answers',
  'costs',
  'appointments',
  'audit_log',
  'access_log',
  'schema_migrations',
];

export default function (r) {
  r.get('/admin/backup', async (ctx) => {
    if (!ctx.user.is_master) throw forbidden('Somente o Administrador Principal pode gerar o backup.');
    const data = {};
    const counts = {};
    for (const t of TABLES) {
      // Hash de senha não sai do banco: após restaurar, o administrador redefine as senhas
      const cols = t === 'users' ? 'id, username, full_name, email, job_title, is_active, is_master, must_change_password, created_at, created_by, updated_at' : '*';
      const { rows } = await ctx.db.query(`select ${cols} from ${t}`);
      data[t] = rows;
      counts[t] = rows.length;
    }
    await audit(ctx.db, ctx, {
      module: 'configuracoes',
      action: 'backup',
      entity: 'backup',
      label: `${Object.values(counts).reduce((s, n) => s + n, 0)} registros`,
    });
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', '_').replace(/:/g, '-').slice(0, 16);
    const body = JSON.stringify({
      sistema: 'Rododimi — gestão de frota',
      gerado_em: new Date().toISOString(),
      gerado_por: ctx.user.username,
      observacao: 'Senhas não são incluídas. Arquivos anexados (fotos/PDFs) ficam no Supabase Storage.',
      contagem: counts,
      dados: data,
    });
    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="backup-rododimi-${stamp}.json"`,
        'cache-control': 'no-store',
      },
    });
  });
}
