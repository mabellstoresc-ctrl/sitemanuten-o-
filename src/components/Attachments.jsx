import { useRef, useState } from 'react';
import { Upload, FileText, Trash2, Download } from 'lucide-react';
import { useFetch, Loading, ErrorBox, Empty, useToast, useDialog, Select } from './ui.jsx';
import { api, qs, uploadFile, downloadFile } from '../api.js';
import { fmtBytes, fmtDateTime } from '../lib/format.js';
import { UPLOAD_MAX_BYTES } from '../../shared/constants.js';

export const FILE_CATEGORIES = [
  { key: 'documento', label: 'Documento' },
  { key: 'foto', label: 'Foto' },
  { key: 'nota_fiscal', label: 'Nota fiscal' },
  { key: 'comprovante', label: 'Comprovante' },
  { key: 'outros', label: 'Outros' },
];

export function UploadButton({ entity, entityId, category, onUploaded, label = 'Enviar arquivo', accept = 'image/*,application/pdf', className = 'btn', capture }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const onChange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        if (file.type === 'application/pdf' && file.size > UPLOAD_MAX_BYTES) {
          throw new Error(`"${file.name}" tem ${fmtBytes(file.size)}. O limite é ${fmtBytes(UPLOAD_MAX_BYTES)}.`);
        }
        await uploadFile({ entity, entityId, category, file });
      }
      toast(files.length > 1 ? `${files.length} arquivos enviados.` : 'Arquivo enviado.');
      onUploaded?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={ref} type="file" accept={accept} multiple={category !== 'foto'} capture={capture} hidden onChange={onChange} />
      <button type="button" className={className} onClick={() => ref.current?.click()} disabled={busy}>
        <Upload size={15} /> {busy ? 'Enviando…' : label}
      </button>
    </>
  );
}

export default function Attachments({ entity, entityId, canEdit }) {
  const { data, loading, error, reload } = useFetch(`/files${qs({ entity, entity_id: entityId })}`);
  const [category, setCategory] = useState('documento');
  const dialog = useDialog();
  const toast = useToast();

  const remove = async (f) => {
    const reason = await dialog.prompt({
      title: 'Remover anexo',
      message: `Remover "${f.filename}"? O registro da remoção fica na auditoria.`,
      label: 'Motivo',
      required: true,
      minLength: 3,
      danger: true,
      confirmLabel: 'Remover',
    });
    if (!reason) return;
    try {
      await api(`/files/${f.id}`, { method: 'DELETE', body: { reason } });
      toast('Anexo removido.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Arquivos e documentos</h2>
        {canEdit && (
          <div className="btn-row">
            <Select value={category} onChange={(v) => setCategory(v || 'documento')} options={FILE_CATEGORIES} allowEmpty={false} className="input" style={{ width: 150, height: 32 }} />
            <UploadButton entity={entity} entityId={entityId} category={category} onUploaded={reload} label="Enviar" className="btn primary" />
          </div>
        )}
      </div>
      <div className="card-body">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.files.length ? (
          <Empty>Nenhum arquivo anexado. Aceita JPG, PNG, WEBP e PDF (até 4 MB; fotos são reduzidas automaticamente).</Empty>
        ) : (
          <div className="files">
            {data.files.map((f) => (
              <div className="file" key={f.id}>
                <a className="thumb" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                  {f.mime.startsWith('image/') ? <img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" /> : <FileText size={34} />}
                </a>
                <div className="meta">
                  <div className="name" title={f.filename}>
                    {f.filename}
                  </div>
                  <div className="muted">
                    {FILE_CATEGORIES.find((c) => c.key === f.category)?.label || f.category} · {fmtBytes(f.size)}
                  </div>
                  <div className="muted">
                    {fmtDateTime(f.created_at)} · {f.uploaded_by_name}
                  </div>
                  <div className="btn-row" style={{ marginTop: 4 }}>
                    <button type="button" className="btn sm" onClick={() => downloadFile(`/files/${f.id}?download=1`, f.filename).catch((e) => toast(e.message, 'error'))}>
                      <Download size={13} />
                    </button>
                    {canEdit && (
                      <button type="button" className="btn sm danger" onClick={() => remove(f)} aria-label="Remover">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
