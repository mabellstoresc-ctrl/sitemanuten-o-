import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { api, uploadFile } from '../../api.js';
import { useToast } from '../../components/ui.jsx';
import { PageHead, Guard } from '../../components/common.jsx';
import { readOfficialDocument } from '../../lib/pdfText.js';
import { fmtDate, fmtNum } from '../../lib/format.js';
import { TOWED_TYPES, TRACTOR_TYPES, VEHICLE_TYPES, UPLOAD_MAX_BYTES, labelOf } from '../../../shared/constants.js';

// Campos do veículo que o CRLV preenche
const VEHICLE_FROM_CRLV = ['brand', 'model', 'year_manufacture', 'year_model', 'chassis', 'renavam', 'fuel_type', 'axle_config', 'color', 'body_type', 'pbt', 'cmt', 'capacity'];

const STATUS = {
  lendo: { label: 'Lendo…', tone: 'muted' },
  pronto: { label: 'Pronto', tone: 'info' },
  ignorado: { label: 'Não reconhecido', tone: 'warn' },
  importando: { label: 'Importando…', tone: 'muted' },
  ok: { label: 'Importado', tone: 'ok' },
  existia: { label: 'Já cadastrado', tone: 'muted' },
  erro: { label: 'Erro', tone: 'danger' },
};

export default function ImportDocs() {
  const { can } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [rows, setRows] = useState([]);
  const [vehicles, setVehicles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fillVehicle, setFillVehicle] = useState(true);
  const [drag, setDrag] = useState(false);

  const update = (i, patch) => setRows((l) => l.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const loadVehicles = async () => {
    const r = await api('/vehicles/options?all=1');
    setVehicles(r.vehicles);
    return r.vehicles;
  };

  const addFiles = async (files) => {
    const list = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!list.length) {
      toast('Selecione arquivos PDF.', 'error');
      return;
    }
    const vs = vehicles || (await loadVehicles());
    const start = rows.length;
    setRows((l) => [...l, ...list.map((file) => ({ file, status: 'lendo', parsed: null, msg: '' }))]);
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        if (file.size > UPLOAD_MAX_BYTES) throw new Error('Arquivo maior que 4 MB.');
        const parsed = await readOfficialDocument(file);
        if (!parsed) {
          update(start + i, { status: 'ignorado', msg: 'Não é CRLV nem AET (ou é um PDF escaneado). Cadastre em Documentos → Novo documento.' });
          continue;
        }
        update(start + i, { status: 'pronto', parsed, include: true, msg: describe(parsed, vs) });
      } catch (err) {
        update(start + i, { status: 'erro', msg: err.message || 'Não foi possível ler o PDF.' });
      }
    }
  };

  const run = async () => {
    setBusy(true);
    let vs = await loadVehicles();
    const byPlate = () => Object.fromEntries(vs.map((v) => [v.plate, v]));
    // CRLVs primeiro (cadastram os veículos), depois as AETs (que referenciam os veículos)
    const order = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'pronto' && r.include).sort((a, b) => (a.r.parsed.kind === 'crlv' ? 0 : 1) - (b.r.parsed.kind === 'crlv' ? 0 : 1));
    let okCount = 0;
    for (const { r, i } of order) {
      update(i, { status: 'importando' });
      const d = r.parsed;
      try {
        let docId;
        let existed = false;
        let note = '';
        if (d.kind === 'crlv') {
          let v = byPlate()[d.plate];
          if (!v) {
            if (!can('veiculos', 'cadastrar')) throw new Error(`Veículo ${d.plate} não cadastrado e você não tem permissão para cadastrar veículos.`);
            const body = { plate: d.plate, type: d.type };
            for (const k of VEHICLE_FROM_CRLV) if (d[k] !== null && d[k] !== undefined) body[k] = d[k];
            const created = await api('/vehicles', { method: 'POST', body });
            vs = await loadVehicles();
            v = vs.find((x) => x.id === created.id);
            note = `Veículo ${d.plate} cadastrado (${labelOf(VEHICLE_TYPES, d.type).toLowerCase()}).`;
          } else if (fillVehicle && can('veiculos', 'editar')) {
            const full = (await api(`/vehicles/${v.id}`)).vehicle;
            const body = {};
            for (const k of VEHICLE_FROM_CRLV) if ((full[k] === null || full[k] === '') && d[k] !== null && d[k] !== undefined) body[k] = d[k];
            if (Object.keys(body).length) {
              await api(`/vehicles/${v.id}`, { method: 'PUT', body });
              note = `Cadastro de ${d.plate} completado (${Object.keys(body).length} campo(s)).`;
            }
          }
          try {
            const res = await api('/documents', {
              method: 'POST',
              body: { owner: 'veiculo', vehicle_id: v.id, type: 'crlv', number: d.crv_number, issuer: d.issuer, issued_on: d.issued_on, exercise_year: d.exercise_year },
            });
            docId = res.id;
            if (res.status === 'substituido') note += ' CRLV guardado como histórico (já existe um mais novo).';
          } catch (err) {
            if (err.code !== 'DOCUMENTO_DUPLICADO') throw err;
            existed = true;
          }
        } else {
          const map = byPlate();
          const found = d.plates.map((p) => map[p]).filter(Boolean);
          const tractor = found.find((x) => TRACTOR_TYPES.includes(x.type));
          if (!tractor) throw new Error(`Cavalo da AET não encontrado (${d.plates[0] || 'sem placa'}). Importe o CRLV dele junto ou cadastre o veículo.`);
          const trailers = found.filter((x) => TOWED_TYPES.includes(x.type));
          const missing = d.plates.filter((p) => !map[p]);
          try {
            const res = await api('/documents', {
              method: 'POST',
              body: {
                owner: 'veiculo',
                vehicle_id: tractor.id,
                type: 'aet',
                number: d.number,
                issuer: d.issuer,
                valid_from: d.valid_from,
                expires_on: d.expires_on,
                pbtc: d.pbtc,
                combination: d.combination,
                notes: d.art ? `ART nº ${d.art}` : null,
                authorized_vehicle_ids: trailers.map((t) => t.id),
              },
            });
            docId = res.id;
            note = `AET de ${tractor.plate} com ${trailers.length} implemento(s) autorizado(s).`;
            if (missing.length) note += ` Placas não cadastradas (não incluídas): ${missing.join(', ')}.`;
          } catch (err) {
            if (err.code !== 'DOCUMENTO_DUPLICADO') throw err;
            existed = true;
          }
        }
        if (docId) await uploadFile({ entity: 'document', entityId: docId, category: 'documento', file: r.file });
        okCount += existed ? 0 : 1;
        update(i, { status: existed ? 'existia' : 'ok', msg: existed ? 'Este documento já estava cadastrado.' : note || 'Documento cadastrado com o PDF anexado.', docId });
      } catch (err) {
        update(i, { status: 'erro', msg: err.message });
      }
    }
    setBusy(false);
    toast(`${okCount} documento(s) importado(s).`);
  };

  const ready = rows.filter((r) => r.status === 'pronto' && r.include).length;

  return (
    <Guard module="documentos" action="cadastrar">
      <PageHead title="Importar CRLV e AET" code="702" back="/documentos" sub="Selecione vários PDFs de uma vez. O sistema lê cada documento, cadastra os veículos que faltam (pelo CRLV) e registra CRLVs e AETs com o PDF anexado." />
      <div
        className={`card dropzone ${drag ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="card-body" style={{ textAlign: 'center', padding: 28 }}>
          <FileUp size={32} className="muted" />
          <p style={{ margin: '8px 0' }}>Arraste os PDFs aqui ou</p>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn primary" onClick={() => input.current?.click()} disabled={busy}>
            Escolher arquivos
          </button>
          <p className="muted small" style={{ marginTop: 8 }}>
            Aceita o CRLV digital (baixado do app Carteira Digital de Trânsito ou do DETRAN) e AET do DNIT e do DER em PDF. PDFs escaneados (foto) não são lidos automaticamente.
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Arquivos ({rows.length})</h2>
            <label className="check small" style={{ marginLeft: 'auto' }}>
              <input type="checkbox" checked={fillVehicle} onChange={(e) => setFillVehicle(e.target.checked)} /> Completar campos vazios dos veículos já cadastrados
            </label>
          </div>
          <div className="table-wrap">
            <table className="t dense">
              <thead>
                <tr>
                  <th />
                  <th>Arquivo</th>
                  <th>Tipo</th>
                  <th>Dados lidos</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.status === 'pronto' && <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Incluir" />}</td>
                    <td className="small" style={{ maxWidth: 200, wordBreak: 'break-all', whiteSpace: 'normal' }}>
                      {r.file.name}
                    </td>
                    <td>{r.parsed ? (r.parsed.kind === 'crlv' ? 'CRLV' : 'AET') : '—'}</td>
                    <td className="small" style={{ whiteSpace: 'normal', minWidth: 260 }}>{r.parsed ? <Summary d={r.parsed} /> : null}</td>
                    <td className="small" style={{ whiteSpace: 'normal', minWidth: 180 }}>
                      <span className={`badge ${STATUS[r.status].tone}`}>
                        {r.status === 'ok' ? <CheckCircle size={12} /> : r.status === 'erro' ? <XCircle size={12} /> : r.status === 'ignorado' ? <AlertTriangle size={12} /> : null} {STATUS[r.status].label}
                      </span>
                      {r.msg && <div className="muted" style={{ marginTop: 2 }}>{r.msg}</div>}
                      {r.docId && (
                        <div>
                          <Link to={`/documentos/${r.docId}`}>ver documento</Link>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ padding: 12 }}>
            <span className="left muted small">Os CRLVs são importados antes das AETs, para que os implementos já existam.</span>
            <button type="button" className="btn" disabled={busy} onClick={() => setRows([])}>
              Limpar lista
            </button>
            <button type="button" className="btn primary" disabled={busy || !ready} onClick={run}>
              {busy ? 'Importando…' : `Importar ${ready} documento(s)`}
            </button>
          </div>
        </div>
      )}
    </Guard>
  );
}

function describe(d, vehicles) {
  const map = Object.fromEntries(vehicles.map((v) => [v.plate, v]));
  if (d.kind === 'crlv') return map[d.plate] ? `Veículo ${d.plate} já cadastrado.` : `Veículo ${d.plate} será cadastrado.`;
  const missing = d.plates.filter((p) => !map[p]);
  return missing.length ? `Placas ainda não cadastradas: ${missing.join(', ')} (importe os CRLVs junto).` : 'Todas as placas já estão cadastradas.';
}

function Summary({ d }) {
  if (d.kind === 'crlv') {
    return (
      <>
        <span className="plate">{d.plate}</span> · {labelOf(VEHICLE_TYPES, d.type)} · {[d.brand, d.model].filter(Boolean).join(' ')} {d.year_manufacture ? `· ${d.year_manufacture}/${d.year_model}` : ''}
        <div className="muted">
          Exercício {d.exercise_year || '—'} · {d.axle_config || `${d.axles || '?'} eixos`}
          {d.pbt ? ` · PBT ${fmtNum(d.pbt, 1)} t` : ''}
          {d.cmt ? ` · CMT ${fmtNum(d.cmt, 1)} t` : ''} · RENAVAM {d.renavam || '—'}
        </div>
      </>
    );
  }
  return (
    <>
      <strong>{d.issuer}</strong> nº {d.number || '—'} · {d.valid_from ? fmtDate(d.valid_from) : '?'} a {d.expires_on ? fmtDate(d.expires_on) : '?'}
      <div className="muted">
        {d.combination ? `${d.combination} · ` : ''}
        {d.pbtc ? `PBTC ${fmtNum(d.pbtc, 1)} t · ` : ''}
        Placas: {d.plates.join(', ')}
      </div>
    </>
  );
}
