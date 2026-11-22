"""
Modelo de domínio Estoque para gerenciamento global de peças e movimentações.
"""

import sqlite3
from typing import Dict, List, Optional, Tuple

from database import DatabaseManager
from models.ordem_servico import OrdemServico
from models.peca import Peca


class Estoque:
    """Orquestra cadastro, listagem, movimentações e alertas do estoque de peças."""

    def __init__(self, db: DatabaseManager) -> None:
        self.db = db

    def cadastrar_peca(self, peca: Peca) -> Peca:
        """Cadastra uma nova peça no estoque evitando duplicidade de código ou nome."""
        valido, msg = peca.validar_dados()
        if not valido:
            raise ValueError(msg)

        with self.db.conectar() as conn:
            cursor = conn.cursor()
            dup = cursor.execute(
                """
                SELECT codigo, nome FROM pecas
                WHERE UPPER(codigo) = UPPER(?) OR LOWER(nome) = LOWER(?);
                """,
                (peca.codigo, peca.nome),
            ).fetchone()
            if dup is not None:
                raise ValueError(
                    f"Já existe uma peça cadastrada com código '{dup['codigo']}' ou nome '{dup['nome']}'."
                )

            cursor.execute(
                """
                INSERT INTO pecas (
                    codigo, nome, categoria, quantidade, unidade, estoque_minimo, observacoes
                ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    peca.codigo,
                    peca.nome,
                    peca.categoria,
                    peca.quantidade,
                    peca.unidade,
                    peca.estoque_minimo,
                    peca.observacoes,
                ),
            )
            peca.id = int(cursor.lastrowid)

            # Se iniciou com saldo > 0, registra movimentação inicial
            if peca.quantidade > 0:
                from datetime import datetime

                agora_data = datetime.now().strftime("%d/%m/%Y")
                agora_hora = datetime.now().strftime("%H:%M:%S")
                cursor.execute(
                    """
                    INSERT INTO movimentacoes_estoque (
                        peca_id, codigo_peca, nome_peca, tipo_movimentacao,
                        quantidade, quantidade_anterior, quantidade_nova,
                        data_movimentacao, hora_movimentacao, motivo,
                        ordem_servico_id, numero_os
                    ) VALUES (?, ?, ?, 'ENTRADA', ?, 0, ?, ?, ?, 'Saldo inicial no cadastro', NULL, '');
                    """,
                    (
                        peca.id,
                        peca.codigo,
                        peca.nome,
                        peca.quantidade,
                        peca.quantidade,
                        agora_data,
                        agora_hora,
                    ),
                )

            conn.commit()
            return peca

    def buscar_por_id(self, peca_id: int) -> Optional[Peca]:
        """Busca uma peça pelo ID."""
        with self.db.conectar() as conn:
            row = conn.execute("SELECT * FROM pecas WHERE id = ?;", (peca_id,)).fetchone()
            return Peca.from_row(row) if row else None

    def pesquisar_pecas(self, termo: str) -> List[Peca]:
        """Pesquisa peças por código, nome ou categoria."""
        like = f"%{termo.strip()}%"
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT * FROM pecas
                WHERE UPPER(codigo) LIKE UPPER(?)
                   OR LOWER(nome) LIKE LOWER(?)
                   OR LOWER(categoria) LIKE LOWER(?)
                ORDER BY id ASC;
                """,
                (like, like, like),
            ).fetchall()
            return [Peca.from_row(r) for r in rows]

    def listar_pecas(self, categoria: Optional[str] = None) -> List[Peca]:
        """Lista todas as peças cadastradas (ou filtradas por categoria)."""
        with self.db.conectar() as conn:
            if categoria:
                rows = conn.execute(
                    "SELECT * FROM pecas WHERE LOWER(categoria) = LOWER(?) ORDER BY id ASC;",
                    (categoria.strip(),),
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM pecas ORDER BY id ASC;").fetchall()
            return [Peca.from_row(r) for r in rows]

    def editar_peca(self, peca: Peca) -> Peca:
        """Atualiza dados descritivos da peça preservando o histórico de movimentações."""
        if peca.id is None:
            raise ValueError("Peça sem ID não pode ser editada.")
        valido, msg = peca.validar_dados()
        if not valido:
            raise ValueError(msg)

        with self.db.conectar() as conn:
            cursor = conn.cursor()
            dup = cursor.execute(
                """
                SELECT codigo, nome FROM pecas
                WHERE (UPPER(codigo) = UPPER(?) OR LOWER(nome) = LOWER(?))
                  AND id != ?;
                """,
                (peca.codigo, peca.nome, peca.id),
            ).fetchone()
            if dup is not None:
                raise ValueError(
                    "Já existe outra peça com este mesmo código ou nome."
                )

            cursor.execute(
                """
                UPDATE pecas SET
                    codigo = ?,
                    nome = ?,
                    categoria = ?,
                    unidade = ?,
                    estoque_minimo = ?,
                    observacoes = ?
                WHERE id = ?;
                """,
                (
                    peca.codigo,
                    peca.nome,
                    peca.categoria,
                    peca.unidade,
                    peca.estoque_minimo,
                    peca.observacoes,
                    peca.id,
                ),
            )
            conn.commit()
            return peca

    def movimentar_estoque(
        self,
        peca_id: int,
        tipo: str,
        quantidade: float,
        motivo: str,
        numero_os: str = "",
    ) -> Tuple[float, bool]:
        """
        Executa entrada ou saída de estoque para uma peça.
        Retorna (nova_quantidade, alerta_estoque_baixo).
        """
        peca = self.buscar_por_id(peca_id)
        if peca is None:
            raise ValueError("Peça não encontrada.")

        tipo_norm = tipo.strip().upper()
        if tipo_norm == "ENTRADA":
            nova = peca.adicionar_estoque(self.db, quantidade, motivo)
            return nova, peca.esta_baixo()

        if tipo_norm == "SAIDA":
            os_id: Optional[int] = None
            os_num_norm = ""
            if numero_os.strip():
                os_obj = OrdemServico.consultar(self.db, numero_os)
                if os_obj is None:
                    raise ValueError("Ordem de Serviço não encontrada.")
                os_id = os_obj.id
                os_num_norm = os_obj.numero_os
            return peca.retirar_estoque(
                self.db,
                quantidade,
                motivo=motivo,
                ordem_servico_id=os_id,
                numero_os=os_num_norm,
            )

        raise ValueError("Tipo de movimentação inválido. Use ENTRADA ou SAIDA.")

    def verificar_estoque_baixo(self) -> List[Peca]:
        """Retorna todas as peças com saldo menor ou igual ao estoque mínimo."""
        with self.db.conectar() as conn:
            rows = conn.execute(
                "SELECT * FROM pecas WHERE quantidade <= estoque_minimo ORDER BY quantidade ASC, id ASC;"
            ).fetchall()
            return [Peca.from_row(r) for r in rows]

    def consultar_historico(
        self,
        peca_id: Optional[int] = None,
        numero_os: Optional[str] = None,
    ) -> List[Dict[str, object]]:
        """Consulta o histórico de movimentações de estoque com filtros opcionais."""
        filtros: List[str] = []
        params: List[object] = []

        if peca_id is not None:
            filtros.append("peca_id = ?")
            params.append(peca_id)
        if numero_os:
            filtros.append("UPPER(numero_os) = UPPER(?)")
            params.append(numero_os.strip())

        where = f"WHERE {' AND '.join(filtros)}" if filtros else ""
        sql = f"SELECT * FROM movimentacoes_estoque {where} ORDER BY id DESC;"

        with self.db.conectar() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
