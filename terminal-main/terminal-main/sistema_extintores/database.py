"""
Módulo de gerenciamento do banco de dados SQLite local.

Responsável por criar a estrutura relacional, manter a sequência persistente
de Ordens de Serviço e carregar o catálogo inicial de peças técnicas.
"""

from pathlib import Path
import sqlite3
from typing import List, Optional, Tuple


# Catálogo oficial de peças (Seção 7.1 e 7.2) com nomenclatura preservada
PECAS_INICIAIS: List[Tuple[str, str, str, str, float]] = [
    # 7.1 Mangueiras e componentes principais
    ("PC-001", "Mangueira de CO2", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-002", "Mangueira de AP10", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-003", "Mangueira de PQS ABC 04 KG", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-004", "Mangueira de PQS BC 4, 6 e 8 KG", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-005", "Mangueira de PQS ABC 12, 06 e 08 KG", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-006", "Válvula CO2", "Mangueiras e Componentes Principais", "un", 5),
    ("PC-007", "Válvula geral de AP10 e PQS", "Mangueiras e Componentes Principais", "un", 5),
    # 7.2 Peças pequenas
    ("PC-008", "Tampa de borracha", "Peças Pequenas", "un", 10),
    ("PC-009", "Pino de AP10", "Peças Pequenas", "un", 10),
    ("PC-010", "Anel do pino de PQS 4", "Peças Pequenas", "un", 10),
    ("PC-011", "O'Hing de pino", "Peças Pequenas", "un", 10),
    ("PC-012", "O'Hing grande", "Peças Pequenas", "un", 10),
    ("PC-013", "Anel de miolo de válvula", "Peças Pequenas", "un", 10),
    ("PC-014", "Bucha PO4, PO6, PO8, PO12 e AP10 — pequena", "Peças Pequenas", "un", 10),
    ("PC-015", "Bucha PO4, PO6, PO8, PO12 e AP10 — grande", "Peças Pequenas", "un", 10),
    ("PC-016", "Pêra PO4, PO6, PO8 e PO12", "Peças Pequenas", "un", 10),
    ("PC-017", "Pêra AP10", "Peças Pequenas", "un", 10),
    ("PC-018", "Anel do miolo da válvula Yanes", "Peças Pequenas", "un", 10),
    ("PC-019", "O'Hing PO1 e PO2", "Peças Pequenas", "un", 10),
    ("PC-020", "Mola de válvula PQS e AP", "Peças Pequenas", "un", 10),
    ("PC-021", "Anel pó 04", "Peças Pequenas", "un", 10),
    ("PC-022", "O'Hing PO4, PO6, PO8, PO12 e AP10", "Peças Pequenas", "un", 10),
    ("PC-023", "Parafusos e porcas diversos", "Peças Pequenas", "un", 10),
    ("PC-024", "Arruelas diversas", "Peças Pequenas", "un", 10),
    ("PC-025", "Arruela de 2 mm para ampola", "Peças Pequenas", "un", 10),
    ("PC-026", "Bico de mangueira", "Peças Pequenas", "un", 10),
    ("PC-027", "Carreta e lance PO1", "Peças Pequenas", "un", 5),
    ("PC-028", "Vedantes e O'Hings diversos", "Peças Pequenas", "un", 10),
    ("PC-029", "Arruela inox M30 P4", "Peças Pequenas", "un", 10),
]


class DatabaseManager:
    """Gerencia conexões, criação de esquema e transações no SQLite."""

    def __init__(self, db_path: Optional[Path] = None) -> None:
        base_dir = Path(__file__).resolve().parent
        if db_path is None:
            dados_dir = base_dir / "dados"
            dados_dir.mkdir(parents=True, exist_ok=True)
            self.db_path = dados_dir / "extintores.db"
        else:
            self.db_path = Path(db_path)
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self.export_dir = base_dir / "exportacoes"
        self.export_dir.mkdir(parents=True, exist_ok=True)
        self.inicializar_banco()

    def conectar(self) -> sqlite3.Connection:
        """Abre uma conexão SQLite configurada com foreign keys e Row factory."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def inicializar_banco(self) -> None:
        """Cria todas as tabelas necessárias e carrega os dados iniciais."""
        with self.conectar() as conn:
            cursor = conn.cursor()

            # 1. Tabela de extintores
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS extintores (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero TEXT NOT NULL UNIQUE,
                    norma TEXT NOT NULL,
                    fabricante TEXT NOT NULL,
                    ano_fabricacao INTEGER NOT NULL,
                    ultimo_teste TEXT NOT NULL,
                    pressao_trabalho REAL NOT NULL,
                    unidade_pressao TEXT NOT NULL,
                    tipo_agente TEXT NOT NULL,
                    capacidade REAL NOT NULL,
                    unidade TEXT NOT NULL,
                    cidade TEXT NOT NULL,
                    observacoes TEXT NOT NULL DEFAULT '',
                    data_cadastro TEXT NOT NULL
                );
                """
            )

            # 2. Tabela de Ordens de Serviço
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS ordens_servico (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero_os TEXT NOT NULL UNIQUE,
                    extintor_id INTEGER,
                    numero_extintor TEXT NOT NULL,
                    data_criacao TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'Aberta',
                    observacoes TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (extintor_id) REFERENCES extintores(id) ON DELETE SET NULL
                );
                """
            )

            # 3. Tabela de peças e componentes
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS pecas (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    codigo TEXT NOT NULL UNIQUE,
                    nome TEXT NOT NULL UNIQUE,
                    categoria TEXT NOT NULL,
                    quantidade REAL NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
                    unidade TEXT NOT NULL DEFAULT 'un',
                    estoque_minimo REAL NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
                    observacoes TEXT NOT NULL DEFAULT ''
                );
                """
            )

            # 4. Tabela de movimentações de estoque
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    peca_id INTEGER NOT NULL,
                    codigo_peca TEXT NOT NULL,
                    nome_peca TEXT NOT NULL,
                    tipo_movimentacao TEXT NOT NULL CHECK (tipo_movimentacao IN ('ENTRADA', 'SAIDA')),
                    quantidade REAL NOT NULL CHECK (quantidade > 0),
                    quantidade_anterior REAL NOT NULL,
                    quantidade_nova REAL NOT NULL,
                    data_movimentacao TEXT NOT NULL,
                    hora_movimentacao TEXT NOT NULL,
                    motivo TEXT NOT NULL,
                    ordem_servico_id INTEGER,
                    numero_os TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (peca_id) REFERENCES pecas(id) ON DELETE CASCADE,
                    FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON DELETE SET NULL
                );
                """
            )

            # 5. Tabela de peças vinculadas às Ordens de Serviço
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS pecas_ordem_servico (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ordem_servico_id INTEGER NOT NULL,
                    numero_os TEXT NOT NULL,
                    peca_id INTEGER NOT NULL,
                    codigo_peca TEXT NOT NULL,
                    nome_peca TEXT NOT NULL,
                    quantidade REAL NOT NULL CHECK (quantidade > 0),
                    unidade TEXT NOT NULL,
                    data_registro TEXT NOT NULL,
                    FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON DELETE CASCADE,
                    FOREIGN KEY (peca_id) REFERENCES pecas(id) ON DELETE RESTRICT
                );
                """
            )

            # 6. Tabela de histórico de serviços por extintor
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS historico_servicos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    extintor_id INTEGER,
                    numero_extintor TEXT NOT NULL,
                    ordem_servico_id INTEGER,
                    numero_os TEXT NOT NULL,
                    data_servico TEXT NOT NULL,
                    tipo_servico TEXT NOT NULL,
                    pecas_utilizadas TEXT NOT NULL DEFAULT '',
                    observacoes TEXT NOT NULL DEFAULT '',
                    FOREIGN KEY (extintor_id) REFERENCES extintores(id) ON DELETE SET NULL,
                    FOREIGN KEY (ordem_servico_id) REFERENCES ordens_servico(id) ON DELETE SET NULL
                );
                """
            )

            # Controle de sequências persistentes (ex: numeração de OS nunca reutilizada)
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS controle_sequencia (
                    chave TEXT PRIMARY KEY,
                    ultimo_numero INTEGER NOT NULL DEFAULT 0
                );
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS configuracoes_sistema (
                    chave TEXT PRIMARY KEY,
                    valor TEXT NOT NULL
                );
                """
            )

            cursor.execute(
                "INSERT OR IGNORE INTO controle_sequencia (chave, ultimo_numero) VALUES ('OS', 0);"
            )

            # Seed inicial idempotente das peças oficiais
            seed_feito = cursor.execute(
                "SELECT valor FROM configuracoes_sistema WHERE chave = 'pecas_iniciais_carregadas';"
            ).fetchone()

            if seed_feito is None:
                for codigo, nome, categoria, unidade, minimo in PECAS_INICIAIS:
                    cursor.execute(
                        """
                        INSERT OR IGNORE INTO pecas (
                            codigo, nome, categoria, quantidade, unidade, estoque_minimo, observacoes
                        ) VALUES (?, ?, ?, 0, ?, ?, '');
                        """,
                        (codigo, nome, categoria, unidade, minimo),
                    )
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO configuracoes_sistema (chave, valor)
                    VALUES ('pecas_iniciais_carregadas', '1');
                    """
                )

            conn.commit()

    def obter_proximo_numero_os(self, conn: sqlite3.Connection) -> str:
        """
        Gera o próximo número sequencial de OS dentro da transação fornecida.
        Nunca reutiliza números, mesmo após cancelamentos ou exclusões.
        """
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE controle_sequencia SET ultimo_numero = ultimo_numero + 1 WHERE chave = 'OS';"
        )
        row = cursor.execute(
            "SELECT ultimo_numero FROM controle_sequencia WHERE chave = 'OS';"
        ).fetchone()
        numero = int(row["ultimo_numero"])
        return f"OS-{numero:06d}"

    def gerar_proximo_codigo_peca(self, conn: sqlite3.Connection) -> str:
        """Sugere o próximo código sequencial disponível no formato PC-XXX."""
        rows = conn.execute("SELECT codigo FROM pecas WHERE codigo LIKE 'PC-%';").fetchall()
        maior = 0
        for row in rows:
            sufixo = row["codigo"][3:]
            if sufixo.isdigit():
                maior = max(maior, int(sufixo))
        return f"PC-{maior + 1:03d}"
