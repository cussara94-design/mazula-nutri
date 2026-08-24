import os
import json
from datetime import datetime
from functools import wraps

from flask import (
    Flask, g, jsonify, redirect, render_template, request, session, url_for,
)
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "nutriagenda.db")
TURSO_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "")

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("NUTRIAGENDA_SECRET_KEY", "nutriagenda-dev-secret-key"),
)

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        crn TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        birth TEXT,
        phone TEXT,
        goal TEXT,
        initial_weight REAL,
        current_weight REAL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        "plan" TEXT,
        review TEXT,
        "last" TEXT,
        "next" TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        time TEXT,
        type TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT,
        weight REAL,
        height REAL,
        waist REAL,
        body_fat REAL,
        bmi REAL,
        diagnosis TEXT,
        conduct TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS evolution (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        date TEXT,
        "text" TEXT,
        change_val REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_patients_user ON patients(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_user_date ON appointments(user_id, date)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_assessments_patient ON assessments(patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_evolution_patient ON evolution(patient_id)",
]

PATIENT_FIELDS = (
    "name", "birth", "phone", "goal", "initial_weight", "current_weight",
    "notes", "status", "plan", "review", "last", "next",
)
APPOINTMENT_FIELDS = ("patient_id", "date", "time", "type", "status")
EVOLUTION_FIELDS = ("date", "text", "change_val")


SINTOMAS = {
    "perda_peso": "Perda de peso recente",
    "ganho_peso": "Ganho de peso recente",
    "fadiga": "Fadiga / cansaco",
    "queda_cabelo": "Queda de cabelo",
    "pele_seca": "Pele seca",
    "palidez": "Palidez",
    "edema": "Edema (inchaco nas pernas)",
    "dor_abdominal": "Dor abdominal",
    "insonia": "Insonia",
    "sonolencia": "Sonolencia excessiva",
    "constipacao": "Constipacao intestinal",
    "diarreia": "Diarreia",
    "ansiedade": "Ansiedade",
    "irritabilidade": "Irritabilidade",
    "dificuldade_concentracao": "Dificuldade de concentracao",
    "sede_excessiva": "Sede excessiva",
    "urinacao_frequente": "Urinacao frequente",
    "falta_apetite": "Falta de apetite",
    "apetite_aumentado": "Apetite aumentado",
    "dor_articulacoes": "Dores articulares",
    "falta_ar": "Falta de ar ao esforco",
    "palpitacoes": "Palpitacoes",
    "unhas_quebradicas": "Unhas quebradicas",
    "labios_rachados": "Labios rachados / queilose",
    "lingua_lisa": "Lingua inflamada / lisa",
    "dificuldade_cicatrizacao": "Dificuldade de cicatrizacao",
    "formigamento": "Formigamento nos pes e maos",
    "dor_peito": "Dor no peito",
    "visao_turva": "Visao turva",
    "superaquecimento": "Superaquecimento facil",
    "intolerancia_frio": "Intolerancia ao frio",
}


def calc_diagnosticos(data):
    imc = data.get("imc") or 0
    cintura = data.get("cintura")
    gordura = data.get("gordura")
    idade = data.get("idade") or 0
    sexo = data.get("sexo", "M")
    sintomas = set(data.get("sintomas") or [])

    resultados = []

    def add(nome, descricao, gravidade, cor, confianca, recomendacoes, icone):
        if confianca > 0:
            resultados.append({
                "nome": nome,
                "descricao": descricao,
                "gravidade": gravidade,
                "cor": cor,
                "icone": icone,
                "confianca": min(round(confianca), 100),
                "recomendacoes": recomendacoes,
            })

    if imc >= 40:
        conf = 70
        if "falta_ar" in sintomas: conf += 10
        if "fadiga" in sintomas: conf += 5
        if "sonolencia" in sintomas: conf += 5
        if cintura and ((sexo == "M" and cintura >= 120) or (sexo == "F" and cintura >= 110)): conf += 10
        add("Obesidade Grau III (Morbida)",
            "Excesso muito acentuado de peso com alto risco de complicacoes multi-organicas.",
            "muito_grave", "#c95252", conf,
            ["Procure atendimento medico multidisciplinar IMEDIATO",
             "Avaliacao completa: glicemia, perfil lipidico, PA, apneia do sono",
             "Plano alimentar rigoroso com acompanhamento semanal",
             "Actividade fisica adaptada e supervisionada",
             "Avaliacao para cirurgia bariatrica como opcao terapeutica",
             "Suporte psicologico para aderencia ao tratamento"], "times-circle")

    elif 35 <= imc < 40:
        conf = 65
        if "fadiga" in sintomas: conf += 8
        if "falta_ar" in sintomas: conf += 8
        if cintura and ((sexo == "M" and cintura >= 102) or (sexo == "F" and cintura >= 88)): conf += 12
        if "sonolencia" in sintomas: conf += 5
        add("Obesidade Grau II",
            "Excesso acentuado de peso com alto risco de complicacoes metabolicas e cardiovasculares.",
            "grave", "#c95252", conf,
            ["Procure atendimento medico e nutricional multidisciplinar",
             "Avaliacao completa: glicemia, perfil lipidico, pressao arterial",
             "Plano alimentar individualizado com restricao calorica controlada",
             "Actividade fisica supervisionada (min. 250 min/semana)",
             "Considere terapia comportamental para mudanca de habitos",
             "Avaliacao para cirurgia bariatrica, se indicado pelo medico"], "times-circle")

    elif 30 <= imc < 35:
        conf = 60
        if cintura and ((sexo == "M" and cintura >= 102) or (sexo == "F" and cintura >= 88)): conf += 15
        if "ganho_peso" in sintomas: conf += 5
        if "apetite_aumentado" in sintomas: conf += 5
        if gordura and ((sexo == "M" and gordura >= 30) or (sexo == "F" and gordura >= 35)): conf += 10
        add("Obesidade Grau I",
            "Excesso significativo de peso com risco aumentado para doencas metabolicas e cardiovasculares.",
            "moderada", "#e67e22", conf,
            ["Procure acompanhamento nutricional especializado",
             "Reduza gradualmente a ingestao calorica (500-750 kcal/dia menos)",
             "Evite dietas restritivas - priorise mudancas sustentaveis",
             "Aumente a actividade fisica para minimo 200 min/semana",
             "Monitore pressao arterial e glicemia regularmente",
             "Considere grupo de suporte para mudanca de habitos"], "exclamation-triangle")

    elif 25 <= imc < 30:
        conf = 50
        if cintura and ((sexo == "M" and cintura >= 94) or (sexo == "F" and cintura >= 80)): conf += 15
        if "ganho_peso" in sintomas: conf += 8
        if gordura and ((sexo == "M" and gordura >= 25) or (sexo == "F" and gordura >= 33)): conf += 10
        if "apetite_aumentado" in sintomas: conf += 5
        add("Sobrepeso",
            "Excesso de peso corporal que pode aumentar o risco de doencas cronico-metabolicas.",
            "leve", "#e67e22", conf,
            ["Reduza a ingestao de alimentos ultraprocessados",
             "Aumente o consumo de frutas, legumes e verduras",
             "Practica actividade fisica progressivamente (min. 150 min/semana)",
             "Reduza porcoes e evite refeicoes nocturnas",
             "Procure orientacao para reeducacao alimentar"], "exclamation-triangle")

    elif 18.5 <= imc < 25:
        conf = 60
        if len(sintomas) == 0: conf += 25
        elif len(sintomas) <= 2: conf += 10
        elif len(sintomas) >= 5: conf -= 20
        add("Eutrofia (Estado Nutricional Adequado)",
            "O paciente apresenta peso dentro da faixa considerada saudavel para a sua altura.",
            "nenhuma", "#27ae60", conf,
            ["Manter alimentacao equilibrada e variada",
             "Practica regular de actividade fisica (150 min/semana)",
             "Manter hidratacao adequada (1.5-2L de agua/dia)",
             "Continuar acompanhamento nutricional de rotina"], "check-circle")

    elif 17 <= imc < 18.5:
        conf = 55
        if "falta_apetite" in sintomas: conf += 10
        if "fadiga" in sintomas: conf += 8
        if "palidez" in sintomas: conf += 8
        if "queda_cabelo" in sintomas: conf += 8
        if "dificuldade_cicatrizacao" in sintomas: conf += 5
        add("Baixo Peso / Desnutricao Leve",
            "Peso abaixo do recomendado para a altura, possivelmente associado a deficiencias nutricionais.",
            "moderada", "#e67e22", conf,
            ["Aumente a ingestao calorica com alimentos nutrientes-densos",
             "Fracoes frequentes (5-6 refeicoes/dia)",
             "Priorise proteinas magras, oleaginosas e cereais integrais",
             "Avalie possiveis causas subjacentes (doencas, medicacoes)",
             "Suplementacao de vitaminas e minerais, se indicado",
             "Acompanhamento nutricional quinzenal"], "exclamation-triangle")

    elif imc < 17:
        conf = 70
        if "edema" in sintomas: conf += 15
        if "fadiga" in sintomas: conf += 10
        if "palidez" in sintomas: conf += 5
        add("Desnutricao / Baixo Peso Acentuado",
            "Condicao grave que compromete imunidade e funcoes organicas. Tratamento urgente necessario.",
            "muito_grave", "#c95252", conf,
            ["URGENCIA: Procure atendimento medico imediatamente",
             "Avaliacao clinica completa para descartar doencas subjacentes",
             "Replecao nutricional gradual (risco de sindrome de realimentacao)",
             "Suplementacao parenteral ou enteral, se necessario",
             "Monitorizacao rigorosa: peso, eletrólitos, funcao renal",
             "Suporte psicologico e familiar"], "times-circle")

    sintomas_proteico = {"edema", "fadiga", "perda_peso", "palidez", "queda_cabelo"}
    if imc < 25 and len(sintomas & sintomas_proteico) >= 3:
        conf = 50 + len(sintomas & sintomas_proteico) * 8
        if "edema" in sintomas and "fadiga" in sintomas: conf += 10
        add("Desnutricao Proteico-Calorica",
            "Deficiencia de proteinas e calorias com sinais clinicos como edema e perda muscular.",
            "grave", "#c95252", conf,
            ["Avaliacao clinica urgente com exames de proteinas sericas",
             "Ingestao proteica aumentada (1.5-2g/kg/dia)",
             "Suplementacao nutricional oral ou enteral",
             "Monitorizacao semanal de peso e perimeter braquial",
             "Tratar causas subjacentes se identificadas",
             "Suporte multidisciplinar: medico + nutricionista + enfermagem"], "times-circle")

    sintomas_anemia = {"fadiga", "palidez", "queda_cabelo", "unhas_quebradicas", "dificuldade_concentracao", "dor_peito", "palpitacoes"}
    if len(sintomas & sintomas_anemia) >= 3:
        conf = 45 + len(sintomas & sintomas_anemia) * 8
        if "palidez" in sintomas and "fadiga" in sintomas and "unhas_quebradicas" in sintomas: conf += 15
        add("Anemia Ferropenica (Suspeita)",
            "Sugestao de anemia por deficiencia de ferro com base nos sintomas clinicos apresentados.",
            "moderada", "#e67e22", conf,
            ["SOLICITE exame: hemograma completo, ferritina, ferro serico, TIBC",
             "Aumente alimentos ricos em ferro heme: carnes vermelhas, figado, moluscos",
             "Associe fontes de vitamina C para melhor absorcao do ferro",
             "Evite cafe/chai junto as refeicoes (inibe absorcao de ferro)",
             "Considere suplementacao de ferro (sulfato ferroso 200-400mg/dia)",
             "Reavalie hemograma apos 30-60 dias de tratamento"], "exclamation-triangle")

    sintomas_b = {"lingua_lisa", "labios_rachados", "irritabilidade", "fadiga", "dificuldade_concentracao", "formigamento"}
    if len(sintomas & sintomas_b) >= 3:
        conf = 40 + len(sintomas & sintomas_b) * 8
        if "lingua_lisa" in sintomas and "labios_rachados" in sintomas: conf += 15
        add("Deficiencia de Vitaminas do Complexo B (Suspeita)",
            "Sinais suggestivos de deficiencias de vitaminas B12, B6, riboflavina ou niacina.",
            "moderada", "#e67e22", conf,
            ["SOLICITE exames: vitamina B12, acido folico, B6, nivel de homocisteina",
             "Aumente consumo de alimentos integrais, carnes, ovos, leguminosas",
             "Considere suplementacao do complexo B",
             "Avalie possivel causa: absorcao reduzida, alimentacao restritiva",
             "Reavalie sintomas apos 4-6 semanas de suplementacao"], "exclamation-triangle")

    sintomas_tiroide = {"ganho_peso", "sonolencia", "pele_seca", "queda_cabelo", "intolerancia_frio", "constipacao", "irritabilidade", "fadiga"}
    if len(sintomas & sintomas_tiroide) >= 4:
        conf = 40 + len(sintomas & sintomas_tiroide) * 7
        if "pele_seca" in sintomas and "sonolencia" in sintomas and "intolerancia_frio" in sintomas: conf += 15
        add("Hipotireoidismo (Suspeita)",
            "Sintomas suggestivos de funcao tireoidiana reduzida. Confirmacao com exames necessaria.",
            "moderada", "#8e44ad", conf,
            ["SOLICITE exame: TSH, T4 livre, T3",
             "Avalie outros sintomas: constipacao, bradicardia, edema periferico",
             "Se confirmado: encaminhe ao endocrinologista para tratamento",
             "Mantenha alimentacao com iodo e selenio (peixes, nozes, ovos)",
             "Evite soja em excesso (pode interferir com absorcao de iodo)",
             "Reavalie TSH apos 6-8 semanas de tratamento"], "exclamation-triangle")

    sintomas_diabetes = {"sede_excessiva", "urinacao_frequente", "visao_turva", "fadiga", "dificuldade_cicatrizacao", "formigamento", "perda_peso"}
    if len(sintomas & sintomas_diabetes) >= 3:
        conf = 40 + len(sintomas & sintomas_diabetes) * 8
        if "sede_excessiva" in sintomas and "urinacao_frequente" in sintomas: conf += 15
        if imc >= 30: conf += 10
        add("Diabetes Mellitus Tipo 2 (Suspeita)",
            "Sintomas sugestivos de hiperglicemia. Confirmacao com exames laboratoriais urgente.",
            "grave", "#c95252", conf,
            ["URGENCIA: Solicite glicemia de jejum, HbA1c e curva glicemica",
             "Evite alimentos com alto indice glicemicos (acucares, brancos)",
             "Distribua carbs ao longo do dia em porcoes pequenas",
             "Aumente fibra: vegetais, leguminosas, cereais integrais",
             "Actividade fisica regular melhora sensibilidade a insulina",
             "Encaminhe ao endocrinologista se glicemia > 126 mg/dL"], "exclamation-triangle")

    sintomas_metab = {"sede_excessiva", "urinacao_frequente", "fadiga", "dor_peito", "falta_ar", "visao_turva"}
    if imc >= 25:
        conf_metab = 0
        cintura_alta = cintura and ((sexo == "M" and cintura >= 102) or (sexo == "F" and cintura >= 88))
        if cintura_alta: conf_metab += 30
        if imc >= 30: conf_metab += 15
        if len(sintomas & sintomas_metab) >= 2: conf_metab += len(sintomas & sintomas_metab) * 10
        if conf_metab >= 45:
            add("Sindrome Metabolica (Suspeita)",
                "Combinacao de factores de risco cardiovascular: obesidade abdominal, resistencia a insulina.",
                "grave", "#c95252", conf_metab,
                ["SOLICITE: glicemia, perfil lipidico, trigliceridos, HDL, pressao arterial",
                 "Reduza peso gradualmente (5-10% do peso corporal em 6 meses)",
                 "Actividade fisica aerobia + resistencia (min. 150 min/semana)",
                 "Dieta mediterranea ou DASH: baixa em sodio, rica em fibra",
                 "Elimine ultraprocessados e acucares adicionados",
                 "Acompanhamento medico trimestral obrigatorio"], "exclamation-triangle")

    if cintura and ((sexo == "M" and cintura >= 102) or (sexo == "F" and cintura >= 88)):
        conf_rc = 40
        if imc >= 30: conf_rc += 15
        if "fadiga" in sintomas: conf_rc += 5
        if "falta_ar" in sintomas: conf_rc += 8
        if "palpitacoes" in sintomas: conf_rc += 8
        if "dor_peito" in sintomas: conf_rc += 10
        if gordura and ((sexo == "M" and gordura >= 30) or (sexo == "F" and gordura >= 35)): conf_rc += 10
        if conf_rc >= 50:
            add("Risco Cardiovascular Elevado",
                "Circunferencia abdominal elevada com factores associados aumentam risco de eventos cardiovasculares.",
                "moderada", "#e67e22", conf_rc,
                ["SOLICITE: perfil lipidico completo, PA, glicemia, HbA1c",
                 "Reduza circunferencia abdominal como prioridade",
                 "Actividade fisica aerobia regular (caminhada, natacao)",
                 "Dieta pobre em sodio e gorduras saturadas",
                 "Evite tabaco e alcohol em excesso",
                 "Acompanhe PA semanalmente em casa"], "exclamation-triangle")

    sintomas_estresse = {"insonia", "ansiedade", "irritabilidade", "dificuldade_concentracao", "falta_apetite", "palpitacoes", "dor_abdominal", "dor_peito"}
    if len(sintomas & sintomas_estresse) >= 3:
        conf = 40 + len(sintomas & sintomas_estresse) * 7
        if "ansiedade" in sintomas and "insonia" in sintomas: conf += 10
        if "palpitacoes" in sintomas: conf += 5
        add("Estresse / Ansiedade (Impacto Nutricional)",
            "Sintomas de estresse e ansiedade que podem afectar habitos alimentares e estado nutricional.",
            "leve", "#8e44ad", conf,
            ["Avalie padroes alimentares em resposta ao estresse (comer emocional)",
             "Introduza tecnicas de alimentacao consciente (mindful eating)",
             "Alimentos ricos em triptofano: ovos, leite, castanhas, banana",
             "Reduza cafeina e estimulantes, especialmente apos as 14h",
             "Mantenha horarios regulares de refeicoes",
             "Encaminhe ao psicologo/psiquiatra se sintomas persistirem",
             "Actividade fisica regular reduz cortisol e melhora sono"], "exclamation-triangle")

    sintomas_digestivos = {"dor_abdominal", "diarreia", "constipacao", "incha_abdominal"}
    if len(sintomas & sintomas_digestivos) >= 2:
        conf = 30 + len(sintomas & sintomas_digestivos) * 10
        add("Disturbio Funcional Digestivo (Suspeita)",
            "Sintomas gastrointestinais que podem indicar intolerancia alimentar ou sindrome do intestino irritavel.",
            "leve", "#e67e22", conf,
            ["Mantenha diario alimentar para identificar triggers",
             "Considere eliminacao de lactose por 2-4 semanas e reavalie",
             "Avalie sensibilidade ao gluten (testes especificos se indicado)",
             "Aumente fibra gradualmente (25-30g/dia) com muita agua",
             "Alimentos fermentados podem ajudar (iode, kefir, chucrute)",
             "Se persistir: encaminhe ao gastroenterologista"], "exclamation-triangle")

    resultados.sort(key=lambda x: x["confianca"], reverse=True)

    if not resultados:
        add("Estado Nutricional A Determinar",
            "Dados insuficientes para um diagnostico preciso. Complete mais avaliacoes.",
            "nenhuma", "#68756f", 20,
            ["Registre dados antropometricos completos",
             "Identifique sintomas presentes",
             "Agende avaliacao nutricional detalhada"], "info-circle")

    return resultados


def get_db():
    if "db" not in g:
        if TURSO_URL:
            import libsql_experimental as libsql
            g.db = libsql.connect(database=TURSO_URL, auth_token=TURSO_TOKEN)
        else:
            import sqlite3
            conn = sqlite3.connect(DATABASE_PATH)
            conn.row_factory = sqlite3.Row
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
        db.execute(stmt)
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


def to_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


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
                "INSERT INTO users (name, email, password, crn, created_at) VALUES (?, ?, ?, ?, ?)",
                ("Nutricionista", "admin@nutri.local", generate_password_hash("123456"), "", now_str()),
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
    return {
        "id": user["id"], "name": user["name"], "email": user["email"],
        "crn": user.get("crn"), "created_at": user.get("created_at"),
    }


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
    crn = (data.get("crn") or "").strip()
    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are required."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing is not None:
        return jsonify({"error": "An account with this email already exists."}), 409
    cur = db.execute(
        "INSERT INTO users (name, email, password, crn, created_at) VALUES (?, ?, ?, ?, ?)",
        (name, email, generate_password_hash(password), crn, now_str()),
    )
    db.commit()
    session.clear()
    session["user_id"] = cur.lastrowid
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"message": "Account created.", "user": public_user(row_to_dict(user))}), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = json_body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not check_password_hash(user["password"], password):
        return jsonify({"error": "Invalid email or password."}), 401
    session.clear()
    session["user_id"] = user["id"]
    return jsonify({"message": "Logged in.", "user": public_user(row_to_dict(user))})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"message": "Logged out."})


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
    today = today_str()
    today_appointments = rows_to_list(
        db.execute(
            """SELECT ap.*, p.name AS patient_name
               FROM appointments ap JOIN patients p ON p.id = ap.patient_id
               WHERE ap.user_id = ? AND ap.date = ? ORDER BY ap.time""",
            (uid, today),
        ).fetchall()
    )
    active_patients = db.execute(
        "SELECT COUNT(*) AS c FROM patients WHERE user_id = ? AND status = 'active'", (uid,),
    ).fetchone()["c"]
    total_patients = db.execute(
        "SELECT COUNT(*) AS c FROM patients WHERE user_id = ?", (uid,)
    ).fetchone()["c"]
    completed_appointments = db.execute(
        "SELECT COUNT(*) AS c FROM appointments WHERE user_id = ? AND status = 'done'", (uid,),
    ).fetchone()["c"]
    recent_assessments = rows_to_list(
        db.execute(
            """SELECT a.*, p.name AS patient_name
               FROM assessments a JOIN patients p ON p.id = a.patient_id
               WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 5""",
            (uid,),
        ).fetchall()
    )
    return jsonify({
        "today_appointments": today_appointments,
        "active_patients": active_patients,
        "total_patients": total_patients,
        "completed_appointments": completed_appointments,
        "recent_assessments": recent_assessments,
    })


@app.route("/api/patients", methods=["GET"])
@login_required
def patients_list():
    uid = session["user_id"]
    db = get_db()
    sql = "SELECT * FROM patients WHERE user_id = ?"
    params = [uid]
    status = (request.args.get("status") or "").strip()
    if status:
        sql += " AND status = ?"
        params.append(status)
    search = (request.args.get("q") or request.args.get("search") or "").strip()
    if search:
        sql += " AND (name LIKE ? OR phone LIKE ?)"
        params.extend(["%{}%".format(search), "%{}%".format(search)])
    sql += " ORDER BY name COLLATE NOCASE"
    rows = db.execute(sql, params).fetchall()
    return jsonify({"patients": rows_to_list(rows)})


@app.route("/api/patients", methods=["POST"])
@login_required
def patients_create():
    uid = session["user_id"]
    data = json_body()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Patient name is required."}), 400
    values = {field: data.get(field) for field in PATIENT_FIELDS}
    values["name"] = name
    if not (values.get("status") or "").strip():
        values["status"] = "active"
    if values.get("current_weight") in (None, "") and values.get("initial_weight") not in (None, ""):
        values["current_weight"] = values["initial_weight"]
    db = get_db()
    columns = list(values.keys())
    col_sql = ", ".join('"{}"'.format(c) for c in columns)
    marks = ", ".join("?" for _ in range(len(columns) + 2))
    sql = "INSERT INTO patients (user_id, {}, created_at) VALUES ({})".format(col_sql, marks)
    params = [uid] + [values[c] for c in columns] + [now_str()]
    cur = db.execute(sql, params)
    db.commit()
    row = db.execute("SELECT * FROM patients WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"patient": row_to_dict(row)}), 201


@app.route("/api/patients/<int:patient_id>", methods=["GET"])
@login_required
def patients_get(patient_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("patients", patient_id, uid)
    if row is None:
        return jsonify({"error": "Patient not found."}), 404
    patient = row_to_dict(row)
    patient["assessments"] = rows_to_list(
        db.execute(
            "SELECT * FROM assessments WHERE patient_id = ? AND user_id = ? ORDER BY date DESC, id DESC",
            (patient_id, uid),
        ).fetchall()
    )
    patient["appointments"] = rows_to_list(
        db.execute(
            "SELECT * FROM appointments WHERE patient_id = ? AND user_id = ? ORDER BY date DESC, time DESC, id DESC",
            (patient_id, uid),
        ).fetchall()
    )
    patient["evolution"] = rows_to_list(
        db.execute(
            'SELECT * FROM evolution WHERE patient_id = ? AND user_id = ? ORDER BY date DESC, id DESC',
            (patient_id, uid),
        ).fetchall()
    )
    return jsonify({"patient": patient})


@app.route("/api/patients/<int:patient_id>", methods=["PUT"])
@login_required
def patients_update(patient_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("patients", patient_id, uid)
    if row is None:
        return jsonify({"error": "Patient not found."}), 404
    data = json_body()
    updates = {field: data[field] for field in PATIENT_FIELDS if field in data}
    if "name" in updates and not str(updates["name"] or "").strip():
        return jsonify({"error": "Patient name cannot be empty."}), 400
    if not updates:
        return jsonify({"error": "No valid fields provided."}), 400
    set_sql = ", ".join('"{}" = ?'.format(c) for c in updates)
    db.execute(
        'UPDATE patients SET {} WHERE id = ? AND user_id = ?'.format(set_sql),
        list(updates.values()) + [patient_id, uid],
    )
    db.commit()
    row = db.execute("SELECT * FROM patients WHERE id = ? AND user_id = ?", (patient_id, uid)).fetchone()
    return jsonify({"patient": row_to_dict(row)})


@app.route("/api/patients/<int:patient_id>", methods=["DELETE"])
@login_required
def patients_delete(patient_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("patients", patient_id, uid)
    if row is None:
        return jsonify({"error": "Patient not found."}), 404
    for table in ("assessments", "appointments", "evolution"):
        db.execute('DELETE FROM "{}" WHERE patient_id = ? AND user_id = ?'.format(table), (patient_id, uid))
    db.execute("DELETE FROM patients WHERE id = ? AND user_id = ?", (patient_id, uid))
    db.commit()
    return jsonify({"message": "Patient deleted."})


@app.route("/api/appointments", methods=["GET"])
@login_required
def appointments_list():
    uid = session["user_id"]
    db = get_db()
    sql = """SELECT ap.*, p.name AS patient_name
             FROM appointments ap JOIN patients p ON p.id = ap.patient_id
             WHERE ap.user_id = ?"""
    params = [uid]
    date_filter = (request.args.get("date") or "").strip()
    if date_filter:
        sql += " AND ap.date = ?"
        params.append(date_filter)
    patient_filter = (request.args.get("patient_id") or "").strip()
    if patient_filter:
        sql += " AND ap.patient_id = ?"
        params.append(patient_filter)
    status_filter = (request.args.get("status") or "").strip()
    if status_filter:
        sql += " AND ap.status = ?"
        params.append(status_filter)
    sql += " ORDER BY ap.date, ap.time, ap.id"
    rows = db.execute(sql, params).fetchall()
    return jsonify({"appointments": rows_to_list(rows)})


@app.route("/api/appointments", methods=["POST"])
@login_required
def appointments_create():
    uid = session["user_id"]
    data = json_body()
    patient_id = data.get("patient_id")
    ap_date = (data.get("date") or "").strip()
    if not patient_id or not ap_date:
        return jsonify({"error": "patient_id and date are required."}), 400
    db = get_db()
    patient = fetch_owned("patients", patient_id, uid)
    if patient is None:
        return jsonify({"error": "Patient not found."}), 404
    cur = db.execute(
        """INSERT INTO appointments (user_id, patient_id, date, time, type, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (uid, patient_id, ap_date,
         (str(data.get("time")) if data.get("time") not in (None, "") else None),
         (str(data.get("type")) if data.get("type") not in (None, "") else None),
         (str(data.get("status") or "scheduled")).strip() or "scheduled",
         now_str()),
    )
    db.commit()
    row = db.execute(
        """SELECT ap.*, p.name AS patient_name
           FROM appointments ap JOIN patients p ON p.id = ap.patient_id WHERE ap.id = ?""",
        (cur.lastrowid,),
    ).fetchone()
    return jsonify({"appointment": row_to_dict(row)}), 201


@app.route("/api/appointments/<int:appointment_id>", methods=["PUT"])
@login_required
def appointments_update(appointment_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("appointments", appointment_id, uid)
    if row is None:
        return jsonify({"error": "Appointment not found."}), 404
    data = json_body()
    updates = {field: data[field] for field in APPOINTMENT_FIELDS if field in data}
    if "date" in updates and not str(updates["date"] or "").strip():
        return jsonify({"error": "Appointment date cannot be empty."}), 400
    if "patient_id" in updates:
        target = fetch_owned("patients", updates["patient_id"], uid)
        if target is None:
            return jsonify({"error": "Target patient not found."}), 404
    if updates:
        set_sql = ", ".join('"{}" = ?'.format(c) for c in updates)
        db.execute(
            'UPDATE appointments SET {} WHERE id = ? AND user_id = ?'.format(set_sql),
            list(updates.values()) + [appointment_id, uid],
        )
        db.commit()
    row = db.execute("SELECT * FROM appointments WHERE id = ? AND user_id = ?", (appointment_id, uid)).fetchone()
    appointment = row_to_dict(row)
    if appointment.get("status") == "done":
        db.execute(
            'UPDATE patients SET "last" = ?, "next" = NULL WHERE id = ? AND user_id = ?',
            (appointment.get("date"), appointment["patient_id"], uid),
        )
        db.commit()
    return jsonify({"appointment": appointment})


@app.route("/api/appointments/<int:appointment_id>", methods=["DELETE"])
@login_required
def appointments_delete(appointment_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("appointments", appointment_id, uid)
    if row is None:
        return jsonify({"error": "Appointment not found."}), 404
    db.execute("DELETE FROM appointments WHERE id = ? AND user_id = ?", (appointment_id, uid))
    db.commit()
    return jsonify({"message": "Appointment deleted."})


@app.route("/api/assessments", methods=["GET"])
@login_required
def assessments_list():
    uid = session["user_id"]
    db = get_db()
    sql = """SELECT a.*, p.name AS patient_name
             FROM assessments a JOIN patients p ON p.id = a.patient_id
             WHERE a.user_id = ?"""
    params = [uid]
    patient_filter = (request.args.get("patient_id") or "").strip()
    if patient_filter:
        sql += " AND a.patient_id = ?"
        params.append(patient_filter)
    sql += " ORDER BY a.date DESC, a.id DESC"
    rows = db.execute(sql, params).fetchall()
    return jsonify({"assessments": rows_to_list(rows)})


@app.route("/api/assessments", methods=["POST"])
@login_required
def assessments_create():
    uid = session["user_id"]
    data = json_body()
    patient_id = data.get("patient_id")
    if not patient_id:
        return jsonify({"error": "patient_id is required."}), 400
    db = get_db()
    patient = fetch_owned("patients", patient_id, uid)
    if patient is None:
        return jsonify({"error": "Patient not found."}), 404
    weight = to_float(data.get("weight"))
    height = to_float(data.get("height"))
    waist = to_float(data.get("waist"))
    body_fat = to_float(data.get("body_fat"))
    bmi = None
    if weight is not None and height:
        bmi = round(weight / ((height / 100.0) ** 2), 2)
    assessment_date = (str(data.get("date")) if data.get("date") not in (None, "") else today_str()).strip()
    cur = db.execute(
        """INSERT INTO assessments
               (user_id, patient_id, date, weight, height, waist, body_fat, bmi,
                diagnosis, conduct, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (uid, patient_id, assessment_date, weight, height, waist, body_fat, bmi,
         data.get("diagnosis"), data.get("conduct"), data.get("notes"), now_str()),
    )
    if weight is not None:
        previous = patient["current_weight"]
        if previous in (None, ""):
            previous = patient["initial_weight"]
        previous = to_float(previous)
        db.execute("UPDATE patients SET current_weight = ? WHERE id = ? AND user_id = ?", (weight, patient_id, uid))
        if previous is not None:
            change_val = round(weight - previous, 2)
            evo_text = "Nova avaliacao registrada: peso {:.1f} kg ({:+.1f} kg em relacao ao registro anterior).".format(weight, change_val)
        else:
            change_val = None
            evo_text = "Primeira avaliacao registrada: peso {:.1f} kg.".format(weight)
        db.execute(
            'INSERT INTO evolution (user_id, patient_id, date, "text", change_val, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (uid, patient_id, assessment_date, evo_text, change_val, now_str()),
        )
    db.commit()
    row = db.execute("SELECT * FROM assessments WHERE id = ? AND user_id = ?", (cur.lastrowid, uid)).fetchone()
    return jsonify({"assessment": row_to_dict(row)}), 201


@app.route("/api/assessments/<int:assessment_id>", methods=["GET"])
@login_required
def assessments_get(assessment_id):
    uid = session["user_id"]
    db = get_db()
    row = db.execute(
        """SELECT a.*, p.name AS patient_name
           FROM assessments a JOIN patients p ON p.id = a.patient_id
           WHERE a.id = ? AND a.user_id = ?""",
        (assessment_id, uid),
    ).fetchone()
    if row is None:
        return jsonify({"error": "Assessment not found."}), 404
    return jsonify({"assessment": row_to_dict(row)})


@app.route("/api/assessments/<int:assessment_id>", methods=["DELETE"])
@login_required
def assessments_delete(assessment_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("assessments", assessment_id, uid)
    if row is None:
        return jsonify({"error": "Assessment not found."}), 404
    db.execute("DELETE FROM assessments WHERE id = ? AND user_id = ?", (assessment_id, uid))
    db.commit()
    return jsonify({"message": "Assessment deleted."})


@app.route("/api/evolution", methods=["GET"])
@login_required
def evolution_list():
    uid = session["user_id"]
    db = get_db()
    sql = """SELECT e.*, p.name AS patient_name
             FROM evolution e JOIN patients p ON p.id = e.patient_id
             WHERE e.user_id = ?"""
    params = [uid]
    patient_filter = (request.args.get("patient_id") or "").strip()
    if patient_filter:
        sql += " AND e.patient_id = ?"
        params.append(patient_filter)
    sql += " ORDER BY e.date DESC, e.id DESC"
    rows = db.execute(sql, params).fetchall()
    return jsonify({"evolution": rows_to_list(rows)})


@app.route("/api/evolution", methods=["POST"])
@login_required
def evolution_create():
    uid = session["user_id"]
    data = json_body()
    patient_id = data.get("patient_id")
    if not patient_id:
        return jsonify({"error": "patient_id is required."}), 400
    db = get_db()
    patient = fetch_owned("patients", patient_id, uid)
    if patient is None:
        return jsonify({"error": "Patient not found."}), 404
    values = {field: data.get(field) for field in EVOLUTION_FIELDS}
    raw_date = values["date"]
    if isinstance(raw_date, str):
        raw_date = raw_date.strip()
    values["date"] = raw_date or today_str()
    values["text"] = values["text"] or ""
    values["change_val"] = to_float(values["change_val"])
    cur = db.execute(
        'INSERT INTO evolution (user_id, patient_id, date, "text", change_val, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        (uid, patient_id, values["date"], values["text"], values["change_val"], now_str()),
    )
    db.commit()
    row = db.execute("SELECT * FROM evolution WHERE id = ? AND user_id = ?", (cur.lastrowid, uid)).fetchone()
    return jsonify({"entry": row_to_dict(row)}), 201


@app.route("/api/evolution/<int:entry_id>", methods=["DELETE"])
@login_required
def evolution_delete(entry_id):
    uid = session["user_id"]
    db = get_db()
    row = fetch_owned("evolution", entry_id, uid)
    if row is None:
        return jsonify({"error": "Entry not found."}), 404
    db.execute("DELETE FROM evolution WHERE id = ? AND user_id = ?", (entry_id, uid))
    db.commit()
    return jsonify({"message": "Entry deleted."})


@app.route("/api/sintomas")
@login_required
def api_sintomas():
    return jsonify({"sintomas": SINTOMAS})


@app.route("/api/diagnose", methods=["POST"])
@login_required
def api_diagnose():
    data = json_body()
    peso = to_float(data.get("peso"))
    altura = to_float(data.get("altura"))
    cintura = to_float(data.get("cintura"))
    gordura = to_float(data.get("gordura"))
    idade = to_float(data.get("idade"))
    sexo = (data.get("sexo") or "M").upper()
    sintomas = data.get("sintomas") or []

    imc = None
    if peso and altura:
        imc = round(peso / ((altura / 100.0) ** 2), 2)

    input_data = {
        "imc": imc or 0,
        "peso": peso,
        "altura": altura,
        "cintura": cintura,
        "gordura": gordura,
        "idade": idade,
        "sexo": sexo,
        "sintomas": sintomas,
    }

    diagnosticos = calc_diagnosticos(input_data)

    return jsonify({
        "input": {
            "peso": peso, "altura": altura, "imc": imc,
            "cintura": cintura, "gordura": gordura,
            "idade": idade, "sexo": sexo,
            "sintomas": sintomas,
        },
        "diagnosticos": diagnosticos,
    })


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(debug=True)
