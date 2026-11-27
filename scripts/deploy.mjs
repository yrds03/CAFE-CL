// 1-Klik Auto Bump SW + Commit + Push + GitHub Pages Auto-Deploy
import { execSync } from 'child_process';

const msg = process.argv.slice(2).join(' ') || 'Update & perbaikan sistem CAFE CL';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run(`node scripts/bump-version.mjs "${msg.replace(/"/g, '\\"')}"`);
  run('git add -A');
  run(`git commit --no-verify -m "${msg.replace(/"/g, '\\"')}"`);
  run('git push origin main');
  console.log('\n✓ Berhasil push ke GitHub! GitHub Pages sedang deploy otomatis & semua perangkat PWA akan auto-update.');
} catch (err) {
  console.error('\n✗ Deploy gagal:', err.message);
  process.exit(1);
}
