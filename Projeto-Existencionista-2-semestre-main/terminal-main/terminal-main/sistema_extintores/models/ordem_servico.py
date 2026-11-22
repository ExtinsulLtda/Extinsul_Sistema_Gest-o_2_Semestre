"""
Modelo de domínio da entidade OrdemServico.
"""

from datetime import datetime
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from database import DatabaseManager
from models.extintor import Extintor
from utils.validacoes import STATUS_OS_VALIDOS, normalizar_numero_os


class OrdemServico:
    """Representa uma Ordem de Serviço vinculada a um extintor."""

    def __init__(
        self,
        numero_os: str,
        extintor_id: Optional[int],
        numero_extintor: str,
        data_criacao: Optional[str] = None,
        status: str = "Aberta",
        observacoes: str = "",
        id: Optional[int] = None,
        extintor: Optional[Extintor] = None,
        pecas_utilizadas: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self.id = id
        self.numero_os = numero_os.strip().upper()
        self.extintor_id = extintor_id
        self.numero_extintor = numero_extintor.strip()
        self.extintor = extintor
        self.data_criacao = data_criacao or datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        self.status = status.strip()
        self.observacoes = (observacoes or "").strip()
        self.pecas_utilizadas = pecas_utilizadas if pecas_utilizadas is not None else []

    @classmethod
    def from_row(
        cls,
        row: sqlite3.Row,
        extintor: Optional[Extintor] = None,
        pecas_utilizadas: Optional[List[Dict[str, Any]]] = None,
    ) -> "OrdemServico":
        """Constrói OrdemServico a partir de uma linha SQLite."""
        return cls(
            id=row["id"],
            numero_os=row["numero_os"],
            extintor_id=row["extintor_id"],
            numero_extintor=row["numero_extintor"],
            data_criacao=row["data_criacao"],
            status=row["status"],
            observacoes=row["observacoes"],
            extintor=extintor,
            pecas_utilizadas=pecas_utilizadas or [],
        )

    @staticmethod
    def gerar_numero(db: DatabaseManager) -> str:
        """Gera e persiste o próximo número sequencial de Ordem de Serviço."""
        with db.conectar() as conn:
            numero = db.obter_proximo_numero_os(conn)
            conn.commit()
            return numero

    @classmethod
    def criar_para_extintor(
        cls,
        db: DatabaseManager,
        extintor: Extintor,
        tipo_servico: str = "Manutenção / Inspeção",
        observacoes: str = "",
    ) -> "OrdemServico":
        """Gera uma nova Ordem de Serviço para um extintor já cadastrado."""
        if extintor.id is None:
            raise ValueError("O extintor precisa estar cadastrado para gerar uma OS.")

        with db.conectar() as conn:
            cursor = conn.cursor()
            numero_os = db.obter_proximo_numero_os(conn)
            data_criacao = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
            obs_os = (observacoes or "").strip() or f"OS de {tipo_servico}"

            cursor.execute(
                """
                INSERT INTO ordens_servico (
                    numero_os, extintor_id, numero_extintor, data_criacao, status, observacoes
                ) VALUES (?, ?, ?, ?, 'Aberta', ?);
                """,
                (numero_os, extintor.id, extintor.numero, data_criacao, obs_os),
            )
            os_id = int(cursor.lastrowid)

            cursor.execute(
                """
                INSERT INTO historico_servicos (
                    extintor_id, numero_extintor, ordem_servico_id, numero_os,
                    data_servico, tipo_servico, pecas_utilizadas, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, 'Nenhuma', ?);
                """,
                (
                    extintor.id,
                    extintor.numero,
                    os_id,
                    numero_os,
                    datetime.now().strftime("%d/%m/%Y"),
                    tipo_servico.strip() or "Manutenção",
                    obs_os,
                ),
            )
            conn.commit()
            return cls(
                id=os_id,
                numero_os=numero_os,
                extintor_id=extintor.id,
                numero_extintor=extintor.numero,
                data_criacao=data_criacao,
                status="Aberta",
                observacoes=obs_os,
                extintor=extintor,
                pecas_utilizadas=[],
            )

    @classmethod
    def consultar(cls, db: DatabaseManager, numero_os: str) -> Optional["OrdemServico"]:
        """Consulta uma OS pelo seu número, carregando extintor e peças utilizadas."""
        os_norm = normalizar_numero_os(numero_os)
        if not os_norm:
            return None

        with db.conectar() as conn:
            row = conn.execute(
                "SELECT * FROM ordens_servico WHERE UPPER(numero_os) = UPPER(?);",
                (os_norm,),
            ).fetchone()
            if row is None:
                return None

            extintor = None
            if row["extintor_id"] is not None:
                ext_row = conn.execute(
                    "SELECT * FROM extintores WHERE id = ?;",
                    (row["extintor_id"],),
                ).fetchone()
                if ext_row is not None:
                    extintor = Extintor.from_row(ext_row)

            pecas_rows = conn.execute(
                """
                SELECT id, peca_id, codigo_peca, nome_peca, quantidade, unidade, data_registro
                FROM pecas_ordem_servico
                WHERE ordem_servico_id = ?
                ORDER BY id ASC;
                """,
                (row["id"],),
            ).fetchall()
            pecas = [dict(p) for p in pecas_rows]

            return cls.from_row(row, extintor=extintor, pecas_utilizadas=pecas)

    @classmethod
    def listar_por_extintor(
        cls,
        db: DatabaseManager,
        extintor_id: int,
    ) -> List["OrdemServico"]:
        """Retorna todas as Ordens de Serviço associadas a um extintor."""
        with db.conectar() as conn:
            rows = conn.execute(
                "SELECT * FROM ordens_servico WHERE extintor_id = ? ORDER BY id DESC;",
                (extintor_id,),
            ).fetchall()
            return [cls.from_row(r) for r in rows]

    @classmethod
    def listar_todas(cls, db: DatabaseManager) -> List["OrdemServico"]:
        """Retorna todas as Ordens de Serviço registradas."""
        with db.conectar() as conn:
            rows = conn.execute(
                "SELECT * FROM ordens_servico ORDER BY id DESC;"
            ).fetchall()
            return [cls.from_row(r) for r in rows]

    def adicionar_peca(
        self,
        db: DatabaseManager,
        peca_id: int,
        quantidade: float,
    ) -> Tuple[bool, str, bool]:
        """
        Vincula uma peça utilizada a esta OS, dá baixa automática no estoque,
        registra movimentação e atualiza o histórico de serviços.
        Retorna (sucesso, mensagem, alerta_estoque_baixo).
        """
        if self.id is None:
            raise ValueError("Ordem de Serviço não persistida no banco.")
        if quantidade <= 0:
            raise ValueError("A quantidade utilizada deve ser maior que zero.")
        if self.status == "Cancelada":
            raise ValueError("Não é possível vincular peças a uma OS cancelada.")

        with db.conectar() as conn:
            cursor = conn.cursor()
            peca_row = cursor.execute(
                "SELECT * FROM pecas WHERE id = ?;",
                (peca_id,),
            ).fetchone()
            if peca_row is None:
                raise ValueError("Peça não encontrada no estoque.")

            disponivel = float(peca_row["quantidade"])
            if quantidade > disponivel:
                raise ValueError(
                    f"Estoque insuficiente para '{peca_row['nome']}'. "
                    f"Disponível: {disponivel:g} {peca_row['unidade']}."
                )

            nova_qtd = disponivel - float(quantidade)
            agora_data = datetime.now().strftime("%d/%m/%Y")
            agora_hora = datetime.now().strftime("%H:%M:%S")
            data_reg = f"{agora_data} {agora_hora}"

            # 1. Atualiza saldo da peça no estoque
            cursor.execute(
                "UPDATE pecas SET quantidade = ? WHERE id = ?;",
                (nova_qtd, peca_id),
            )

            # 2. Registra vínculo na tabela pecas_ordem_servico
            cursor.execute(
                """
                INSERT INTO pecas_ordem_servico (
                    ordem_servico_id, numero_os, peca_id, codigo_peca,
                    nome_peca, quantidade, unidade, data_registro
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    self.id,
                    self.numero_os,
                    peca_id,
                    peca_row["codigo"],
                    peca_row["nome"],
                    float(quantidade),
                    peca_row["unidade"],
                    data_reg,
                ),
            )

            # 3. Registra saída na tabela movimentacoes_estoque
            cursor.execute(
                """
                INSERT INTO movimentacoes_estoque (
                    peca_id, codigo_peca, nome_peca, tipo_movimentacao,
                    quantidade, quantidade_anterior, quantidade_nova,
                    data_movimentacao, hora_movimentacao, motivo,
                    ordem_servico_id, numero_os
                ) VALUES (?, ?, ?, 'SAIDA', ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    peca_id,
                    peca_row["codigo"],
                    peca_row["nome"],
                    float(quantidade),
                    disponivel,
                    nova_qtd,
                    agora_data,
                    agora_hora,
                    f"Utilização na {self.numero_os}",
                    self.id,
                    self.numero_os,
                ),
            )

            # 4. Atualiza resumo de peças no histórico de serviços do extintor
            pecas_os = cursor.execute(
                """
                SELECT nome_peca, SUM(quantidade) AS total, unidade
                FROM pecas_ordem_servico
                WHERE ordem_servico_id = ?
                GROUP BY peca_id, nome_peca, unidade
                ORDER BY MIN(id);
                """,
                (self.id,),
            ).fetchall()
            resumo_pecas = ", ".join(
                f"{p['total']:g} {p['unidade']} {p['nome_peca']}" for p in pecas_os
            )

            hist_existente = cursor.execute(
                "SELECT id FROM historico_servicos WHERE ordem_servico_id = ? ORDER BY id DESC LIMIT 1;",
                (self.id,),
            ).fetchone()

            if hist_existente is not None:
                cursor.execute(
                    "UPDATE historico_servicos SET pecas_utilizadas = ? WHERE id = ?;",
                    (resumo_pecas, hist_existente["id"]),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO historico_servicos (
                        extintor_id, numero_extintor, ordem_servico_id, numero_os,
                        data_servico, tipo_servico, pecas_utilizadas, observacoes
                    ) VALUES (?, ?, ?, ?, ?, 'Manutenção com Troca de Peças', ?, ?);
                    """,
                    (
                        self.extintor_id,
                        self.numero_extintor,
                        self.id,
                        self.numero_os,
                        agora_data,
                        resumo_pecas,
                        f"Peças vinculadas à {self.numero_os}",
                    ),
                )

            conn.commit()

            # Atualiza lista em memória
            self.pecas_utilizadas.append(
                {
                    "peca_id": peca_id,
                    "codigo_peca": peca_row["codigo"],
                    "nome_peca": peca_row["nome"],
                    "quantidade": float(quantidade),
                    "unidade": peca_row["unidade"],
                    "data_registro": data_reg,
                }
            )

            alerta_baixo = nova_qtd <= float(peca_row["estoque_minimo"])
            return (
                True,
                f"Peça '{peca_row['nome']}' ({quantidade:g} {peca_row['unidade']}) vinculada à {self.numero_os}.",
                alerta_baixo,
            )

    def atualizar_status(self, db: DatabaseManager, novo_status: str) -> None:
        """Atualiza o status da Ordem de Serviço com validação."""
        if self.id is None:
            raise ValueError("Ordem de Serviço não persistida no banco.")
        status_limpo = novo_status.strip()
        if status_limpo not in STATUS_OS_VALIDOS:
            raise ValueError(
                f"Status inválido. Opções permitidas: {', '.join(STATUS_OS_VALIDOS)}."
            )

        with db.conectar() as conn:
            conn.execute(
                "UPDATE ordens_servico SET status = ? WHERE id = ?;",
                (status_limpo, self.id),
            )
            conn.commit()
            self.status = status_limpo
