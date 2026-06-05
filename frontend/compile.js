const babel = require('@babel/core');
const fs = require('fs');

const files = [
  { jsx: 'app.jsx', out: 'assets/app.compiled.js' },
  { jsx: 'admin-panel.jsx', out: 'assets/admin-panel.compiled.js' },
];

for (const { jsx, out } of files) {
  const jsxCode = fs.readFileSync('/home/openclaw/.openclaw/workspace/exposure-lab/frontend/' + jsx, 'utf8');
  console.log(`Compiling ${jsx}: ${jsxCode.length} chars`);

  try {
    const result = babel.transformSync(jsxCode, {
      presets: [['@babel/preset-react', { runtime: 'classic' }]],
      filename: jsx,
    });
    console.log(`  ✅ ${jsx} -> ${out}: ${result.code.length} chars`);
    fs.writeFileSync('/home/openclaw/.openclaw/workspace/exposure-lab/frontend/' + out, result.code);
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