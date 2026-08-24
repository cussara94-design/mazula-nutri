import os
import json
import re
import requests
import bleach
from datetime import datetime
from functools import wraps

from flask import (
    Flask, g, jsonify, redirect, render_template, request, session, url_for,
)
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TURSO_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

if TURSO_URL:
    DATABASE_PATH = None
else:
    _db_dir = "/tmp" if not os.access(BASE_DIR, os.W_OK) else BASE_DIR
    DATABASE_PATH = os.path.join(_db_dir, "mazula.db")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("MAZULA_SECRET_KEY", "mazula-dev-secret-key"),
)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS works (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        work_type TEXT NOT NULL DEFAULT 'monografia',
        theme TEXT,
        area TEXT,
        keywords TEXT,
        objectives TEXT,
        abstract TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'rascunho',
        target_words INTEGER DEFAULT 10000,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS references_ (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        authors TEXT NOT NULL,
        year TEXT,
        title TEXT NOT NULL,
        source TEXT,
        doi TEXT,
        url TEXT,
        ref_type TEXT DEFAULT 'livro',
        pages TEXT,
        publisher TEXT,
        edition TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sections_work ON sections(work_id, order_index)",
    "CREATE INDEX IF NOT EXISTS idx_references_work ON references_(work_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_work ON chat_history(work_id)",
]

WORK_TYPES = {
    "monografia": {
        "label": "Monografia",
        "sections": ["Introducao", "Revisao de Literatura", "Fundamentacao Teorica", "Metodologia", "Resultados e Discussao", "Conclusao"],
    },
    "ensaio": {
        "label": "Ensaio",
        "sections": ["Introducao", "Desenvolvimento", "Conclusao"],
    },
    "projecto": {
        "label": "Projecto de Pesquisa",
        "sections": ["Introducao", "Revisao de Literatura", "Metodologia", "Cronograma", "Referencias"],
    },
    "revisao": {
        "label": "Revisao de Literatura",
        "sections": ["Introducao", "Metodo de Busca", "Resultados", "Discussao", "Conclusao"],
    },
    "artigo": {
        "label": "Artigo Cientifico",
        "sections": ["Introducao", "Metodos", "Resultados", "Discussao", "Conclusao"],
    },
    "tese": {
        "label": "Tese",
        "sections": ["Introducao", "Revisao de Literatura", "Fundamentacao Teorica", "Metodologia", "Analise e Discussao", "Conclusao", "Referencias"],
    },
}


class _TursoRow:
    __slots__ = ("_data", "_cols")
    def __init__(self, data, cols):
        object.__setattr__(self, "_data", data)
        object.__setattr__(self, "_cols", cols)
    def __getitem__(self, key):
        if isinstance(key, int):
            return self._data[key]
        idx = self._cols.index(key)
        return self._data[idx]
    def __contains__(self, key):
        return key in self._cols
    def keys(self):
        return self._cols
    def __iter__(self):
        return iter(self._data)
    def __len__(self):
        return len(self._data)


class _TursoCursor:
    def __init__(self, cursor):
        self._cur = cursor
        self._cols = []
        if hasattr(cursor, "description") and cursor.description:
            self._cols = [d[0] for d in cursor.description]

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    @property
    def rowcount(self):
        return self._cur.rowcount

    def _wrap_row(self, row):
        if row is None or not self._cols:
            return row
        return _TursoRow(row, self._cols)

    def fetchone(self):
        r = self._cur.fetchone()
        return self._wrap_row(r) if r else None

    def fetchall(self):
        return [self._wrap_row(r) for r in self._cur.fetchall()]


class _TursoConn:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        if params is not None:
            params = tuple(params)
            cur = self._conn.execute(sql, params)
        else:
            cur = self._conn.execute(sql)
        cols = []
        if hasattr(cur, "description") and cur.description:
            cols = [d[0] for d in cur.description]
        tc = _TursoCursor(cur)
        tc._cols = cols
        return tc

    def executescript(self, sql):
        for stmt in sql.split(";"):
            stmt = stmt.strip()
            if stmt:
                self.execute(stmt)

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def get_db():
    if "db" not in g:
        if TURSO_URL:
            import libsql_experimental as libsql
            raw = libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
            g.db = _TursoConn(raw)
        else:
            import sqlite3 as _sqlite3
            conn = _sqlite3.connect(DATABASE_PATH)
            conn.row_factory = _sqlite3.Row
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA journal_mode=WAL")
            g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    for stmt in SCHEMA:
        try:
            db.execute(stmt)
        except Exception:
            pass
    for col, default in [("abstract", ""), ("target_words", 10000)]:
        try:
            db.execute("ALTER TABLE works ADD COLUMN {} DEFAULT {}".format(col, default))
        except Exception:
            pass
    try:
        db.execute("CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, work_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT)")
    except Exception:
        pass
    try:
        db.execute("UPDATE users SET name = 'Academico', email = 'admin@trabalhofacil.com' WHERE name = 'Nutricionista' OR email = 'admin@nutri.local'")
    except Exception:
        pass
    db.commit()


def row_to_dict(row):
    if row is None:
        return None
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    try:
        return dict(row)
    except Exception:
        return None


def rows_to_list(rows):
    return [row_to_dict(r) for r in rows]


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_str():
    return datetime.now().strftime("%Y-%m-%d")


def json_body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'a', 'span']
ALLOWED_ATTRS = {'a': ['href', 'target'], 'span': ['style']}


def sanitize_html(text):
    if not text:
        return ""
    clean = bleach.clean(text, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
    return clean


def fetch_owned(table, row_id, user_id):
    db = get_db()
    return db.execute(
        'SELECT * FROM "{}" WHERE id = ? AND user_id = ?'.format(table),
        (row_id, user_id),
    ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        uid = session.get("user_id")
        if uid is None:
            return jsonify({"error": "Sessao expirada. Faca login novamente."}), 401
        db = get_db()
        user = db.execute("SELECT id FROM users WHERE id = ?", (uid,)).fetchone()
        if user is None:
            session.clear()
            return jsonify({"error": "Usuario nao encontrado."}), 401
        return view(*args, **kwargs)
    return wrapped_view


def current_user():
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    return row_to_dict(row)


def public_user(user):
    if not user:
        return None
    return {"id": user["id"], "name": user["name"], "email": user["email"], "created_at": user.get("created_at")}


def groq_chat(messages, temperature=0.7, max_tokens=4096):
    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": "Bearer {}".format(GROQ_API_KEY), "Content-Type": "application/json"},
        json={"model": "qwen/qwen3.6-27b", "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
        timeout=90,
    )
    if resp.status_code != 200:
        error_msg = "Erro ao comunicar com a IA."
        try:
            error_msg = resp.json().get("error", {}).get("message", error_msg)
        except Exception:
            pass
        return None, error_msg
    return resp.json().get("choices", [{}])[0].get("message", {}).get("content", ""), None


def get_work_context(db, work_id, uid):
    work = db.execute("SELECT * FROM works WHERE id = ? AND user_id = ?", (work_id, uid)).fetchone()
    if not work:
        return None, None
    work = row_to_dict(work)
    ctx = "TRABALHO ACADEMICO:\n"
    ctx += "Titulo: {}\nTema: {}\nArea: {}\nPalavras-chave: {}\nObjectivos: {}\nResumo: {}\n\n".format(
        work.get("title") or "", work.get("theme") or "", work.get("area") or "",
        work.get("keywords") or "", work.get("objectives") or "", work.get("abstract") or "",
    )
    secs = db.execute("SELECT title, content FROM sections WHERE work_id = ? ORDER BY order_index", (work_id,)).fetchall()
    ctx += "SECOES:\n"
    for s in secs:
        sd = row_to_dict(s)
        content = sd.get("content") or ""
        ctx += "\n--- {} ---\n{}\n".format(sd["title"], content[:500] if content else "(vazio)")
    refs = db.execute("SELECT authors, year, title, source FROM references_ WHERE work_id = ? ORDER BY authors", (work_id,)).fetchall()
    if refs:
        ctx += "\nREFERENCIAS:\n"
        for r in refs:
            rd = row_to_dict(r)
            ctx += "- {} ({}) {}. {}\n".format(rd.get("authors") or "", rd.get("year") or "s.d.", rd.get("title") or "", rd.get("source") or "")
    return work, ctx


@app.errorhandler(HTTPException)
def handle_http_exception(exc):
    if request.path.startswith("/api/"):
        return jsonify({"error": exc.description}), exc.code
    return exc


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/login")
def login_page():
    return redirect(url_for("index"))


@app.route("/register")
def register_page():
    return redirect(url_for("index"))


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = json_body()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Nome, email e senha obrigatorios."}), 400
    if len(password) < 6:
        return jsonify({"error": "A senha deve ter pelo menos 6 caracteres."}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing is not None:
        return jsonify({"error": "Ja existe uma conta com este email."}), 409
    cur = db.execute(
        "INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)",
        (name, email, generate_password_hash(password), now_str()),
    )
    db.commit()
    session.clear()
    session["user_id"] = cur.lastrowid
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"message": "Conta criada.", "user": public_user(row_to_dict(user))}), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = json_body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email e senha obrigatorios."}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not check_password_hash(user["password"], password):
        return jsonify({"error": "Email ou senha invalidos."}), 401
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"message": "Sessao iniciada.", "user": public_user(row_to_dict(user))})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"message": "Sessao encerrada."})


@app.route("/api/auth/me")
def auth_me():
    if session.get("user_id") is None:
        return jsonify({"user": None})
    user = current_user()
    if user is None:
        session.clear()
        return jsonify({"user": None})
    return jsonify({"user": public_user(user)})


@app.route("/api/dashboard")
@login_required
def dashboard():
    uid = session["user_id"]
    db = get_db()
    total = db.execute("SELECT COUNT(*) AS c FROM works WHERE user_id = ?", (uid,)).fetchone()["c"]
    rascunho = db.execute("SELECT COUNT(*) AS c FROM works WHERE user_id = ? AND status = 'rascunho'", (uid,)).fetchone()["c"]
    concluido = db.execute("SELECT COUNT(*) AS c FROM works WHERE user_id = ? AND status = 'concluido'", (uid,)).fetchone()["c"]
    recent = rows_to_list(
        db.execute("SELECT * FROM works WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5", (uid,)).fetchall()
    )
    return jsonify({"total": total, "rascunho": rascunho, "concluido": concluido, "recent": recent})


@app.route("/api/work-types")
@login_required
def work_types():
    return jsonify({"types": WORK_TYPES})


@app.route("/api/works", methods=["GET"])
@login_required
def works_list():
    uid = session["user_id"]
    db = get_db()
    rows = db.execute("SELECT * FROM works WHERE user_id = ? ORDER BY updated_at DESC", (uid,)).fetchall()
    return jsonify({"works": rows_to_list(rows)})


@app.route("/api/works", methods=["POST"])
@login_required
def works_create():
    uid = session["user_id"]
    data = json_body()
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Titulo e obrigatorio."}), 400
    work_type = data.get("work_type") or "monografia"
    if work_type not in WORK_TYPES:
        work_type = "monografia"
    db = get_db()
    now = now_str()
    cur = db.execute(
        "INSERT INTO works (user_id, title, work_type, theme, area, keywords, objectives, status, target_words, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (uid, title, work_type, (data.get("theme") or "").strip(), (data.get("area") or "").strip(), (data.get("keywords") or "").strip(), (data.get("objectives") or "").strip(), "rascunho", int(data.get("target_words") or 10000), now, now),
    )
    work_id = cur.lastrowid
    sections = WORK_TYPES.get(work_type, WORK_TYPES["monografia"])["sections"]
    for i, sec_title in enumerate(sections):
        db.execute(
            "INSERT INTO sections (work_id, title, content, order_index, created_at) VALUES (?, ?, ?, ?, ?)",
            (work_id, sec_title, "", i, now),
        )
    db.commit()
    row = db.execute("SELECT * FROM works WHERE id = ? AND user_id = ?", (work_id, uid)).fetchone()
    return jsonify({"work": row_to_dict(row)}), 201


@app.route("/api/works/<int:work_id>", methods=["GET"])
@login_required
def works_get(work_id):
    uid = session["user_id"]
    db = get_db()
    row = db.execute("SELECT * FROM works WHERE id = ? AND user_id = ?", (work_id, uid)).fetchone()
    if row is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    work = row_to_dict(row)
    work["sections"] = rows_to_list(
        db.execute("SELECT * FROM sections WHERE work_id = ? ORDER BY order_index", (work_id,)).fetchall()
    )
    work["references"] = rows_to_list(
        db.execute("SELECT * FROM references_ WHERE work_id = ? ORDER BY authors", (work_id,)).fetchall()
    )
    work["chat_history"] = rows_to_list(
        db.execute("SELECT * FROM chat_history WHERE work_id = ? ORDER BY id", (work_id,)).fetchall()
    )
    total_words = 0
    for s in work["sections"]:
        content = s.get("content") or ""
        s["word_count"] = len(content.split()) if content.strip() else 0
        total_words += s["word_count"]
    work["total_words"] = total_words
    return jsonify({"work": work})


@app.route("/api/works/<int:work_id>", methods=["PUT"])
@login_required
def works_update(work_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("works", work_id, uid)
    if row is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    data = json_body()
    allowed = ("title", "theme", "area", "keywords", "objectives", "status", "target_words", "abstract")
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        return jsonify({"error": "Nenhum campo para atualizar."}), 400
    updates["updated_at"] = now_str()
    set_sql = ", ".join('"{}" = ?'.format(c) for c in updates)
    db.execute(
        'UPDATE works SET {} WHERE id = ? AND user_id = ?'.format(set_sql),
        list(updates.values()) + [work_id, uid],
    )
    db.commit()
    row = db.execute("SELECT * FROM works WHERE id = ? AND user_id = ?", (work_id, uid)).fetchone()
    return jsonify({"work": row_to_dict(row)})


@app.route("/api/works/<int:work_id>", methods=["DELETE"])
@login_required
def works_delete(work_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("works", work_id, uid)
    if row is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    db.execute("DELETE FROM sections WHERE work_id = ?", (work_id,))
    db.execute("DELETE FROM references_ WHERE work_id = ?", (work_id,))
    db.execute("DELETE FROM chat_history WHERE work_id = ?", (work_id,))
    db.execute("DELETE FROM works WHERE id = ? AND user_id = ?", (work_id, uid))
    db.commit()
    return jsonify({"message": "Trabalho excluido."})


@app.route("/api/works/<int:work_id>/sections", methods=["POST"])
@login_required
def section_create(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    data = json_body()
    title = (data.get("title") or "Nova Secao").strip()
    content = sanitize_html(data.get("content") or "")
    max_idx = db.execute("SELECT COALESCE(MAX(order_index), -1) as mx FROM sections WHERE work_id = ?", (work_id,)).fetchone()["mx"]
    now = now_str()
    cur = db.execute(
        "INSERT INTO sections (work_id, title, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (work_id, title, content, max_idx + 1, now, now),
    )
    db.execute("UPDATE works SET updated_at = ? WHERE id = ?", (now, work_id))
    db.commit()
    row = db.execute("SELECT * FROM sections WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"section": row_to_dict(row)}), 201


@app.route("/api/works/<int:work_id>/sections/<int:section_id>", methods=["DELETE"])
@login_required
def section_delete(work_id, section_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    sec = db.execute("SELECT id FROM sections WHERE id = ? AND work_id = ?", (section_id, work_id)).fetchone()
    if sec is None:
        return jsonify({"error": "Secao nao encontrada."}), 404
    db.execute("DELETE FROM sections WHERE id = ?", (section_id,))
    db.execute("UPDATE works SET updated_at = ? WHERE id = ?", (now_str(), work_id))
    db.commit()
    return jsonify({"message": "Secao excluida."})


@app.route("/api/works/<int:work_id>/sections/<int:section_id>", methods=["PUT"])
@login_required
def section_update(work_id, section_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    data = json_body()
    content = data.get("content")
    title = data.get("title")
    updates = {"updated_at": now_str()}
    if content is not None:
        updates["content"] = sanitize_html(content)
    if title is not None:
        updates["title"] = title
    set_sql = ", ".join('"{}" = ?'.format(c) for c in updates)
    db.execute(
        'UPDATE sections SET {} WHERE id = ? AND work_id = ?'.format(set_sql),
        list(updates.values()) + [section_id, work_id],
    )
    db.execute("UPDATE works SET updated_at = ? WHERE id = ?", (now_str(), work_id))
    db.commit()
    row = db.execute("SELECT * FROM sections WHERE id = ?", (section_id,)).fetchone()
    return jsonify({"section": row_to_dict(row)})


@app.route("/api/works/<int:work_id>/references", methods=["GET"])
@login_required
def refs_list(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    rows = db.execute("SELECT * FROM references_ WHERE work_id = ? ORDER BY authors", (work_id,)).fetchall()
    return jsonify({"references": rows_to_list(rows)})


@app.route("/api/works/<int:work_id>/references", methods=["POST"])
@login_required
def refs_create(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    data = json_body()
    authors = (data.get("authors") or "").strip()
    title = (data.get("title") or "").strip()
    if not authors or not title:
        return jsonify({"error": "Autores e titulo sao obrigatorios."}), 400
    now = now_str()
    cur = db.execute(
        "INSERT INTO references_ (work_id, authors, year, title, source, doi, url, ref_type, pages, publisher, edition, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (work_id, authors, (data.get("year") or "").strip(), title, (data.get("source") or "").strip(), (data.get("doi") or "").strip(), (data.get("url") or "").strip(), (data.get("ref_type") or "livro").strip(), (data.get("pages") or "").strip(), (data.get("publisher") or "").strip(), (data.get("edition") or "").strip(), now),
    )
    db.commit()
    row = db.execute("SELECT * FROM references_ WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"reference": row_to_dict(row)}), 201


@app.route("/api/works/<int:work_id>/references/<int:ref_id>", methods=["DELETE"])
@login_required
def refs_delete(work_id, ref_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    db.execute("DELETE FROM references_ WHERE id = ? AND work_id = ?", (ref_id, work_id))
    db.commit()
    return jsonify({"message": "Referencia excluida."})


@app.route("/api/works/<int:work_id>/references/format-apa", methods=["GET"])
@login_required
def refs_format_apa(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    rows = db.execute("SELECT * FROM references_ WHERE work_id = ? ORDER BY authors", (work_id,)).fetchall()
    refs = rows_to_list(rows)
    formatted = []
    for r in refs:
        authors = (r.get("authors") or "").strip().rstrip(".")
        year = r.get("year") or "s.d."
        title = (r.get("title") or "").strip().rstrip(".")
        source = (r.get("source") or "").strip()
        doi = (r.get("doi") or "").strip()
        pages = (r.get("pages") or "").strip()
        publisher = (r.get("publisher") or "").strip()
        edition = (r.get("edition") or "").strip()
        apa = "{} ({})".format(authors, year)
        apa += ". {}.".format(title)
        if source:
            if pages:
                apa += " {}. pp. {}.".format(source, pages)
            else:
                apa += " {}.".format(source)
        if edition:
            apa += " {} ed.".format(edition)
        if publisher:
            apa += " {}.".format(publisher)
        if doi:
            apa += " https://doi.org/{}".format(doi)
        elif not source:
            apa += "."
        formatted.append({"id": r["id"], "apa": apa})
    return jsonify({"formatted": formatted})


@app.route("/api/import-doi", methods=["POST"])
@login_required
def import_doi():
    data = json_body()
    identifier = (data.get("identifier") or "").strip()
    work_id = data.get("work_id")
    if not identifier:
        return jsonify({"error": "Forneca um DOI ou ISBN."}), 400
    uid = session["user_id"]
    db = get_db()
    if work_id:
        work = fetch_owned("works", work_id, uid)
        if work is None:
            return jsonify({"error": "Trabalho nao encontrado."}), 404
    ref_data = None
    if identifier.startswith("10."):
        try:
            clean_doi = identifier.lstrip("doi:").lstrip("DOI:").strip()
            if not clean_doi.startswith("http"):
                clean_doi = "https://doi.org/" + clean_doi
            r = requests.get("https://api.crossref.org/works/" + identifier.lstrip("doi:").lstrip("DOI:").strip(), timeout=15)
            if r.status_code == 200:
                d = r.json().get("message", {})
                authors_list = d.get("author", [])
                if authors_list:
                    parts = []
                    for a in authors_list:
                        family = a.get("family", "")
                        given = a.get("given", "")
                        if family and given:
                            parts.append("{}, {}".format(family, given[0] + "."))
                        elif family:
                            parts.append(family)
                    authors_str = ", ".join(parts)
                else:
                    authors_str = "Autor desconhecido"
                year = ""
                dp = d.get("published-print") or d.get("published-online") or d.get("created")
                if dp and dp.get("date-parts"):
                    year = str(dp["date-parts"][0][0])
                source = ""
                container = d.get("container-title")
                if container:
                    source = container[0] if isinstance(container, list) else container
                ref_data = {
                    "authors": authors_str,
                    "year": year,
                    "title": (d.get("title") or [""])[0] if d.get("title") else "",
                    "source": source,
                    "doi": identifier.lstrip("doi:").lstrip("DOI:").strip(),
                    "url": clean_doi,
                    "ref_type": "artigo",
                    "publisher": d.get("publisher", ""),
                }
        except Exception:
            pass
    if not ref_data:
        try:
            r = requests.get("https://openlibrary.org/isbn/{}.json".format(identifier), timeout=15)
            if r.status_code == 200:
                d = r.json()
                title = d.get("title", "")
                authors_str = "Autor desconhecido"
                if d.get("authors"):
                    a_ids = [a.get("key") for a in d["authors"] if a.get("key")]
                    a_names = []
                    for aid in a_ids[:5]:
                        try:
                            ar = requests.get("https://openlibrary.org{}.json".format(aid), timeout=10)
                            if ar.status_code == 200:
                                ad = ar.json()
                                name = ad.get("name", "")
                                if name:
                                    a_names.append(name)
                        except Exception:
                            pass
                    if a_names:
                        authors_str = ", ".join(a_names)
                year = ""
                if d.get("publish_date"):
                    m = re.search(r"(\d{4})", d["publish_date"])
                    if m:
                        year = m.group(1)
                publishers = d.get("publishers") or []
                source = publishers[0] if publishers else ""
                ref_data = {
                    "authors": authors_str,
                    "year": year,
                    "title": title,
                    "source": source,
                    "doi": "",
                    "url": "https://openlibrary.org/isbn/{}".format(identifier),
                    "ref_type": "livro",
                    "publisher": source,
                }
        except Exception:
            pass
    if not ref_data:
        return jsonify({"error": "Nao foi possivel encontrar dados para '{}'.".format(identifier)}), 404
    if work_id:
        now = now_str()
        cur = db.execute(
            "INSERT INTO references_ (work_id, authors, year, title, source, doi, url, ref_type, pages, publisher, edition, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (work_id, ref_data["authors"], ref_data["year"], ref_data["title"], ref_data["source"], ref_data.get("doi", ""), ref_data.get("url", ""), ref_data.get("ref_type", "livro"), "", ref_data.get("publisher", ""), "", now),
        )
        db.commit()
        row = db.execute("SELECT * FROM references_ WHERE id = ?", (cur.lastrowid,)).fetchone()
        return jsonify({"reference": row_to_dict(row), "imported": True}), 201
    return jsonify({"reference": ref_data, "imported": False})


@app.route("/api/generate", methods=["POST"])
@login_required
def api_generate():
    if not GROQ_API_KEY:
        return jsonify({"error": "Chave API do Groq nao configurada."}), 503
    data = json_body()
    prompt = (data.get("prompt") or "").strip()
    work_id = data.get("work_id")
    section_title = (data.get("section_title") or "").strip()
    mode = data.get("mode") or "generate"
    selected_text = (data.get("selected_text") or "").strip()

    db = get_db()
    uid = session["user_id"]
    work_ctx = ""
    if work_id:
        _, work_ctx = get_work_context(db, work_id, uid) or ("", "")

    sys_base = """Voce e um assistente academico especializado em trabalhos cientificos em lingua portuguesa de Mocambique.
REGRAS: linguagem formal e academica, terceira pessoa, vocabulario tecnico, sem abreviacoes informais, texto original."""

    if mode == "generate":
        sys_msg = sys_base + "\n\nGere conteudo academico para a secção '{}'.".format(section_title or "Trabalho")
        if work_ctx:
            sys_msg += "\n\nContexto:\n" + work_ctx[:1500]
        sys_msg += "\n\nOrientacao: {}".format(prompt or "Gere texto academico completo (minimo 300 palavras).")
    elif mode == "summarize":
        sys_msg = sys_base + "\n\nResuma o seguinte texto academico de forma concisa e objetiva, mantendo os pontos principais:"
        sys_msg += "\n\nTEXTO:\n{}".format(selected_text or prompt)
    elif mode == "expand":
        sys_msg = sys_base + "\n\nExpanda o seguinte texto academico, adicionando mais detalhes, analise e profundidade. Mantenha o contexto original:"
        if work_ctx:
            sys_msg += "\n\nContexto do trabalho:\n" + work_ctx[:800]
        sys_msg += "\n\nTEXTO A EXPANDIR:\n{}".format(selected_text or prompt)
    elif mode == "rewrite":
        sys_msg = sys_base + "\n\nReescreva o seguinte texto academico de forma melhorada, mais fluente e profissional. Mantenha o significado original:"
        sys_msg += "\n\nTEXTO ORIGINAL:\n{}".format(selected_text or prompt)
    elif mode == "translate":
        target = data.get("target") or "ingles"
        sys_msg = "Traduza o texto academico seguinte para {}. Mantenha o formato e o estilo academico.".format(target)
        sys_msg += "\n\nTEXTO:\n{}".format(selected_text or prompt)
    elif mode == "correct":
        sys_msg = sys_base + "\n\nCorrija erros de ortografia, gramatica e estilo no texto academico seguinte. Apenas corrija, nao altere o significado:"
        sys_msg += "\n\nTEXTO:\n{}".format(selected_text or prompt)
    elif mode == "outline":
        sys_msg = sys_base + "\n\nGere um esqueleto/outline detalhado para um trabalho academico."
        if work_ctx:
            sys_msg += "\n\nContexto:\n" + work_ctx[:800]
        sys_msg += "\n\n{}".format(prompt or "Gere o outline completo.")
    elif mode == "abstract":
        sys_msg = sys_base + "\n\nGere um resumo/abstract academico baseado no seguinte conteudo do trabalho:"
        sys_msg += "\n\n{}".format(work_ctx[:2000] if work_ctx else prompt)
    elif mode == "keywords":
        sys_msg = sys_base + "\n\nSugira 5-8 palavras-chave academicas adequadas para o seguinte trabalho. Responda APENAS com as palavras separadas por virgula:"
        sys_msg += "\n\n{}".format(work_ctx[:1500] if work_ctx else prompt)
    elif mode == "chat":
        sys_msg = sys_base + "\n\nO usuario esta a trabalhar num trabalho academico. Responda as perguntas e ajude com o conteudo."
        if work_ctx:
            sys_msg += "\n\nContexto do trabalho:\n" + work_ctx[:2000]
        history = db.execute("SELECT role, content FROM chat_history WHERE work_id = ? ORDER BY id DESC LIMIT 10", (work_id,)).fetchall() if work_id else []
        for h in reversed(history):
            hd = row_to_dict(h)
            sys_msg += "\n{}: {}".format(hd["role"].capitalize(), hd["content"][:200])
    else:
        sys_msg = sys_base
        if work_ctx:
            sys_msg += "\n\nContexto:\n" + work_ctx[:1000]
        sys_msg += "\n\n{}".format(prompt)

    if mode == "chat" and work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (work_id, prompt, now_str()))
        db.commit()

    user_msg = prompt if mode not in ("summarize", "expand", "rewrite", "translate", "correct") else (selected_text or prompt)
    if mode == "generate" and not selected_text:
        user_msg = prompt or "Gere o conteudo."

    messages = [
        {"role": "system", "content": sys_msg},
        {"role": "user", "content": user_msg or "Por favor, ajude."},
    ]

    text, error = groq_chat(messages)
    if error:
        return jsonify({"error": error}), 502

    if mode == "chat" and work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (work_id, text, now_str()))
        db.commit()

    return jsonify({"text": text, "mode": mode})


@app.route("/api/works/<int:work_id>/chat", methods=["GET"])
@login_required
def chat_history(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    rows = db.execute("SELECT * FROM chat_history WHERE work_id = ? ORDER BY id", (work_id,)).fetchall()
    return jsonify({"messages": rows_to_list(rows)})


@app.route("/api/works/<int:work_id>/chat", methods=["DELETE"])
@login_required
def chat_clear(work_id):
    uid = session["user_id"]
    db = get_db()
    work = fetch_owned("works", work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    db.execute("DELETE FROM chat_history WHERE work_id = ?", (work_id,))
    db.commit()
    return jsonify({"message": "Historico limpo."})


@app.route("/api/all")
@login_required
def api_all():
    uid = session["user_id"]
    db = get_db()
    works = rows_to_list(db.execute("SELECT * FROM works WHERE user_id = ? ORDER BY updated_at DESC", (uid,)).fetchall())
    refs = rows_to_list(db.execute("SELECT * FROM references_ WHERE work_id IN (SELECT id FROM works WHERE user_id = ?) ORDER BY authors", (uid,)).fetchall())
    chat = rows_to_list(db.execute("SELECT * FROM chat_history WHERE work_id IN (SELECT id FROM works WHERE user_id = ?) ORDER BY id", (uid,)).fetchall())
    return jsonify({"works": works, "references": refs, "chat": chat})


@app.route("/api/ai", methods=["POST"])
@login_required
def api_ai():
    if not GROQ_API_KEY:
        return jsonify({"error": "Chave API do Groq nao configurada."}), 503
    data = json_body()
    mode = data.get("mode") or "generate"
    prompt = (data.get("prompt") or "").strip()
    work_id = data.get("work_id")
    lang = data.get("language") or "Portugues"
    tone = data.get("tone") or "Academico"
    uid = session["user_id"]
    db = get_db()
    work_ctx = ""
    if work_id:
        _, work_ctx = get_work_context(db, work_id, uid) or ("", "")
    sys_base = """Voce e um assistente academico especializado em trabalhos cientificos em lingua portuguesa de Mocambique.
REGRAS: linguagem formal e academica, terceira pessoa, vocabulario tecnico, sem abreviacoes informais, texto original.
Idioma: {}. Tom: {}.""".format(lang, tone)
    if mode == "generate":
        sys_msg = sys_base + "\n\nGere conteudo academico completo."
        if work_ctx:
            sys_msg += "\n\nContexto:\n" + work_ctx[:1500]
        sys_msg += "\n\nOrientacao: {}".format(prompt or "Gere texto academico completo (minimo 300 palavras).")
    elif mode == "summarize":
        sys_msg = sys_base + "\n\nResuma o seguinte texto academico:\n\n" + (prompt or "")
    elif mode == "expand":
        sys_msg = sys_base + "\n\nExpanda o seguinte texto academico:\n\n" + (prompt or "")
    elif mode == "rewrite":
        sys_msg = sys_base + "\n\nReescreva o seguinte texto academico de forma melhorada:\n\n" + (prompt or "")
    elif mode == "translate":
        sys_msg = "Traduza o texto academico seguinte para {}. Mantenha o formato academico.\n\n{}".format(lang, prompt or "")
    elif mode == "correct":
        sys_msg = sys_base + "\n\nCorrija erros de ortografia, gramatica e estilo:\n\n" + (prompt or "")
    else:
        sys_msg = sys_base
        if work_ctx:
            sys_msg += "\n\nContexto:\n" + work_ctx[:1000]
        sys_msg += "\n\n" + (prompt or "")
    if mode == "chat" and work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (work_id, prompt, now_str()))
        db.commit()
    messages = [{"role": "system", "content": sys_msg}, {"role": "user", "content": prompt or "Ajude-me."}]
    text, error = groq_chat(messages)
    if error:
        return jsonify({"error": error}), 502
    if mode == "chat" and work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (work_id, text, now_str()))
        db.commit()
    return jsonify({"result": text, "mode": mode})


@app.route("/api/import_ref", methods=["POST"])
@login_required
def api_import_ref():
    data = json_body()
    identifier = (data.get("identifier") or "").strip()
    if not identifier:
        return jsonify({"error": "Forneca um DOI ou ISBN."}), 400
    ref_data = None
    if identifier.startswith("10."):
        try:
            r = requests.get("https://api.crossref.org/works/" + identifier.lstrip("doi:").lstrip("DOI:").strip(), timeout=15)
            if r.status_code == 200:
                d = r.json().get("message", {})
                authors_list = d.get("author", [])
                if authors_list:
                    parts = []
                    for a in authors_list:
                        family = a.get("family", "")
                        given = a.get("given", "")
                        if family and given:
                            parts.append("{}, {}".format(family, given[0] + "."))
                        elif family:
                            parts.append(family)
                    authors_str = ", ".join(parts)
                else:
                    authors_str = "Autor desconhecido"
                year = ""
                dp = d.get("published-print") or d.get("published-online") or d.get("created")
                if dp and dp.get("date-parts"):
                    year = str(dp["date-parts"][0][0])
                source = ""
                container = d.get("container-title")
                if container:
                    source = container[0] if isinstance(container, list) else container
                ref_data = {
                    "authors": authors_str,
                    "year": year,
                    "title": (d.get("title") or [""])[0] if d.get("title") else "",
                    "source": source,
                    "doi": identifier.lstrip("doi:").lstrip("DOI:").strip(),
                    "url": "https://doi.org/" + identifier.lstrip("doi:").lstrip("DOI:").strip(),
                    "ref_type": "artigo",
                    "publisher": d.get("publisher", ""),
                }
        except Exception:
            pass
    if not ref_data:
        try:
            r = requests.get("https://openlibrary.org/isbn/{}.json".format(identifier), timeout=15)
            if r.status_code == 200:
                d = r.json()
                title = d.get("title", "")
                authors_str = "Autor desconhecido"
                if d.get("authors"):
                    a_ids = [a.get("key") for a in d["authors"] if a.get("key")]
                    a_names = []
                    for aid in a_ids[:5]:
                        try:
                            ar = requests.get("https://openlibrary.org{}.json".format(aid), timeout=10)
                            if ar.status_code == 200:
                                ad = ar.json()
                                name = ad.get("name", "")
                                if name:
                                    a_names.append(name)
                        except Exception:
                            pass
                    if a_names:
                        authors_str = ", ".join(a_names)
                year = ""
                if d.get("publish_date"):
                    m = re.search(r"(\d{4})", d["publish_date"])
                    if m:
                        year = m.group(1)
                publishers = d.get("publishers") or []
                source = publishers[0] if publishers else ""
                ref_data = {
                    "authors": authors_str,
                    "year": year,
                    "title": title,
                    "source": source,
                    "doi": "",
                    "url": "https://openlibrary.org/isbn/{}".format(identifier),
                    "ref_type": "livro",
                    "publisher": source,
                }
        except Exception:
            pass
    if not ref_data:
        return jsonify({"error": "Nao foi possivel encontrar dados para '{}'.".format(identifier)}), 404
    return jsonify(ref_data)


@app.route("/api/chat", methods=["POST"])
@login_required
def api_chat():
    if not GROQ_API_KEY:
        return jsonify({"error": "Chave API do Groq nao configurada."}), 503
    data = json_body()
    msg = (data.get("message") or "").strip()
    work_id = data.get("work_id")
    if not msg:
        return jsonify({"error": "Mensagem obrigatoria."}), 400
    uid = session["user_id"]
    db = get_db()
    work_ctx = data.get("context") or ""
    if work_id and not work_ctx:
        _, work_ctx = get_work_context(db, work_id, uid) or ("", "")
    sys_msg = """Voce e um assistente academico especializado em trabalhos cientificos em Mocambique.
REGRAS: linguagem formal e academica, terceira pessoa, vocabulario tecnico, sem abreviacoes informais, texto original, cite fontes reais APA 7a.
Se o usuario pedir para gerar conteudo, gere paragrafos academicos completos com citações APA."""
    if work_ctx:
        sys_msg += "\n\nContexto do trabalho:\n" + work_ctx[:2000]
    if work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'user', ?, ?)", (work_id, msg, now_str()))
        db.commit()
        history = db.execute("SELECT role, content FROM chat_history WHERE work_id = ? ORDER BY id DESC LIMIT 10", (work_id,)).fetchall()
        for h in reversed(history):
            hd = row_to_dict(h)
            sys_msg += "\n{}: {}".format(hd["role"].capitalize(), hd["content"][:200])
    messages = [{"role": "system", "content": sys_msg}, {"role": "user", "content": msg}]
    text, error = groq_chat(messages)
    if error:
        return jsonify({"error": error}), 502
    if work_id:
        db.execute("INSERT INTO chat_history (work_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)", (work_id, text, now_str()))
        db.commit()
    return jsonify({"result": text})


@app.route("/api/references", methods=["POST"])
@login_required
def api_refs_create():
    uid = session["user_id"]
    data = json_body()
    work_id = data.get("work_id")
    if work_id:
        db = get_db()
        work = fetch_owned("works", work_id, uid)
        if work is None:
            return jsonify({"error": "Trabalho nao encontrado."}), 404
    authors = (data.get("authors") or "").strip()
    title = (data.get("title") or "").strip()
    if not authors or not title:
        return jsonify({"error": "Autores e titulo obrigatorios."}), 400
    db = get_db()
    now = now_str()
    cur = db.execute(
        "INSERT INTO references_ (work_id, authors, year, title, source, doi, url, ref_type, pages, publisher, edition, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (work_id or 0, authors, (data.get("year") or "").strip(), title, (data.get("source") or "").strip(), (data.get("doi") or "").strip(), (data.get("url") or "").strip(), (data.get("ref_type") or "livro").strip(), (data.get("pages") or "").strip(), (data.get("publisher") or "").strip(), (data.get("edition") or "").strip(), now),
    )
    db.commit()
    row = db.execute("SELECT * FROM references_ WHERE id = ?", (cur.lastrowid,)).fetchone()
    d = row_to_dict(row)
    authors_apa = (d.get("authors") or "").strip().rstrip(".")
    year_apa = d.get("year") or "s.f."
    title_apa = (d.get("title") or "").strip().rstrip(".")
    d["citation_apa"] = "{} ({}). {}.".format(authors_apa, year_apa, title_apa)
    return jsonify(d), 201


@app.route("/api/references/<int:ref_id>", methods=["DELETE"])
@login_required
def api_refs_delete(ref_id):
    uid = session["user_id"]
    db = get_db()
    ref = db.execute(
        "SELECT r.id FROM references_ r JOIN works w ON r.work_id = w.id WHERE r.id = ? AND w.user_id = ?",
        (ref_id, uid)
    ).fetchone()
    if ref is None:
        return jsonify({"error": "Referencia nao encontrada."}), 404
    db.execute("DELETE FROM references_ WHERE id = ?", (ref_id,))
    db.commit()
    return jsonify({"message": "Referencia removida."})


@app.route("/api/login", methods=["POST"])
def api_login():
    data = json_body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email e senha obrigatorios."}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not check_password_hash(user["password"], password):
        return jsonify({"error": "Email ou senha invalidos."}), 401
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"name": user["name"], "email": user["email"], "id": user["id"]})


@app.route("/api/register", methods=["POST"])
def api_register():
    data = json_body()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Nome, email e senha obrigatorios."}), 400
    if len(password) < 6:
        return jsonify({"error": "A senha deve ter pelo menos 6 caracteres."}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing is not None:
        return jsonify({"error": "Ja existe uma conta com este email."}), 409
    cur = db.execute(
        "INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)",
        (name, email, generate_password_hash(password), now_str()),
    )
    db.commit()
    session.clear()
    session["user_id"] = cur.lastrowid
    return jsonify({"name": name, "email": email, "id": cur.lastrowid}), 201


@app.route("/api/export/<int:work_id>")
@login_required
def export_work(work_id):
    uid = session["user_id"]
    db = get_db()
    work, ctx = get_work_context(db, work_id, uid)
    if work is None:
        return jsonify({"error": "Trabalho nao encontrado."}), 404
    sections = rows_to_list(
        db.execute("SELECT * FROM sections WHERE work_id = ? ORDER BY order_index", (work_id,)).fetchall()
    )
    refs = rows_to_list(
        db.execute("SELECT * FROM references_ WHERE work_id = ? ORDER BY authors", (work_id,)).fetchall()
    )
    total_words = 0
    for s in sections:
        c = s.get("content") or ""
        s["word_count"] = len(c.split()) if c.strip() else 0
        total_words += s["word_count"]

    html = """<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
body {{ font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 2; margin: 2.5cm; color: #000; }}
h1 {{ font-size: 16pt; text-align: center; margin-bottom: 30pt; font-weight: bold; }}
h2 {{ font-size: 14pt; margin-top: 24pt; margin-bottom: 12pt; font-weight: bold; }}
p {{ text-align: justify; text-indent: 1.25cm; margin: 0 0 6pt; }}
.meta {{ text-align: center; margin-bottom: 30pt; font-size: 12pt; }}
.meta p {{ text-indent: 0; text-align: center; }}
.ref {{ text-indent: -1.25cm; padding-left: 1.25cm; margin-bottom: 6pt; }}
@page {{ size: A4; margin: 2.5cm; }}
@media print {{ body {{ margin: 0; }} }}
</style>
</head>
<body>
<h1>{title}</h1>
<div class="meta">
{meta_html}
</div>
{sections_html}
<h2>Referencias Bibliograficas</h2>
{refs_html}
<p style="text-align:center;color:#999;font-size:10pt;margin-top:40pt;">Gerado por Cussara Academic - {date}</p>
</body>
</html>"""

    meta_items = []
    if work.get("theme"):
        meta_items.append("<p><strong>Tema:</strong> {}</p>".format(work["theme"]))
    if work.get("area"):
        meta_items.append("<p><strong>Area:</strong> {}</p>".format(work["area"]))
    if work.get("keywords"):
        meta_items.append("<p><strong>Palavras-chave:</strong> {}</p>".format(work["keywords"]))
    meta_items.append("<p><strong>Total de palavras:</strong> {}</p>".format(total_words))

    sections_html = ""
    for s in sections:
        content = s.get("content") or "(Secao em elaboracao)"
        paragraphs = content.split("\n")
        p_html = ""
        for p in paragraphs:
            p = p.strip()
            if p:
                p_html += "<p>{}</p>\n".format(p)
        sections_html += "<h2>{}</h2>\n{}\n".format(s["title"], p_html)

    refs_html = ""
    for r in refs:
        authors = (r.get("authors") or "").strip().rstrip(".")
        year = r.get("year") or "s.d."
        title = (r.get("title") or "").strip().rstrip(".")
        source = (r.get("source") or "").strip()
        doi = (r.get("doi") or "").strip()
        publisher = (r.get("publisher") or "").strip()
        apa = "{} ({}). {}. ".format(authors, year, title)
        if source:
            apa += "{}. ".format(source)
        if publisher:
            apa += "{}. ".format(publisher)
        if doi:
            apa += "https://doi.org/{}".format(doi)
        refs_html += '<p class="ref">{}</p>\n'.format(apa.strip())

    final_html = html.format(
        title=work.get("title", "Trabalho Academico"),
        meta_html="\n".join(meta_items),
        sections_html=sections_html,
        refs_html=refs_html or "<p>Nenhuma referencia registada.</p>",
        date=datetime.now().strftime("%d/%m/%Y"),
    )
    return final_html, 200, {"Content-Type": "text/html; charset=utf-8", "Content-Disposition": "attachment; filename={}.html".format(re.sub(r'[^\w\s-]', '', work.get("title", "trabalho").replace(" ", "_"))[:50])}


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(debug=True)
