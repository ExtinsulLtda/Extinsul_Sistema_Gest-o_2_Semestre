// Copia as páginas estáticas para public/ (pasta servida pelo Workers Assets)
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const destino = path.join(raiz, 'public');
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino);
fs.copyFileSync(path.join(raiz, 'index.html'), path.join(destino, 'index.html'));
for (const p of ['css', 'js', 'assets', 'gerente', 'operador', 'motorista']) {
  fs.cpSync(path.join(raiz, p), path.join(destino, p), { recursive: true });
}
console.log('public/ gerado');
