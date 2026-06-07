const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.COMPILE_API_KEY || 'agribrazil-2026';

// Middleware
app.use(express.json({ limit: '10mb' }));

// Verificar API key
const verifyApiKey = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  next();
};

/**
 * Compila código Sway para bytecode
 * POST /compile
 * Body: { tokenName, tokenSymbol, decimals, totalSupply, swayCode? }
 */
app.post('/compile', verifyApiKey, async (req, res) => {
  try {
    const { tokenName, tokenSymbol, decimals, totalSupply, swayCode } = req.body;

    // Validar entrada
    if (!tokenName || !tokenSymbol || decimals === undefined || !totalSupply) {
      return res.status(400).json({
        error: 'Missing required fields: tokenName, tokenSymbol, decimals, totalSupply',
      });
    }

    console.log(`[Compiler] Compilando token: ${tokenName} (${tokenSymbol})`);

    // Gerar código Sway se não fornecido
    let code = swayCode;
    if (!code) {
      code = generateSwayCode(tokenName, tokenSymbol, decimals, totalSupply);
    }

    // Criar diretório temporário
    const tmpDir = path.join(os.tmpdir(), `sway-${uuidv4()}`);
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Escrever Forc.toml
    const forcToml = `[project]
name = "${sanitizeName(tokenName)}"
entry = "main.sw"
license = "Apache-2.0"
`;
    fs.writeFileSync(path.join(tmpDir, 'Forc.toml'), forcToml);

    // Escrever código Sway
    fs.writeFileSync(path.join(srcDir, 'main.sw'), code);

    console.log(`[Compiler] Código Sway escrito em ${tmpDir}`);

    // Compilar com forc
    console.log(`[Compiler] Executando: forc build --release`);
    const output = execSync(`cd ${tmpDir} && forc build --release 2>&1`, {
      encoding: 'utf-8',
      timeout: 60000,
    });

    console.log(`[Compiler] Output:\n${output}`);

    // Ler bytecode
    const bytecodeFile = path.join(tmpDir, 'out', 'release', `${sanitizeName(tokenName)}.bin`);
    if (!fs.existsSync(bytecodeFile)) {
      throw new Error(`Bytecode file not found at ${bytecodeFile}`);
    }

    const bytecodeBuffer = fs.readFileSync(bytecodeFile);
    const bytecodeHex = bytecodeBuffer.toString('hex');

    console.log(`[Compiler] Bytecode gerado: ${bytecodeHex.length} caracteres`);

    // Limpar diretório temporário
    fs.rmSync(tmpDir, { recursive: true, force: true });

    res.json({
      success: true,
      bytecode: bytecodeHex,
      bytecodeSize: bytecodeBuffer.length,
      tokenName,
      tokenSymbol,
      decimals,
      totalSupply,
    });
  } catch (error) {
    console.error(`[Compiler] Erro:`, error);

    res.status(500).json({
      success: false,
      error: error.message || 'Compilation failed',
      details: error.stderr || error.toString(),
    });
  }
});

/**
 * Health check
 * GET /health
 */
app.get('/health', (req, res) => {
  try {
    const forcVersion = execSync('forc --version', { encoding: 'utf-8' }).trim();
    res.json({
      status: 'ok',
      forc: forcVersion,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: 'forc not available',
    });
  }
});

/**
 * Gera código Sway para um token SRC-20
 */
function generateSwayCode(tokenName, tokenSymbol, decimals, totalSupply) {
  return `contract;

use std::{
    asset::mint_to,
    identity::Identity,
    auth::msg_sender,
    constants::DEFAULT_SUB_ID,
};

abi ${sanitizeName(tokenName)} {
    #[storage(read)]
    fn get_balance() -> u64;
    
    #[storage(read)]
    fn get_name() -> str[32];
    
    #[storage(read)]
    fn get_symbol() -> str[10];
    
    #[storage(read)]
    fn get_decimals() -> u8;
}

storage {
    balance: u64 = ${totalSupply},
    name: str[32] = "${tokenName}",
    symbol: str[10] = "${tokenSymbol}",
    decimals: u8 = ${decimals},
}

impl ${sanitizeName(tokenName)} for Contract {
    #[storage(read)]
    fn get_balance() -> u64 {
        storage.balance.read()
    }
    
    #[storage(read)]
    fn get_name() -> str[32] {
        storage.name.read()
    }
    
    #[storage(read)]
    fn get_symbol() -> str[10] {
        storage.symbol.read()
    }
    
    #[storage(read)]
    fn get_decimals() -> u8 {
        storage.decimals.read()
    }
}
`;
}

/**
 * Sanitiza nome para usar como identificador Sway
 */
function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&')
    .substring(0, 30);
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`[Server] Sway Compiler Service rodando em porta ${PORT}`);
  console.log(`[Server] API Key: ${API_KEY}`);
  console.log(`[Server] Health check: GET /health`);
  console.log(`[Server] Compilar: POST /compile`);
});
