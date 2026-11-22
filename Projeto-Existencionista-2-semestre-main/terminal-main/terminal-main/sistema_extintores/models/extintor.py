"""
Modelo de domínio da entidade Extintor.
"""

from datetime import datetime
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from database import DatabaseManager
from utils.validacoes import (
    TIPOS_AGENTE_VALIDOS,
    validar_ano_fabricacao,
    validar_data_br,
    validar_decimal_positivo,
    validar_numero_extintor,
    validar_texto_obrigatorio,
    validar_unidade_capacidade,
)


class Extintor:
    """Representa um extintor de incêndio cadastrado no sistema."""

    def __init__(
        self,
        numero: str,
        norma: str,
        fabricante: str,
        ano_fabricacao: int,
        ultimo_teste: str,
        pressao_trabalho: float,
        unidade_pressao: str,
        tipo_agente: str,
        capacidade: float,
        unidade: str,
        cidade: str,
        observacoes: str = "",
        id: Optional[int] = None,
        data_cadastro: Optional[str] = None,
    ) -> None:
        self.id = id
        self.numero = numero.strip()
        self.norma = norma.strip()
        self.fabricante = fabricante.strip()
        self.ano_fabricacao = int(ano_fabricacao)
        self.ultimo_teste = ultimo_teste.strip()
        self.pressao_trabalho = float(pressao_trabalho)
        self.unidade_pressao = unidade_pressao.strip()
        self.tipo_agente = tipo_agente.strip()
        self.capacidade = float(capacidade)
        self.unidade = unidade.strip()
        self.cidade = cidade.strip()
        self.observacoes = (observacoes or "").strip()
        self.data_cadastro = data_cadastro or datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Extintor":
        """Constrói uma instância de Extintor a partir de uma linha SQLite."""
        return cls(
            id=row["id"],
            numero=row["numero"],
            norma=row["norma"],
            fabricante=row["fabricante"],
            ano_fabricacao=row["ano_fabricacao"],
            ultimo_teste=row["ultimo_teste"],
            pressao_trabalho=row["pressao_trabalho"],
            unidade_pressao=row["unidade_pressao"],
            tipo_agente=row["tipo_agente"],
            capacidade=row["capacidade"],
            unidade=row["unidade"],
            cidade=row["cidade"],
            observacoes=row["observacoes"],
            data_cadastro=row["data_cadastro"],
        )

    def to_dict(self) -> Dict[str, Any]:
        """Retorna os atributos do extintor em formato de dicionário."""
        return {
            "id": self.id,
            "numero": self.numero,
            "norma": self.norma,
            "fabricante": self.fabricante,
            "ano_fabricacao": self.ano_fabricacao,
            "ultimo_teste": self.ultimo_teste,
            "pressao_trabalho": self.pressao_trabalho,
            "unidade_pressao": self.unidade_pressao,
            "tipo_agente": self.tipo_agente,
            "capacidade": self.capacidade,
            "unidade": self.unidade,
            "cidade": self.cidade,
            "observacoes": self.observacoes,
            "data_cadastro": self.data_cadastro,
        }

    def validar_dados(self) -> Tuple[bool, List[str]]:
        """Executa todas as validações de negócio nos atributos do extintor."""
        erros: List[str] = []

        ok, _, msg = validar_numero_extintor(self.numero)
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_texto_obrigatorio(self.norma, "Norma técnica")
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_texto_obrigatorio(self.fabricante, "Fabricante")
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_ano_fabricacao(str(self.ano_fabricacao))
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_data_br(self.ultimo_teste)
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_decimal_positivo(str(self.pressao_trabalho), "Pressão de trabalho")
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_texto_obrigatorio(self.unidade_pressao, "Unidade de pressão")
        if not ok:
            erros.append(msg)

        if self.tipo_agente not in TIPOS_AGENTE_VALIDOS:
            erros.append(f"Tipo de agente inválido: '{self.tipo_agente}'.")

        ok, _, msg = validar_decimal_positivo(str(self.capacidade), "Capacidade/Peso")
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_unidade_capacidade(self.unidade, self.tipo_agente)
        if not ok:
            erros.append(msg)

        ok, _, msg = validar_texto_obrigatorio(self.cidade, "Cidade")
        if not ok:
            erros.append(msg)

        return len(erros) == 0, erros

    def cadastrar(self, db: DatabaseManager) -> Tuple["Extintor", str]:
        """
        Persiste o novo extintor no SQLite e gera automaticamente a Ordem de Serviço
        sequencial e o registro inicial no histórico de serviços.
        Retorna (extintor_salvo, numero_os_gerada).
        """
        valido, erros = self.validar_dados()
        if not valido:
            raise ValueError("; ".join(erros))

        with db.conectar() as conn:
            cursor = conn.cursor()
            existente = cursor.execute(
                "SELECT id FROM extintores WHERE LOWER(numero) = LOWER(?);",
                (self.numero,),
            ).fetchone()
            if existente is not None:
                raise ValueError(
                    f"Já existe um extintor cadastrado com o número '{self.numero}'."
                )

            cursor.execute(
                """
                INSERT INTO extintores (
                    numero, norma, fabricante, ano_fabricacao, ultimo_teste,
                    pressao_trabalho, unidade_pressao, tipo_agente,
                    capacidade, unidade, cidade, observacoes, data_cadastro
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    self.numero,
                    self.norma,
                    self.fabricante,
                    self.ano_fabricacao,
                    self.ultimo_teste,
                    self.pressao_trabalho,
                    self.unidade_pressao,
                    self.tipo_agente,
                    self.capacidade,
                    self.unidade,
                    self.cidade,
                    self.observacoes,
                    self.data_cadastro,
                ),
            )
            self.id = int(cursor.lastrowid)

            # Geração automática da OS sequencial dentro da mesma transação
            numero_os = db.obter_proximo_numero_os(conn)
            agora = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

            cursor.execute(
                """
                INSERT INTO ordens_servico (
                    numero_os, extintor_id, numero_extintor, data_criacao, status, observacoes
                ) VALUES (?, ?, ?, ?, 'Aberta', ?);
                """,
                (
                    numero_os,
                    self.id,
                    self.numero,
                    agora,
                    "OS gerada automaticamente no cadastro do extintor.",
                ),
            )
            os_id = int(cursor.lastrowid)

            # Registro inicial no histórico de serviços do equipamento
            cursor.execute(
                """
                INSERT INTO historico_servicos (
                    extintor_id, numero_extintor, ordem_servico_id, numero_os,
                    data_servico, tipo_servico, pecas_utilizadas, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    self.id,
                    self.numero,
                    os_id,
                    numero_os,
                    datetime.now().strftime("%d/%m/%Y"),
                    "Cadastro Inicial / Abertura de OS",
                    "Nenhuma",
                    self.observacoes or "Equipamento cadastrado no sistema.",
                ),
            )
            conn.commit()
            return self, numero_os

    def editar(self, db: DatabaseManager) -> "Extintor":
        """
        Atualiza as informações do extintor no banco preservando integralmente
        todo o histórico de serviços existente.
        """
        if self.id is None:
            raise ValueError("Não é possível editar um extintor sem ID cadastrado.")

        valido, erros = self.validar_dados()
        if not valido:
            raise ValueError("; ".join(erros))

        with db.conectar() as conn:
            cursor = conn.cursor()
            duplicado = cursor.execute(
                "SELECT id FROM extintores WHERE LOWER(numero) = LOWER(?) AND id != ?;",
                (self.numero, self.id),
            ).fetchone()
            if duplicado is not None:
                raise ValueError(
                    f"Já existe outro extintor cadastrado com o número '{self.numero}'."
                )

            cursor.execute(
                """
                UPDATE extintores SET
                    numero = ?,
                    norma = ?,
                    fabricante = ?,
                    ano_fabricacao = ?,
                    ultimo_teste = ?,
                    pressao_trabalho = ?,
                    unidade_pressao = ?,
                    tipo_agente = ?,
                    capacidade = ?,
                    unidade = ?,
                    cidade = ?,
                    observacoes = ?
                WHERE id = ?;
                """,
                (
                    self.numero,
                    self.norma,
                    self.fabricante,
                    self.ano_fabricacao,
                    self.ultimo_teste,
                    self.pressao_trabalho,
                    self.unidade_pressao,
                    self.tipo_agente,
                    self.capacidade,
                    self.unidade,
                    self.cidade,
                    self.observacoes,
                    self.id,
                ),
            )

            # Mantém o número de identificação sincronizado sem apagar o histórico
            cursor.execute(
                "UPDATE ordens_servico SET numero_extintor = ? WHERE extintor_id = ?;",
                (self.numero, self.id),
            )
            cursor.execute(
                "UPDATE historico_servicos SET numero_extintor = ? WHERE extintor_id = ?;",
                (self.numero, self.id),
            )
            conn.commit()
            return self

    @classmethod
    def consultar(cls, db: DatabaseManager, numero: str) -> Optional["Extintor"]:
        """Consulta um extintor pelo seu número de identificação."""
        with db.conectar() as conn:
            row = conn.execute(
                "SELECT * FROM extintores WHERE LOWER(numero) = LOWER(?);",
                (numero.strip(),),
            ).fetchone()
            return cls.from_row(row) if row else None

    @classmethod
    def consultar_por_id(cls, db: DatabaseManager, extintor_id: int) -> Optional["Extintor"]:
        """Consulta um extintor pelo ID interno."""
        with db.conectar() as conn:
            row = conn.execute(
                "SELECT * FROM extintores WHERE id = ?;",
                (extintor_id,),
            ).fetchone()
            return cls.from_row(row) if row else None

    @classmethod
    def listar_todos(cls, db: DatabaseManager) -> List["Extintor"]:
        """Retorna todos os extintores cadastrados ordenados por ID."""
        with db.conectar() as conn:
            rows = conn.execute("SELECT * FROM extintores ORDER BY id ASC;").fetchall()
            return [cls.from_row(r) for r in rows]

    @classmethod
    def excluir(cls, db: DatabaseManager, extintor_id: int) -> bool:
        """
        Exclui um extintor do cadastro.
        As Ordens de Serviço vinculadas têm a numeração preservada e não são
        reutilizadas (controle_sequencia permanece inalterado).
        """
        with db.conectar() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE ordens_servico
                SET status = 'Cancelada',
                    observacoes = CASE
                        WHEN observacoes = '' THEN 'Extintor excluído do cadastro.'
                        ELSE observacoes || ' | Extintor excluído do cadastro.'
                    END
                WHERE extintor_id = ? AND status != 'Concluída';
                """,
                (extintor_id,),
            )
            cursor.execute("DELETE FROM extintores WHERE id = ?;", (extintor_id,))
            removido = cursor.rowcount > 0
            conn.commit()
            return removido
