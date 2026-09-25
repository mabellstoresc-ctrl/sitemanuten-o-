import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useFetch, useForm, useToast, Field, Loading, ErrorBox, IntInput } from '../components/ui.jsx';
import { PageHead, Guard } from '../components/common.jsx';

function AlertsForm({ initial, canEdit }) {
  const toast = useToast();
  const { values: v, set, errors: E, saving, submit } = useForm(initial);
  const onSubmit = submit(async (vals) => {
    try {
      await api('/settings/alertas', { method: 'PUT', body: vals });
      toast('Configurações de alerta salvas.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const num = (k, label, hint) => (
    <Field label={label} error={E[k]} hint={hint}>
      <IntInput value={v[k]} onChange={set(k)} disabled={!canEdit} />
    </Field>
  );
  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="card-head">
        <h2>Alertas automáticos</h2>
      </div>
      <div className="card-body">
        <div className="form-grid">
          {num('cnh_dias', 'Avisar CNH vencendo com (dias)', 'Ex.: 30')}
          {num('documento_dias', 'Avisar documentos vencendo com (dias)', 'Fase 5')}
          {num('manutencao_dias', 'Avisar manutenção por data com (dias)', '')}
          {num('manutencao_km', 'Avisar manutenção por KM com (km)', '')}
          {num('oleo_km', 'Avisar troca de óleo com (km)', '')}
          {num('km_salto_maximo', 'Pedir confirmação se o KM subir mais de (km)', 'Evita digitar um zero a mais')}
          {num('oleo_intervalo_km', 'Intervalo padrão da troca de óleo (km)', 'Sugerido ao registrar uma troca')}
        </div>
        {canEdit && (
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              Salvar
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function CompanyForm({ initial, canEdit }) {
  const toast = useToast();
  const { values: v, set, errors: E, saving, submit } = useForm(initial);
  const onSubmit = submit(async (vals) => {
    try {
      await api('/settings/empresa', { method: 'PUT', body: vals });
      toast('Dados da empresa salvos.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  return (
    <form className="card" onSubmit={onSubmit}>
      <div className="card-head">
        <h2>Empresa</h2>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Nome" error={E.nome} className="span2">
            <input value={v.nome} onChange={set('nome')} disabled={!canEdit} />
          </Field>
          <Field label="CNPJ" error={E.cnpj}>
            <input value={v.cnpj || ''} onChange={(e) => set('cnpj')(e.target.value.replace(/\D/g, '').slice(0, 14))} disabled={!canEdit} inputMode="numeric" />
          </Field>
        </div>
        {canEdit && (
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              Salvar
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useFetch(can('configuracoes') ? '/settings' : null);
  const canEdit = can('configuracoes', 'editar');
  return (
    <Guard module="configuracoes">
      <PageHead title="Configurações" code="990" />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        data && (
          <>
            <AlertsForm initial={data.settings.alertas} canEdit={canEdit} />
            <CompanyForm initial={data.settings.empresa} canEdit={canEdit} />
            <div className="card">
              <div className="card-head">
                <h2>Backup e segurança dos dados</h2>
              </div>
              <div className="card-body">
                <p style={{ marginTop: 0 }}>
                  Os dados ficam no banco PostgreSQL do servidor (Supabase) — não dependem do navegador. Arquivos (fotos, PDFs) ficam em armazenamento
                  privado, acessível somente pelo sistema.
                </p>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Exportação completa de backup pelo sistema e rotina automática serão adicionadas na fase 5. Veja o README do projeto para o passo a
                  passo de backup manual pelo Supabase.
                </p>
              </div>
            </div>
          </>
        )
      )}
    </Guard>
  );
}
