// Lista ordenada de migrações. Nunca altere uma migração já aplicada em produção:
// crie uma nova (002_..., 003_...) para qualquer mudança de estrutura.
import m001 from './001_base.js';
import m002 from './002_abastecimentos.js';
import m003 from './003_manutencao.js';

export default [
  { version: '001_base', sql: m001 },
  { version: '002_abastecimentos', sql: m002 },
  { version: '003_manutencao', sql: m003 },
];
