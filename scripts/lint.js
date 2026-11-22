const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = ['server.js', 'src', 'api', 'js', 'gerente', 'operador', 'motorista', 'scripts'];
const files = [];

function collect(entry) {
  const full = path.join(__dirname, '..', entry);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    for (const item of fs.readdirSync(full)) {
      collect(path.join(entry, item));
    }
  } else if (entry.endsWith('.js')) {
    files.push(full);
  }
}

roots.forEach(collect);
for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`Checked ${files.length} JavaScript files.`);
