// Substitui o body-parser no Workers (ele depende do iconv-lite, que não carrega lá).
// O app usa o leitor de JSON próprio de src/app.js.
const nao = () => { throw new Error('body-parser não está disponível no Workers; use o leitor de JSON de src/app.js.'); };
module.exports = { json: nao, raw: nao, text: nao, urlencoded: nao };
