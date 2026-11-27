// Otomatis naikkan versi SW, version.json, dan config.js setiap ada perbaikan
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const versionPath = path.join(root, 'version.json');
const swPath = path.join(root, 'sw.js');
const cfgPath = path.join(root, 'config.js');
const pkgPath = path.join(root, 'package.json');

const verData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const parts = String(verData.version || '1.0.0').split('.').map(Number);
parts[2] = (parts[2] || 0) + 1;
const nextVersion = parts.join('.');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const buildId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const swVersion = `${nextVersion}-${buildId}`;

// 1. Update version.json
verData.version = nextVersion;
verData.build = buildId;
verData.releasedAt = now.toISOString();
verData.notes = process.argv[2] || `Pembaruan otomatis CAFE CL v${nextVersion}`;
fs.writeFileSync(versionPath, JSON.stringify(verData, null, 2) + '\n');

// 2. Update sw.js
let swText = fs.readFileSync(swPath, 'utf8');
swText = swText.replace(/const SW_VERSION = '[^']+';/, `const SW_VERSION = '${swVersion}';`);
fs.writeFileSync(swPath, swText);

// 3. Update config.js
let cfgText = fs.readFileSync(cfgPath, 'utf8');
cfgText = cfgText.replace(/APP_VERSION:\s*'[^']+'/, `APP_VERSION: '${nextVersion}'`);
cfgText = cfgText.replace(/APP_BUILD:\s*'[^']+'/, `APP_BUILD: '${buildId}'`);
fs.writeFileSync(cfgPath, cfgText);

// 4. Update package.json
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

console.log(`✓ Versi & Service Worker di-update otomatis -> v${nextVersion} (build ${buildId})`);
