const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { execSync, spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app     = express();
const PORT    = process.env.PORT || 3001;
const API_KEY = process.env.COMPILE_API_KEY || 'agribrazil-2026';

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.headers['x-api-key'] !== API_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
});

function findForc() {
  const candidates = [
    '/root/.fuelup/bin/forc',
    '/home/ubuntu/.fuelup/bin/forc',
    '/usr/local/bin/forc',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const r = spawnSync('which', ['forc'], { encoding: 'utf-8' });
    if (r.stdout && r.stdout.trim && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  return null;
}

app.post('/compile', async (req, res) => {
  const { tokenName, tokenSymbol, decimals, totalSupply, swayCode: incomingCode } = req.body;

  const forcBin = findForc();
  if (!forcBin) {
    return res.status(500).json({ success: false, error: 'forc não encontrado.' });
  }

  const projectName = (tokenSymbol || 'token').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const tmpDir      = path.join(os.tmpdir(), `sway-${uuidv4().replace(/-/g,'')}`);
  const swayCode    = incomingCode || `contract;`;
  const forcToml    = `[project]\nname = "${projectName}"\nversion = "0.1.0"\nedition = "2024"\nlicense = "Apache-2.0"\n`;

  try {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Forc.toml'), forcToml);
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.sw'), swayCode);

    console.log(`[compile] Iniciando forc para ${projectName}...`);
    console.log(`[compile] tmpDir: ${tmpDir}`);
    console.log(`[compile] forc: ${forcBin}`);

    execSync(
      `${forcBin} build --path ${tmpDir}`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 25_000, shell: '/bin/bash' }
    );

    const binPath = path.join(tmpDir, 'out', 'debug', `${projectName}.bin`);
    const abiPath = path.join(tmpDir, 'out', 'debug', `${projectName}-abi.json`);

    console.log(`[compile] Procurando bytecode em: ${binPath}`);

    if (!fs.existsSync(binPath)) {
      return res.status(500).json({ success: false, error: 'Bytecode não gerado.' });
    }

    const bytecode = fs.readFileSync(binPath).toString('hex');
    const abi      = fs.existsSync(abiPath)
      ? JSON.parse(fs.readFileSync(abiPath, 'utf-8'))
      : null;

    console.log(`[compile] Sucesso! ${bytecode.length / 2} bytes`);
    return res.json({ success: true, bytecode, abi, swayCode });

  } catch (err) {
    const isTimeout = (err && (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT'));
    const forc_error = isTimeout
      ? 'Timeout: forc demorou mais de 25s.'
      : [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();

    console.error(`[compile] Erro: ${forc_error.slice(0, 500)}`);
    return res.status(400).json({ success: false, error: forc_error });

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

app.get('/health', (_req, res) => {
  const forc = findForc();
  if (!forc) return res.status(503).json({ status: 'degraded', forc: 'not found' });
  const v   = spawnSync(forc, ['--version'], { encoding: 'utf-8' });
  const mem = process.memoryUsage();
  const vStr = (v.stdout && v.stdout.trim) ? v.stdout.trim() : 'unknown';
  res.json({ status: 'ok', forc, version: vStr, memory_mb: Math.round(mem.rss / 1024 / 1024) });
});

app.listen(PORT, () => {
  console.log(`AgriBrazil Sway Compiler v2 - Porta ${PORT}`);
  console.log(`forc: ${findForc() || 'não encontrado'}`);
});
