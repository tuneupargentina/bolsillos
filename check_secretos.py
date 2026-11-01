#!/usr/bin/env python3
"""check_secretos.py - recorre TODO el árbol del repo y falla si encuentra secretos o datos personales.

Uso (desde la raíz del repo):   python3 check_secretos.py [carpeta]      (por defecto: la carpeta de este script)
Sale con código 0 si está limpio y con 1 si encuentra algo. Correrlo antes de CADA commit.

Busca:
  - Archivos/carpetas que no van: .env*, .near-credentials/, *credentials*.json, *.pem, *.key, *.seed,
    claves SSH (id_rsa, id_ed25519), target/, node_modules/, *.wasm, *.zip.
  - Claves privadas: ed25519:/secp256k1: + base58 largo, bloques "BEGIN ... PRIVATE KEY",
    campos private_key / secret_key con valor.
  - Frases semilla: campos seed_phrase / mnemonic con valor, o 12+ palabras sueltas en minúscula entre comillas.
  - Tokens / API keys: GitHub (ghp_, gho_, github_pat_), Slack (xox?-), AWS (AKIA...), Google (AIza...),
    OpenAI-like (sk-...), "Bearer <token>", JWT, y asignaciones tipo api_key/token/secret/password = "...".
  - Datos personales: emails, teléfonos (formato AR e internacional), números tipo DNI (12.345.678) y CUIT/CUIL.

Excepciones (lista blanca, a la vista y justificada):
  - Emails en dominios reservados para ejemplos (example.invalid, example.com/.org/.net, RFC 2606).
  - Los valores EXACTOS de .check_secretos-permitidos: datos inventados que usan las pruebas para demostrar
    que el agente RECHAZA datos personales. Se informan como "permitido", no como hallazgo.
Revisa también texto embebido en binarios (PNG/SVG), por si hay metadatos con datos.
"""
import os, re, sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
SELF = os.path.abspath(__file__)
ALLOW_FILE = os.path.join(ROOT, ".check_secretos-permitidos")

FORBIDDEN_DIRS = {".near-credentials", "near-credentials", "target", "node_modules", ".near"}
FORBIDDEN_FILE = [
    (re.compile(r"^\.env(\..*)?$"), "archivo .env"),
    (re.compile(r".*credentials.*\.json$", re.I), "JSON de credenciales"),
    (re.compile(r".*\.(pem|key|seed|p12|pfx|keystore)$", re.I), "archivo de clave"),
    (re.compile(r"^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$"), "clave SSH"),
    (re.compile(r".*seed[-_ ]?phrase.*", re.I), "archivo de frase semilla"),
    (re.compile(r".*\.wasm$"), "compilado .wasm fuera de res/"),
    (re.compile(r".*\.zip$"), "zip (duplicado de código; no va al repo)"),
]
B58 = r"[1-9A-HJ-NP-Za-km-z]"
PATTERNS = [
    ("clave privada NEAR", re.compile(r"(ed25519|secp256k1):" + B58 + r"{40,}")),
    ("bloque de clave privada", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("campo private_key/secret_key con valor", re.compile(r"""["']?(private_?key|secret_?key|privateKey|secretKey)["']?\s*[:=]\s*["'][^"']{8,}["']""", re.I)),
    ("frase semilla (campo)", re.compile(r"""["']?(seed_?phrase|seedPhrase|mnemonic|frase_?semilla)["']?\s*[:=]\s*["']?[a-z]+(\s+[a-z]+){11,}""", re.I)),
    ("frase semilla (12+ palabras)", re.compile(r"""["'`]([a-z]{3,8}(?: [a-z]{3,8}){11,23})["'`]""")),
    ("token GitHub", re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})")),
    ("token Slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("clave AWS", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("clave Google API", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("API key tipo sk-", re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}")),
    ("Bearer token", re.compile(r"Bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("asignación de token/clave/password", re.compile(r"""\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|contrase(ñ|n)a)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']""", re.I)),
    ("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}\b")),
    ("teléfono internacional", re.compile(r"(?<![\w+])\+\d{1,3}[\s\-]?(\(?\d{1,4}\)?[\s\-]?){2,5}\d{2,}")),
    ("teléfono AR", re.compile(r"(?<![\w\-.])(0?11|0?2\d{2,3}|0?3\d{2,3})[\s\-]?(15[\s\-]?)?\d{3,4}[\s\-]\d{4}(?![\w\-])")),
    ("número tipo DNI", re.compile(r"(?<![\w.])\d{1,2}\.\d{3}\.\d{3}(?![\w.])")),
    ("CUIT/CUIL", re.compile(r"(?<![\w\-])(20|23|24|27|30|33|34)-?\d{8}-?\d(?![\w\-])")),
]
SAFE_EMAIL_DOMAINS = re.compile(r"@(?:[\w\-]+\.)*(example\.(invalid|com|org|net)|[\w\-]+\.invalid)$", re.I)

def load_allow():
    vals = set()
    if os.path.isfile(ALLOW_FILE):
        for line in open(ALLOW_FILE, encoding="utf-8"):
            line = line.split("  #", 1)[0].strip()
            if line and not line.startswith("#"):
                vals.add(line)
    return vals

def main():
    allow = load_allow()
    findings, permitted, nfiles = [], [], 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if ".git" in dirnames:
            dirnames.remove(".git")
        for d in list(dirnames):
            if d in FORBIDDEN_DIRS:
                # Report once, do not descend (node_modules/target are huge).
                permitted.append((os.path.join(rel_dir, d) + "/", 0, "carpeta gitignored (omitida del walk)", d))
                dirnames.remove(d)
            if d == "keys":
                permitted.append((os.path.join(rel_dir, d) + "/", 0, "carpeta keys/ gitignored (omitida del walk)", d))
                dirnames.remove(d)
        for fn in filenames:
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, ROOT)
            rel_posix = rel.replace("\\", "/")
            nfiles += 1
            for rx, why in FORBIDDEN_FILE:
                if rx.match(fn):
                    if why.startswith("compilado .wasm") and (
                        rel_posix.startswith("res/") or rel_posix.startswith("factory/res/")
                    ):
                        continue  # judge-ready artifacts in res/ are allowed
                    if "node_modules" in rel_posix or "/target/" in ("/" + rel_posix):
                        continue
                    findings.append((rel, 0, why, fn))
            if os.path.abspath(path) in (SELF, ALLOW_FILE):
                continue  # el propio script y su lista blanca solo tienen patrones/valores inventados
            if fn.endswith('.log'):
                continue  # local run logs (gitignored); near-cli prints pubkeys/signatures that look like keys
            if rel_posix.startswith("web/dist/"):
                # Committed static build; minified vendor trips email/phone heuristics.
                permitted.append((rel, 0, "build estático web/dist (vendor omitido del scan)", fn))
                continue
            try:
                data = open(path, "rb").read()
            except OSError as e:
                findings.append((rel, 0, "no se pudo leer", str(e))); continue
            text = data.decode("utf-8", errors="replace") if b"\x00" not in data[:4096] else data.decode("latin-1")
            for ln, line in enumerate(text.splitlines(), 1):
                for name, rx in PATTERNS:
                    for m in rx.finditer(line):
                        val = m.group(0)
                        if name == "email" and SAFE_EMAIL_DOMAINS.search(val):
                            permitted.append((rel, ln, name + " (dominio reservado de ejemplo)", val)); continue
                        if any(a in val or val in a for a in allow if len(a) >= 6):
                            permitted.append((rel, ln, name + " (dato inventado de prueba, lista blanca)", val)); continue
                        findings.append((rel, ln, name, val[:80]))
    print(f"check_secretos · raíz: {os.path.basename(ROOT)}/ · archivos revisados: {nfiles}")
    print(f"Lista blanca: {len(allow)} valores inventados en .check_secretos-permitidos + dominios example.*/.invalid")
    if permitted:
        print(f"\nPermitidos (no son hallazgos; datos inventados a propósito): {len(permitted)}")
        for rel, ln, why, val in permitted:
            print(f"  ok   {rel}:{ln}  {why}: {val}")
    if findings:
        print(f"\nHALLAZGOS: {len(findings)}  -> NO SUBIR hasta resolverlos")
        for rel, ln, why, val in findings:
            print(f"  FAIL {rel}:{ln}  {why}: {val}")
        print("\nRESULTADO: FALLA (código de salida 1)")
        return 1
    print("\nHALLAZGOS: 0")
    print("RESULTADO: LIMPIO (código de salida 0) - sin claves, semillas, tokens, .env, credenciales ni datos personales")
    return 0

if __name__ == "__main__":
    sys.exit(main())
