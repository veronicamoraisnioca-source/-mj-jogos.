const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// Cabeçalhos básicos de segurança.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const DB = path.join(__dirname, "data.json");
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET;
const WA = "258852487728";

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 14) {
  console.error("ERRO: configure ADMIN_PASSWORD (mínimo 14 caracteres) nas variáveis de ambiente.");
  process.exit(1);
}
if (!ADMIN_TOTP_SECRET || !/^[A-Z2-7]{16,}$/.test(ADMIN_TOTP_SECRET)) {
  console.error("ERRO: configure ADMIN_TOTP_SECRET em Base32 (mínimo 16 caracteres).");
  process.exit(1);
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(DB, "utf8"));
    return data && Array.isArray(data.players) ? data : { players: [] };
  } catch {
    return { players: [] };
  }
}
function write(data) {
  const temp = DB + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DB);
}
function randomCode() {
  return "MJ" + crypto.randomBytes(5).toString("hex").toUpperCase();
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// TOTP RFC 6238, sem bibliotecas externas. Compatível com apps autenticadores.
function base32ToBuffer(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.replace(/=+$/g, "")) {
    const n = alphabet.indexOf(ch);
    if (n < 0) throw new Error("Segredo Base32 inválido");
    bits += n.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}
function verifyTotp(token) {
  if (!/^\d{6}$/.test(String(token || ""))) return false;
  const key = base32ToBuffer(ADMIN_TOTP_SECRET);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step + offset));
    const hmac = crypto.createHmac("sha1", key).update(counter).digest();
    const pos = hmac[hmac.length - 1] & 0x0f;
    const num = (hmac.readUInt32BE(pos) & 0x7fffffff) % 1000000;
    if (safeEqual(String(num).padStart(6, "0"), String(token))) return true;
  }
  return false;
}

// Limite simples por IP para dificultar tentativas repetidas.
// Reinicia se o servidor reiniciar; para produção, usar armazenamento partilhado.
const attempts = new Map();
function isLocked(ip) {
  const item = attempts.get(ip);
  if (!item) return false;
  if (Date.now() >= item.until) {
    attempts.delete(ip);
    return false;
  }
  return item.count >= 5;
}
function recordFailure(ip) {
  const item = attempts.get(ip) || { count: 0, until: Date.now() + 15 * 60 * 1000 };
  item.count += 1;
  item.until = Date.now() + 15 * 60 * 1000;
  attempts.set(ip, item);
}
function clearFailures(ip) {
  attempts.delete(ip);
}
function adminAuth(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (isLocked(ip)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos." });
  }

  const password = String(req.headers["x-admin-password"] || "");
  const otp = String(req.headers["x-admin-totp"] || "");
  if (!safeEqual(password, ADMIN_PASSWORD) || !verifyTotp(otp)) {
    recordFailure(ip);
    return res.status(401).json({ error: "Credenciais inválidas. Verifique a palavra-passe e o código autenticador." });
  }

  clearFailures(ip);
  next();
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    status: p.status,
    created: p.created,
    accessCode: p.status === "approved" ? p.accessCode : null
  };
}

// Novo registo fica PENDENTE. Nunca aprova automaticamente.
app.post("/api/register", (req, res) => {
  const { name, phone } = req.body || {};
  const cleanName = String(name || "").trim().slice(0, 70);
  const cleanPhone = String(phone || "").replace(/[^\d+]/g, "").slice(0, 20);

  if (cleanName.length < 2 || cleanPhone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ error: "Introduza um nome e telefone válidos." });
  }

  const db = read();
  const normalized = cleanPhone.replace(/\D/g, "");
  const duplicate = db.players.some(p => String(p.phone || "").replace(/\D/g, "") === normalized);
  if (duplicate) {
    return res.status(409).json({ error: "Este telefone já tem uma inscrição." });
  }

  const id = crypto.randomBytes(12).toString("hex");
  const player = {
    id,
    name: cleanName,
    phone: cleanPhone,
    status: "pending",
    accessCode: null,
    created: new Date().toISOString()
  };
  db.players.push(player);
  write(db);

  const message = "Olá, MJ Jogos. Sou " + cleanName +
    ". O meu telefone é " + cleanPhone +
    ". Quero confirmar a minha inscrição. Referência: " + id + ".";

  res.status(201).json({
    ok: true,
    id,
    status: "pending",
    message: "Inscrição recebida. Aguarde a confirmação do pagamento e a aprovação.",
    whatsapp: `https://wa.me/${WA}?text=${encodeURIComponent(message)}`
  });
});

// Estado público: não revela códigos de acesso.
app.get("/api/status/:id", (req, res) => {
  const p = read().players.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Inscrição não encontrada." });
  res.json({ status: p.status });
});

// Toda a administração exige palavra-passe + código TOTP.
app.get("/api/admin/players", adminAuth, (req, res) => {
  res.json(read().players.map(publicPlayer));
});

app.post("/api/admin/approve", adminAuth, (req, res) => {
  const { id } = req.body || {};
  const db = read();
  const p = db.players.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Jogador não encontrado." });
  if (p.status === "blocked") return res.status(409).json({ error: "Esta inscrição está bloqueada." });

  // A aprovação só deve ser feita depois de confirmar o recebimento real no canal oficial.
  p.status = "approved";
  p.accessCode = p.accessCode || randomCode();
  p.approvedAt = new Date().toISOString();
  write(db);

  res.json({ ok: true, player: publicPlayer(p) });
});

app.post("/api/admin/block", adminAuth, (req, res) => {
  const { id } = req.body || {};
  const db = read();
  const p = db.players.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Jogador não encontrado." });
  p.status = "blocked";
  p.accessCode = null;
  p.blockedAt = new Date().toISOString();
  write(db);
  res.json({ ok: true });
});

const questions = [
  { q: "Qual é a capital de Moçambique?", a: ["Beira", "Maputo", "Quelimane"], correct: 1 },
  { q: "Quanto é 8 × 7?", a: ["54", "56", "64"], correct: 1 },
  { q: "Qual é o maior planeta do Sistema Solar?", a: ["Terra", "Marte", "Júpiter"], correct: 2 },
  { q: "Quantos lados tem um triângulo?", a: ["3", "4", "5"], correct: 0 },
  { q: "Qual é a língua oficial de Moçambique?", a: ["Português", "Inglês", "Francês"], correct: 0 }
];

app.get("/api/play/:code", (req, res) => {
  const code = String(req.params.code || "");
  if (code.length < 8 || code.length > 20) {
    return res.status(403).json({ error: "Código inválido ou acesso não aprovado." });
  }
  const p = read().players.find(x => x.accessCode === code && x.status === "approved");
  if (!p) return res.status(403).json({ error: "Código inválido ou acesso não aprovado." });
  res.json({ ok: true, player: p.name, questions });
});

app.listen(PORT, () => console.log("MJ Jogos ativo na porta " + PORT));
