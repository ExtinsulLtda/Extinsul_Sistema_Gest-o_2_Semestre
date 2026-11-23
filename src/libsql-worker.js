// Alias do cliente libSQL para Cloudflare Workers: usa somente a versão HTTP/Web,
// evitando que o empacotador puxe binários nativos do SQLite local.
module.exports = require('@libsql/client/web');
