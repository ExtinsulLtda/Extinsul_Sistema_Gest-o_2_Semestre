# Extinsul — Gestão e Manutenção de Extintores

Projeto da disciplina de Engenharia de Software. Front end (HTML + CSS + JS) + API Node/Express + banco SQLite hospedado no Turso.

## Estrutura
```
index.html            login (o PIN identifica o perfil e redireciona)
js/common.js          biblioteca compartilhada (sessão, API, modais, listas...)
js/login.js           lógica do login
css/style.css         todos os estilos
gerente/              index.html + app.js  (8 abas)
operador/             index.html + app.js  (7 abas)
motorista/            index.html + app.js  (6 abas)
api/auth.js           login por PIN, sessão, troca de PIN
api/gerente.js        API do gerente
api/operador.js       API do operador
api/motorista.js      API do motorista
api/shared.js         consultas usadas por mais de um perfil
api/migrate.js        atualiza o banco automaticamente ao iniciar (não perde dados)
server.js             servidor Express
terminal/             versão em terminal (Python) do gerente — veja terminal/README.md
db/                   schema.sql, seed.py, extinsul.db / extinsul.sqlite, migrations/, inspecionar.js, validacao.sql
docs/MIGRACAO_TURSO.md  diagnóstico, plano, validação e implantação (web + app C++)
```

## Abas por perfil
- **Gerente:** Início, Extintores, Clientes, Ordens de Serviço, Relatórios (CSV/imprimir), Funcionários, Veículos, Configurações
- **Operador:** Início, Vistorias, Manutenções, Ordens de Serviço, Extintores, Clientes, Fotos
- **Motorista:** Início, Rotas, Ordens de Serviço, Clientes, Comprovantes (imprimir), Veículo

## Endereços, fotos e rotas
- **Cliente:** endereço fixo (CEP, rua, número, bairro, cidade, UF). O CEP preenche o resto via [ViaCEP](https://viacep.com.br), API pública e gratuita.
- **Extintor:** local de instalação + endereço onde ele está (ou “usar o endereço fixo do cliente”). Gerente e operador podem editar a localização; ambos enviam e veem as fotos do extintor.
- **Ordem de serviço:** o gerente informa os extintores da OS; o destino da entrega é o endereço de cada um.
- **Motorista:** o início mostra o mapa de Varginha com a rota (OSRM + OpenStreetMap, sem chave) até o endereço mais próximo entre as OS em andamento; cada destino também tem link do **Google Maps**. Rota com várias paradas ainda não foi implementada.

Cada PIN pertence a um único usuário, por isso não pode haver PINs repetidos.

## 1) Criar o banco no Turso
```bash
# instalar a CLI: https://docs.turso.tech/cli/installation
turso auth login
turso db create extinsul --from-file db/extinsul.db
turso db show extinsul --url          # -> TURSO_DATABASE_URL
turso db tokens create extinsul       # -> TURSO_AUTH_TOKEN
```

## 2) Rodar
```bash
cp .env.example .env     # preencha as 3 variáveis (SESSION_SECRET: string aleatória longa)
npm install
npm start                # http://localhost:3000
```
Sem `TURSO_DATABASE_URL` o servidor usa o arquivo local `db/extinsul.db` (bom para testar).


## API
`POST /api/login`, `GET /api/eu`, `PUT /api/eu/pin` e as rotas `/api/gerente/*`, `/api/operador/*` e `/api/motorista/*` (cada uma só aceita o seu perfil).

O token do Turso fica só no servidor (nunca no navegador).

## Estoque e banco compartilhado
Tabelas `produtos` e `estoque_movimentacoes` (saldo nunca negativo, atualizado por trigger) são criadas pelo `migrar()` ao iniciar. Veja `docs/MIGRACAO_TURSO.md`. Para inspecionar o banco sem alterar: `node db/inspecionar.js`.


## Deploy no Cloudflare Workers
A API Express roda no Worker (`src/worker.js`) e as páginas são servidas pelo Workers Assets (`public/`, gerada por `npm run build`). O banco continua no Turso.
```bash
npm install
npx wrangler login
npx wrangler secret put TURSO_DATABASE_URL     # libsql://...turso.io
npx wrangler secret put TURSO_AUTH_TOKEN
npx wrangler secret put SESSION_SECRET         # string aleatória longa (fixa!)
npm run deploy                                 # gera public/ e publica
```
Teste local do Worker: copie `.dev.vars.example` para `.dev.vars`, preencha e rode `npm run dev:worker`. O `npm start` (Node + Express) continua funcionando.
No Worker o banco precisa ser o Turso (arquivo local não funciona). A migração roda sozinha na primeira requisição.
