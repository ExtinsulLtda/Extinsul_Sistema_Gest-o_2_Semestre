"""
Modelo de domínio da entidade Peca.
"""

from datetime import datetime
import sqlite3
from typing import Any, Dict, Optional, Tuple

from database import DatabaseManager
from utils.validacoes import validar_decimal_positivo, validar_texto_obrigatorio


class Peca:
    """Representa uma peça ou componente de manutenção no estoque."""

    def __init__(
        self,
        codigo: str,
        nome: str,
        categoria: str,
        quantidade: float = 0.0,
        unidade: str = "un",
        estoque_minimo: float = 0.0,
        observacoes: str = "",
        id: Optional[int] = None,
    ) -> None:
        self.id = id
        self.codigo = codigo.strip().upper()
        self.nome = nome.strip()
        self.categoria = categoria.strip()
        self.quantidade = float(quantidade)
        self.unidade = unidade.strip() or "un"
        self.estoque_minimo = float(estoque_minimo)
        self.observacoes = (observacoes or "").strip()

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Peca":
        """Constrói uma instância de Peca a partir de uma linha SQLite."""
        return cls(
            id=row["id"],
            codigo=row["codigo"],
            nome=row["nome"],
            categoria=row["categoria"],
            quantidade=row["quantidade"],
            unidade=row["unidade"],
            estoque_minimo=row["estoque_minimo"],
            observacoes=row["observacoes"],
        )

    def to_dict(self) -> Dict[str, Any]:
        """Retorna os atributos da peça em formato de dicionário."""
        return {
            "id": self.id,
            "codigo": self.codigo,
            "nome": self.nome,
            "categoria": self.categoria,
            "quantidade": self.quantidade,
            "unidade": self.unidade,
            "estoque_minimo": self.estoque_minimo,
            "observacoes": self.observacoes,
        }

    def esta_baixo(self) -> bool:
        """Indica se o saldo atual atingiu ou está abaixo do estoque mínimo."""
        return self.quantidade <= self.estoque_minimo

    @staticmethod
    def validar_quantidade(quantidade: float, permitir_zero: bool = False) -> Tuple[bool, str]:
        """Valida que a quantidade é numérica e não negativa."""
        ok, _, msg = validar_decimal_positivo(
            str(quantidade), "Quantidade", permitir_zero=permitir_zero
        )
        return ok, msg

    def validar_dados(self) -> Tuple[bool, str]:
        """Valida os campos obrigatórios e numéricos da peça."""
        ok, _, msg = validar_texto_obrigatorio(self.codigo, "Código da peça")
        if not ok:
            return False, msg

        ok, _, msg = validar_texto_obrigatorio(self.nome, "Nome da peça")
        if not ok:
            return False, msg

        ok, _, msg = validar_texto_obrigatorio(self.categoria, "Categoria")
        if not ok:
            return False, msg

        ok, msg = self.validar_quantidade(self.quantidade, permitir_zero=True)
        if not ok:
            return False, msg

        if self.estoque_minimo < 0:
            return False, "A quantidade mínima de estoque não pode ser negativa."

        return True, ""

    def adicionar_estoque(
        self,
        db: DatabaseManager,
        quantidade: float,
        motivo: str = "Reposição de estoque",
    ) -> float:
        """Adiciona quantidade ao estoque da peça e grava a movimentação."""
        if self.id is None:
            raise ValueError("Peça não cadastrada no banco de dados.")
        ok, msg = self.validar_quantidade(quantidade, permitir_zero=False)
        if not ok:
            raise ValueError(msg)

        motivo_limpo = (motivo or "").strip() or "Reposição de estoque"
        agora_data = datetime.now().strftime("%d/%m/%Y")
        agora_hora = datetime.now().strftime("%H:%M:%S")

        with db.conectar() as conn:
            cursor = conn.cursor()
            row = cursor.execute(
                "SELECT quantidade FROM pecas WHERE id = ?;",
                (self.id,),
            ).fetchone()
            if row is None:
                raise ValueError("Peça não encontrada no banco.")

            qtd_anterior = float(row["quantidade"])
            qtd_nova = qtd_anterior + float(quantidade)

            cursor.execute(
                "UPDATE pecas SET quantidade = ? WHERE id = ?;",
                (qtd_nova, self.id),
            )
            cursor.execute(
                """
                INSERT INTO movimentacoes_estoque (
                    peca_id, codigo_peca, nome_peca, tipo_movimentacao,
                    quantidade, quantidade_anterior, quantidade_nova,
                    data_movimentacao, hora_movimentacao, motivo,
                    ordem_servico_id, numero_os
                ) VALUES (?, ?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, NULL, '');
                """,
                (
                    self.id,
                    self.codigo,
                    self.nome,
                    float(quantidade),
                    qtd_anterior,
                    qtd_nova,
                    agora_data,
                    agora_hora,
                    motivo_limpo,
                ),
            )
            conn.commit()
            self.quantidade = qtd_nova
            return qtd_nova

    def retirar_estoque(
        self,
        db: DatabaseManager,
        quantidade: float,
        motivo: str = "Retirada de estoque",
        ordem_servico_id: Optional[int] = None,
        numero_os: str = "",
    ) -> Tuple[float, bool]:
        """
        Retira quantidade do estoque validando saldo suficiente.
        Retorna (nova_quantidade, alerta_estoque_baixo).
        """
        if self.id is None:
            raise ValueError("Peça não cadastrada no banco de dados.")
        ok, msg = self.validar_quantidade(quantidade, permitir_zero=False)
        if not ok:
            raise ValueError(msg)

        motivo_limpo = (motivo or "").strip() or "Retirada manual de estoque"
        agora_data = datetime.now().strftime("%d/%m/%Y")
        agora_hora = datetime.now().strftime("%H:%M:%S")

        with db.conectar() as conn:
            cursor = conn.cursor()
            row = cursor.execute(
                "SELECT quantidade, estoque_minimo FROM pecas WHERE id = ?;",
                (self.id,),
            ).fetchone()
            if row is None:
                raise ValueError("Peça não encontrada no banco.")

            qtd_anterior = float(row["quantidade"])
            if float(quantidade) > qtd_anterior:
                raise ValueError(
                    f"Quantidade indisponível. Estoque atual: {qtd_anterior:g} {self.unidade}."
                )

            qtd_nova = qtd_anterior - float(quantidade)
            cursor.execute(
                "UPDATE pecas SET quantidade = ? WHERE id = ?;",
                (qtd_nova, self.id),
            )
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
                    self.id,
                    self.codigo,
                    self.nome,
                    float(quantidade),
                    qtd_anterior,
                    qtd_nova,
                    agora_data,
                    agora_hora,
                    motivo_limpo,
                    ordem_servico_id,
                    numero_os,
                ),
            )
            conn.commit()
            self.quantidade = qtd_nova
            self.estoque_minimo = float(row["estoque_minimo"])
            return qtd_nova, self.esta_baixo()

    @classmethod
    def consultar_estoque(cls, db: DatabaseManager, termo: str) -> Optional["Peca"]:
        """Consulta uma peça pelo código exato ou nome exato."""
        limpo = (termo or "").strip()
        if not limpo:
            return None
        with db.conectar() as conn:
            row = conn.execute(
                """
                SELECT * FROM pecas
                WHERE UPPER(codigo) = UPPER(?) OR LOWER(nome) = LOWER(?)
                LIMIT 1;
                """,
                (limpo, limpo),
            ).fetchone()
            return cls.from_row(row) if row else None
