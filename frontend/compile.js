const path = require('path');
const babel = require('@babel/core');
const fs = require('fs');

const FRONTEND_DIR = __dirname; // 当前目录 = frontend/

const files = [
  { jsx: 'app.jsx', out: 'assets/app.compiled.js' },
  { jsx: 'admin-panel.jsx', out: 'assets/admin-panel.compiled.js' },
];

for (const { jsx, out } of files) {
  const jsxPath = path.join(FRONTEND_DIR, jsx);
  const outPath = path.join(FRONTEND_DIR, out);
  const jsxCode = fs.readFileSync(jsxPath, 'utf8');
  console.log(`Compiling ${jsx}: ${jsxCode.length} chars`);

  try {
    const result = babel.transformSync(jsxCode, {
      presets: [['@babel/preset-react', { runtime: 'classic' }]],
      filename: jsx,
    });
    console.log(`  ✅ ${jsx} -> ${out}: ${result.code.length} chars`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.code);
  } catch (e) {
    console.error(`  ❌ ${jsx} failed:`, e.message);
    if (e.loc) {
      const lines = jsxCode.split('\n');
      const line = e.loc.line;
      console.error('  Error at line', line, 'col', e.loc.column);
      for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 3); i++) {
        console.error(`  ${i + 1}: ${lines[i]}`);
      }
    }
    process.exit(1);
  }
}

console.log('All files compiled successfully!');