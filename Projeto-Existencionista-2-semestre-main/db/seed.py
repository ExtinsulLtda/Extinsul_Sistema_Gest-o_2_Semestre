#!/usr/bin/env python3
"""Gera db/extinsul.db (SQLite) a partir de schema.sql + dados iniciais.
Uso: python3 db/seed.py        (recria o arquivo do zero)"""
import hashlib, os, secrets, sqlite3
from datetime import date, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(AQUI, "extinsul.db")

def hash_pin(pin: str) -> str:
    # Mesmo formato lido por server.js: scrypt N=16384 r=8 p=1, 64 bytes
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pin.encode(), salt=salt, n=16384, r=8, p=1, dklen=64)
    return salt.hex() + ":" + h.hex()

hoje = date.today()
d = lambda n: (hoje + timedelta(days=n)).isoformat()

if os.path.exists(DB):
    os.remove(DB)
con = sqlite3.connect(DB)
con.executescript(open(os.path.join(AQUI, "schema.sql"), encoding="utf-8").read())
c = con.cursor()

# PINs iniciais -> TROQUE antes de usar em producao
usuarios = [("Carlos Silva", "gerente", "1111"),
            ("João Pereira", "operador", "2222"),
            ("Roberto Almeida", "motorista", "3333")]
for nome, perfil, pin in usuarios:
    c.execute("INSERT INTO usuarios(nome,perfil,pin_hash) VALUES (?,?,?)", (nome, perfil, hash_pin(pin)))

clientes = ["Empresa ABC", "Posto Central", "Condomínio Vista Bela",
            "Indústria XYZ", "Escola Municipal", "Hospital São Lucas"]
for n in clientes:
    c.execute("INSERT INTO clientes(nome) VALUES (?)", (n,))
cid = {n: i + 1 for i, n in enumerate(clientes)}

# 248 extintores: 212 em dia / 36 em atraso; 18 com vistoria nos proximos 7 dias
tipos = ["PQS", "CO2", "Água"]
fixos = {1: ("Empresa ABC", "PQS", "em_dia"), 2: ("Posto Central", "CO2", "em_atraso"),
         3: ("Condomínio Vista Bela", "Água", "em_dia"), 4: ("Indústria XYZ", "PQS", "em_atraso"),
         5: ("Hospital São Lucas", "CO2", "em_dia"), 6: ("Hospital São Lucas", "PQS", "em_dia"),
         9: ("Posto Central", "CO2", "em_dia"), 12: ("Empresa ABC", "PQS", "em_dia"),
         17: ("Indústria XYZ", "PQS", "em_dia"), 23: ("Condomínio Vista Bela", "Água", "em_atraso")}
atrasados = set(range(2, 249, 7))       # 36 itens
atrasados = set(sorted(atrasados)[:35]) | {4}
atrasados |= {23}
atrasados = set(sorted(atrasados))
# ajusta para exatamente 36
extra = 1
while len(atrasados) < 36:
    if extra not in atrasados and extra not in fixos:
        atrasados.add(extra)
    extra += 1
while len(atrasados) > 36:
    atrasados.discard(max(x for x in atrasados if x not in fixos or fixos[x][2] == "em_atraso" and x not in (2, 4, 23)))
for n in range(1, 249):
    if n in fixos:
        cli, tp, _ = fixos[n]
    else:
        cli, tp = clientes[n % 6], tipos[n % 3]
    st = "em_atraso" if n in atrasados else "em_dia"
    c.execute("INSERT INTO extintores(codigo,cliente_id,tipo,status,proxima_vistoria) VALUES (?,?,?,?,?)",
              (f"EXT-{n:03d}", cid[cli], tp, st, None))
# datas: atrasados no passado; 18 em dia nos proximos 7 dias; demais mais adiante
em_dia = [r[0] for r in c.execute("SELECT id FROM extintores WHERE status='em_dia' ORDER BY id")]
for k, i in enumerate(em_dia):
    dias = (k % 7) + 1 if k < 18 else 30 + (k % 150)
    c.execute("UPDATE extintores SET proxima_vistoria=? WHERE id=?", (d(dias), i))
for k, (i,) in enumerate(c.execute("SELECT id FROM extintores WHERE status='em_atraso'").fetchall()):
    c.execute("UPDATE extintores SET proxima_vistoria=? WHERE id=?", (d(-(k % 30) - 1), i))

# Ordens de servico (OS-0044..0048); a do dia pertence ao motorista Roberto (id 3)
os_ = [("OS-0048", "Empresa ABC", "Recarga", "em_andamento", 0, "08:00", "09:00", 1),
       ("OS-0047", "Posto Central", "Manutenção", "pendente", -1, "09:30", "10:30", 2),
       ("OS-0046", "Condomínio Vista Bela", "Vistoria", "concluida", -2, "11:00", "12:00", 3),
       ("OS-0045", "Indústria XYZ", "Recarga", "concluida", -4, "13:30", "15:00", 4),
       ("OS-0044", "Escola Municipal", "Manutenção", "pendente", -6, "15:30", "16:30", 5)]
for num, cli, tp, st, off, hi, hf, ordem in os_:
    c.execute("""INSERT INTO ordens_servico(numero,cliente_id,tipo,status,data,hora_inicio,hora_fim,motorista_id,ordem_rota)
                 VALUES (?,?,?,?,?,?,?,3,?)""", (num, cid[cli], tp, st, d(off), hi, hf, ordem))

# Ultimas vistorias
vist = [(0, 12, "conforme"), (-1, 9, "conforme"), (-2, 23, "nao_conforme"),
        (-3, 17, "conforme"), (-4, 6, "conforme")]
for off, n, res in vist:
    ext = c.execute("SELECT id FROM extintores WHERE codigo=?", (f"EXT-{n:03d}",)).fetchone()[0]
    c.execute("INSERT INTO vistorias(data,extintor_id,operador_id,resultado) VALUES (?,?,2,?)", (d(off), ext, res))

# Vencimentos (proximos 7 dias)
venc = [("Condomínio Vista Bela", "Vistoria", 1), ("Posto Central", "Recarga", 2),
        ("Hospital São Lucas", "Vistoria", 3), ("Empresa ABC", "Recarga", 4),
        ("Escola Municipal", "Manutenção", 5)]
for cli, tp, off in venc:
    c.execute("INSERT INTO vencimentos(cliente_id,tipo,data) VALUES (?,?,?)", (cid[cli], tp, d(off)))

con.commit()
for t in ["usuarios", "clientes", "extintores", "ordens_servico", "vistorias", "vencimentos"]:
    print(t, c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
print("em_dia/em_atraso:", c.execute("SELECT status,COUNT(*) FROM extintores GROUP BY status").fetchall())
print("prox 7 dias:", c.execute("SELECT COUNT(*) FROM extintores WHERE status='em_dia' AND proxima_vistoria<=?", (d(7),)).fetchone()[0])
con.close()
