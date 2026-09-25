// Lista ordenada de migrações. Nunca altere uma migração já aplicada em produção:
// crie uma nova (002_..., 003_...) para qualquer mudança de estrutura.
import m001 from './001_base.js';
import m002 from './002_abastecimentos.js';

export default [
  { version: '001_base', sql: m001 },
  { version: '002_abastecimentos', sql: m002 },
];
