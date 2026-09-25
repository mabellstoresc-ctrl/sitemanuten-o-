# Rododimi · Gestão de Frota e Manutenção

Sistema interno da **Rododimi Transportes e Logística** para controle de frota: veículos, implementos, motoristas, quilometragem, usuários, permissões e auditoria. Nas próximas fases entram abastecimentos, manutenções, pneus, documentos, custos e relatórios.

- Uso **somente interno**: não existe cadastro público. Só o administrador cria usuários.
- Motoristas são **apenas cadastrados** e não têm login.
- Funciona no computador e no celular.

## Arquitetura

| Parte | Tecnologia | Onde roda |
| --- | --- | --- |
| Telas | React + Vite | Netlify (site estático) |
| API | Netlify Functions (Node 22), em `/api/*` | Netlify |
| Banco de dados | PostgreSQL | Supabase |
| Arquivos (fotos, PDFs) | Storage privado | Supabase |

Os dados ficam no banco do servidor e **não dependem do navegador**. A estrutura do banco é criada e atualizada automaticamente no primeiro acesso (migrações em `server/migrations`).

## Colocar no ar (passo a passo)

### 1. Supabase (banco de dados e arquivos)

1. Crie uma conta em https://supabase.com e clique em **New project**.
   - Região: **South America (São Paulo)**.
   - Anote a senha do banco (*Database password*).
2. Com o projeto criado, clique em **Connect** (no topo) → aba **Connection string** → escolha **Transaction pooler** (porta **6543**).
   Copie a URL e troque `[YOUR-PASSWORD]` pela senha do banco. Essa é a `DATABASE_URL`.
3. Vá em **Project Settings → API Keys** e copie:
   - a **URL do projeto** (`https://xxxx.supabase.co`) → `SUPABASE_URL`;
   - a chave **secret** (ou `service_role` nas chaves antigas) → `SUPABASE_SERVICE_KEY`.
     **Nunca** coloque essa chave no código nem compartilhe.

O bucket privado `arquivos` é criado automaticamente pelo sistema.

### 2. Netlify (site + API)

1. Em https://app.netlify.com clique em **Add new site → Import an existing project → GitHub** e escolha este repositório e a branch que será publicada.
2. As configurações de build já vêm do `netlify.toml` (comando `npm run build`, pasta `dist`).
3. Antes do primeiro deploy, vá em **Site configuration → Environment variables** e crie:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | URL do *Transaction pooler* do Supabase (com a senha) |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | chave secreta do Supabase |
| `ADMIN_INITIAL_PASSWORD` | senha inicial do administrador (ex.: `050410`) |

4. Faça o deploy (**Deploys → Trigger deploy**).

### 3. Primeiro acesso

- Usuário: **`bernardo`**
- Senha: o valor de `ADMIN_INITIAL_PASSWORD`

No primeiro login o sistema **obriga a criar uma senha nova**. A senha inicial só é usada para criar o administrador; depois disso ela não tem mais efeito.

### Esqueci a senha do administrador

1. Na Netlify, crie a variável `ADMIN_RESET_PASSWORD` com uma senha provisória e faça um novo deploy.
2. Entre com `bernardo` e essa senha. O sistema pedirá uma senha nova.
3. **Apague** a variável `ADMIN_RESET_PASSWORD` depois.

Os outros usuários que esquecerem a senha devem falar com o administrador, que define uma senha provisória em **Administração → Usuários → Redefinir senha**.

## Usuários e permissões

- **Administrador Principal (bernardo):** acesso total. Não pode ser desativado, bloqueado nem ter o acesso alterado por outros usuários.
- **Demais usuários:** permissões por módulo (Visualizar, Cadastrar, Editar, Cancelar, Excluir, Exportar, Aprovar), definidas em **Administração → Usuários**.
- Um usuário com permissão de cadastrar usuários só pode conceder as permissões que ele mesmo tem. Ele também não pode alterar quem tem mais acesso que ele.
- As permissões são verificadas **no servidor** em toda requisição. Esconder botões na tela é só conveniência.

## Segurança

- Senhas guardadas com hash **scrypt** (nunca em texto).
- Sessão em cookie `HttpOnly` + `Secure` + `SameSite=Strict`. Expira após 4 h sem uso ou 12 h no total; com "Manter conectado", após 7 dias sem uso ou 30 dias no total.
- Bloqueio de 15 minutos após 5 senhas erradas. Excesso de falhas vindas do mesmo IP também é bloqueado. Tudo fica registrado no **Histórico de acessos**.
- Usuário desativado perde o acesso na hora (as sessões são encerradas).
- Uploads: o tipo real do arquivo é conferido pelo conteúdo (JPG, PNG, WEBP ou PDF), com limite de 4 MB. Fotos do celular são reduzidas antes do envio. Os arquivos ficam em bucket privado, acessível só pela API.
- Auditoria de todas as alterações importantes, com valor anterior e novo. Exclusões exigem motivo.

## Abastecimentos (fase 2)

- **Ordens de abastecimento (302):** número sequencial, veículo, motorista, posto autorizado e limites de litros e/ou valor. A ordem pode ser **impressa** para o motorista levar ao posto. Situações: Pendente, Utilizada e Cancelada.
- **Novo abastecimento (301):** já preenche o motorista atual do veículo e calcula o valor total (litros × preço). Aceita foto ou PDF do comprovante e pode ser vinculado a uma ordem; a ordem passa a "Utilizada" e os limites são conferidos.
- **Média km/L pelo método do tanque cheio:** KM rodados desde o último tanque cheio ÷ litros abastecidos nesse intervalo. Abastecimentos parciais somam litros para o próximo tanque cheio. Exemplo: 350.000 → 350.800 km com 250 L = **3,2 km/L**. O ARLA 32 entra no custo, mas não na média.
- **Recálculo automático:** incluir, editar ou cancelar qualquer abastecimento (inclusive lançado com atraso) recalcula todas as médias do veículo.
- **Verificações antes de salvar:**
  - KM incoerente com a linha do tempo;
  - litros acima do tanque;
  - lançamento em duplicidade;
  - ordem já usada ou acima do limite;
  - valor total que não confere;
  - média fora do normal (sinal de KM ou litros digitados errado).
- **Histórico (303):** filtros e totais, destaque para consumo 20% acima ou abaixo da média do veículo e exportação para Excel (CSV).
- **Médias (304):** comparativo entre veículos, gráficos mensal, anual e por abastecimento, e comparação entre dois períodos.
- **Alertas:** consumo abaixo do padrão e ordens pendentes há mais de 3 dias.

## Manutenção (fase 3)

- **Ordens de serviço (401):**
  - Ciclo: Aberta → Em análise → Aguardando peça → Em manutenção → Finalizada, ou Cancelada. Cada mudança fica registrada no andamento.
  - Ao abrir a OS, o veículo pode ir para "Em manutenção"; ele volta ao status anterior quando a OS é finalizada ou cancelada.
  - Peças são lançadas na própria OS.
  - **Finalizar a OS gera automaticamente o registro de manutenção**, com peças, mão de obra, categorias e próxima manutenção. Não é preciso lançar duas vezes.
  - A previsão de conclusão gera alerta de OS atrasada, e a OS pode ser impressa.
- **Preventivas (402) e corretivas (403):** para serviços já realizados, com categorias, peças, mão de obra, total, nota fiscal, fotos e arquivos. A tela de preventivas mostra também as manutenções próximas e vencidas.
- **Próxima manutenção:** toda manutenção pode ter próxima data e/ou próximo KM. Para cada veículo e categoria vale a manutenção mais recente. O sistema avisa quando está próxima (limites em Configurações) e quando venceu.
- **Troca de óleo (404):** é uma manutenção com a categoria "Troca de óleo", com campos de marca, tipo, especificação, quantidade e filtros. A tela mostra por veículo: ÚLTIMA TROCA, PRÓXIMA TROCA, KM ATUAL e KM RESTANTES. O botão "+15 mil" usa o intervalo padrão definido em Configurações.
- **Calendário (405):** filtros Hoje, Esta semana, Este mês, Atrasadas e Próximas. Manutenções por KM ganham uma **data estimada** pelo ritmo de rodagem do veículo nos últimos 90 dias.
- **KM atualizado automaticamente:** o KM informado na OS ou na manutenção atualiza o veículo com as mesmas regras de coerência. Registros só com data comparam com os dias anteriores e posteriores.

## Regras de quilometragem

- O KM nunca diminui sem **confirmação do Administrador Principal** e motivo. A correção fica na auditoria.
- Aumento muito grande (padrão: 5.000 km, configurável) pede confirmação, para evitar um zero a mais.
- Toda leitura (manual ou de abastecimento) precisa ser coerente com a linha do tempo: não pode ser menor que uma leitura anterior nem maior que uma posterior.
- Leituras antigas (lançadas com atraso) entram no histórico, mas não reduzem o KM atual.
- Cancelar ou editar o abastecimento que definiu o KM atual faz o KM voltar. Por isso, só o Administrador Principal pode fazer isso.
- Carretas e implementos acumulam KM pelo KM do cavalo enquanto estão engatados.

## Backup

Os dados ficam no PostgreSQL do Supabase. Recomendações:

- Confira em **Supabase → Database → Backups** o que o seu plano oferece. O plano pago (Pro) inclui backups diários automáticos.
- Backup manual a qualquer momento, com a `DATABASE_URL` (use a conexão *Session pooler*, porta 5432):
  ```bash
  pg_dump "postgresql://...:5432/postgres" --no-owner --format=custom --file=rododimi-$(date +%F).dump
  ```
- No plano gratuito, o Supabase pausa o projeto após 7 dias sem nenhum acesso. Com uso diário isso não acontece.

A fase 5 adiciona exportação de backup pelo próprio sistema.

## Atalhos (estilo SSW)

- **F2** ou **/** foca a barra do topo. Digite o **código da tela** (ex.: `101` Veículos, `201` Motoristas, `901` Usuários) e tecle Enter. Os códigos aparecem no menu lateral.
- A mesma barra pesquisa placa, nº da frota, modelo, motorista, CPF e CNH.
- Nos formulários, **Enter** avança para o próximo campo e **Ctrl+Enter** salva.

## Desenvolvimento local

Requisitos: Node 20+ e um PostgreSQL.

```bash
npm install
cp .env.example .env        # preencha DATABASE_URL e ADMIN_INITIAL_PASSWORD
npm run dev                 # API em :8888 e telas em http://localhost:5173
```

Sem as variáveis do Supabase, os arquivos são salvos em `.data/uploads`.

Testes automatizados da API (usam o banco em `DATABASE_URL`, padrão `postgresql://fleet:fleet@localhost:5432/fleet_test`, que é **apagado** a cada execução):

```bash
npm test
npm run lint
```

## Estrutura

```
netlify/functions/api.mjs   entrada da API na Netlify
server/                     API: rotas, autenticação, permissões, auditoria, migrações
shared/                     constantes usadas pela API e pelas telas (módulos, status, tipos)
src/                        telas (React)
tests/                      testes da API
```

## Fases

1. **Base** (entregue): login, usuários, permissões, auditoria, histórico de acessos, veículos, implementos e engates, motoristas e ocorrências, regras de KM, anexos, painel, alertas de CNH, pesquisa global, configurações.
2. **Abastecimentos** (entregue): ordens de abastecimento, médias de consumo e gráficos.
3. **Manutenção** (entregue): ordens de serviço, preventivas/corretivas, troca de óleo, próximas manutenções, calendário e alertas.
4. Pneus: cadastro, mapa de eixos, movimentações, recapagens e histórico.
5. Checklists, documentos com vencimento, custos, relatórios PDF/Excel e backup pelo sistema.
