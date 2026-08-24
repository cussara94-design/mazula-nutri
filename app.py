import os
import json
import requests
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
        status TEXT NOT NULL DEFAULT 'rascunho',
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
    "CREATE INDEX IF NOT EXISTS idx_works_user ON works(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_sections_work ON sections(work_id, order_index)",
    "CREATE INDEX IF NOT EXISTS idx_references_work ON references_(work_id)",
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


def fetch_owned(table, row_id, user_id):
    db = get_db()
    return db.execute(
        'SELECT * FROM "{}" WHERE id = ? AND user_id = ?'.format(table),
        (row_id, user_id),
    ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        db = get_db()
        user = db.execute("SELECT id FROM users LIMIT 1").fetchone()
        if user is None:
            db.execute(
                "INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)",
                ("Academico", "admin@mazula.local", generate_password_hash("123456"), now_str()),
            )
            db.commit()
            user = db.execute("SELECT id FROM users LIMIT 1").fetchone()
        session["user_id"] = user["id"]
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
        "INSERT INTO works (user_id, title, work_type, theme, area, keywords, objectives, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (uid, title, work_type, (data.get("theme") or "").strip(), (data.get("area") or "").strip(), (data.get("keywords") or "").strip(), (data.get("objectives") or "").strip(), "rascunho", now, now),
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
    allowed = ("title", "theme", "area", "keywords", "objectives", "status")
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
    db.execute("DELETE FROM works WHERE id = ? AND user_id = ?", (work_id, uid))
    db.commit()
    return jsonify({"message": "Trabalho excluido."})


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
        updates["content"] = content
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
        parts = []
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


@app.route("/api/generate", methods=["POST"])
@login_required
def api_generate():
    if not GROQ_API_KEY:
        return jsonify({"error": "Chave API do Groq nao configurada. Adicione GROQ_API_KEY nas variaveis de ambiente."}), 503
    data = json_body()
    prompt = (data.get("prompt") or "").strip()
    work_id = data.get("work_id")
    section_title = (data.get("section_title") or "").strip()
    generate_type = data.get("type") or "section"

    if not prompt and generate_type == "section":
        return jsonify({"error": "Forneca um prompt ou orientacao para gerar o texto."}), 400

    work_context = ""
    if work_id:
        uid = session["user_id"]
        db = get_db()
        work = db.execute("SELECT * FROM works WHERE id = ? AND user_id = ?", (work_id, uid)).fetchone()
        if work:
            work = row_to_dict(work)
            work_context = "Trabalho: {}\nTema: {}\nArea: {}\nPalavras-chave: {}\nObjectivos: {}\n".format(
                work.get("title") or "", work.get("theme") or "", work.get("area") or "",
                work.get("keywords") or "", work.get("objectives") or "",
            )
            sec_rows = db.execute("SELECT title, content FROM sections WHERE work_id = ? ORDER BY order_index", (work_id,)).fetchall()
            for s in sec_rows:
                sd = row_to_dict(s)
                if sd.get("content"):
                    work_context += "\nSecao '{}' (resumo): {}\n".format(sd["title"], sd["content"][:300])

    system_msg = """Voce e um assistente academico especializado em trabalhos cientificos em lingua portuguesa.

REGRAS OBRIGATORIAS:
- Use linguagem formal e academica
- Estruture o texto com paragrafos claros e coesos
- Use vocabulario tecnico apropriado a area
- Cite autores de forma natural no texto usando formato: (Autor, Ano)
- Nao invente referencias bibliograficas - use apenas as que o usuario fornecer
- Formate o texto pronto para trabalhos academicos
- Evite plagio - gere texto original
- Use terceira pessoa do singular
- Nao use abreviacoes informais"""

    if generate_type == "section":
        system_msg += "\n\nGere o conteudo da secção '{}' de um trabalho academico.".format(section_title or "Trabalho")
        if work_context:
            system_msg += "\n\nContexto do trabalho:\n{}".format(work_context)
        system_msg += "\n\nOrientacao do usuario:\n{}".format(prompt)
        system_msg += "\n\nGere o texto academico completo para esta secção, com pelo menos 300 palavras."
    elif generate_type == "citation":
        system_msg += "\n\nO usuario quer ajuda para formatar ou integrar uma citacao no texto. Responda com o trecho de texto academico com a citacao formatada corretamente em APA."
        system_msg += "\n\n{}".format(prompt)
    elif generate_type == "outline":
        system_msg += "\n\nGere um esqueleto/outline detalhado para um trabalho academico sobre o tema indicado."
        system_msg += "\n\n{}".format(prompt)
    else:
        system_msg += "\n\n{}".format(prompt)

    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": "Bearer {}".format(GROQ_API_KEY), "Content-Type": "application/json"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt or "Gere o conteudo academico."},
                ],
                "temperature": 0.7,
                "max_tokens": 4096,
            },
            timeout=60,
        )
        if resp.status_code != 200:
            error_msg = "Erro ao comunicar com a IA."
            try:
                error_data = resp.json()
                error_msg = error_data.get("error", {}).get("message", error_msg)
            except Exception:
                pass
            return jsonify({"error": error_msg}), 502
        result = resp.json()
        text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        return jsonify({"text": text})
    except requests.Timeout:
        return jsonify({"error": "A IA demorou a responder. Tente novamente."}), 504
    except Exception as e:
        return jsonify({"error": "Erro de conexao: {}".format(str(e))}), 500


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(debug=True)
