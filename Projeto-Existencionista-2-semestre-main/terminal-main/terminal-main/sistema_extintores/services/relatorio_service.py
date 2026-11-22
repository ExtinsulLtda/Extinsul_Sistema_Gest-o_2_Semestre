"""
Serviço de geração de relatórios no terminal e exportação para CSV (Excel).
"""

import csv
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional, Sequence, Tuple

from database import DatabaseManager
from utils.terminal import (
    exibir_aviso,
    exibir_erro,
    exibir_sucesso,
    exibir_tabela,
    exibir_titulo,
    formatar_numero,
    ler_entrada,
    pausar,
)


class RelatorioService:
    """Gera os 8 relatórios gerenciais previstos com opção de exportação CSV."""

    def __init__(self, db: DatabaseManager) -> None:
        self.db = db

    def exportar_csv(
        self,
        nome_base: str,
        cabecalhos: Sequence[str],
        linhas: Sequence[Sequence[Any]],
        pasta_destino: Optional[Path] = None,
    ) -> Path:
        """
        Exporta dados de relatório para arquivo CSV compatível com Microsoft Excel
        (codificação UTF-8 com BOM e delimitador ponto e vírgula).
        """
        destino_dir = Path(pasta_destino) if pasta_destino else self.db.export_dir
        destino_dir.mkdir(parents=True, exist_ok=True)
        carimbo = datetime.now().strftime("%Y%m%d_%H%M%S")
        caminho = destino_dir / f"{nome_base}_{carimbo}.csv"

        with open(caminho, mode="w", newline="", encoding="utf-8-sig") as arquivo:
            writer = csv.writer(arquivo, delimiter=";")
            writer.writerow(cabecalhos)
            for linha in linhas:
                writer.writerow(linha)

        return caminho

    # ------------------------------------------------------------------
    # Métodos de obtenção dos dados dos 8 relatórios
    # ------------------------------------------------------------------

    def dados_todos_extintores(self) -> Tuple[List[str], List[List[Any]]]:
        cab = [
            "Número",
            "Norma",
            "Fabricante",
            "Ano",
            "Último Teste",
            "Pressão",
            "Tipo Agente",
            "Capacidade",
            "Cidade",
            "OS Vinculadas",
        ]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT e.*, COALESCE(GROUP_CONCAT(os.numero_os, ', '), '-') AS os_lista
                FROM extintores e
                LEFT JOIN ordens_servico os ON os.extintor_id = e.id
                GROUP BY e.id
                ORDER BY e.id ASC;
                """
            ).fetchall()
        linhas = [
            [
                r["numero"],
                r["norma"],
                r["fabricante"],
                r["ano_fabricacao"],
                r["ultimo_teste"],
                f"{formatar_numero(r['pressao_trabalho'])} {r['unidade_pressao']}",
                r["tipo_agente"],
                f"{formatar_numero(r['capacidade'])} {r['unidade']}",
                r["cidade"],
                r["os_lista"],
            ]
            for r in rows
        ]
        return cab, linhas

    def dados_por_cidade(
        self, cidade: Optional[str] = None
    ) -> Tuple[List[str], List[List[Any]]]:
        if cidade and cidade.strip():
            cab = ["Número", "Tipo", "Capacidade", "Fabricante", "Último Teste", "Cidade"]
            with self.db.conectar() as conn:
                rows = conn.execute(
                    """
                    SELECT numero, tipo_agente, capacidade, unidade, fabricante, ultimo_teste, cidade
                    FROM extintores
                    WHERE LOWER(cidade) LIKE LOWER(?)
                    ORDER BY cidade, numero;
                    """,
                    (f"%{cidade.strip()}%",),
                ).fetchall()
            linhas = [
                [
                    r["numero"],
                    r["tipo_agente"],
                    f"{formatar_numero(r['capacidade'])} {r['unidade']}",
                    r["fabricante"],
                    r["ultimo_teste"],
                    r["cidade"],
                ]
                for r in rows
            ]
            return cab, linhas

        cab = ["Cidade", "Quantidade de Extintores", "Tipos Presentes"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT cidade, COUNT(*) AS total, GROUP_CONCAT(DISTINCT tipo_agente) AS tipos
                FROM extintores
                GROUP BY LOWER(cidade)
                ORDER BY total DESC, cidade ASC;
                """
            ).fetchall()
        linhas = [[r["cidade"], r["total"], r["tipos"] or "-"] for r in rows]
        return cab, linhas

    def dados_por_fabricante(
        self, fabricante: Optional[str] = None
    ) -> Tuple[List[str], List[List[Any]]]:
        if fabricante and fabricante.strip():
            cab = ["Número", "Fabricante", "Tipo", "Capacidade", "Ano", "Cidade"]
            with self.db.conectar() as conn:
                rows = conn.execute(
                    """
                    SELECT numero, fabricante, tipo_agente, capacidade, unidade, ano_fabricacao, cidade
                    FROM extintores
                    WHERE LOWER(fabricante) LIKE LOWER(?)
                    ORDER BY fabricante, numero;
                    """,
                    (f"%{fabricante.strip()}%",),
                ).fetchall()
            linhas = [
                [
                    r["numero"],
                    r["fabricante"],
                    r["tipo_agente"],
                    f"{formatar_numero(r['capacidade'])} {r['unidade']}",
                    r["ano_fabricacao"],
                    r["cidade"],
                ]
                for r in rows
            ]
            return cab, linhas

        cab = ["Fabricante", "Quantidade de Extintores", "Cidades"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT fabricante, COUNT(*) AS total, GROUP_CONCAT(DISTINCT cidade) AS cidades
                FROM extintores
                GROUP BY LOWER(fabricante)
                ORDER BY total DESC, fabricante ASC;
                """
            ).fetchall()
        linhas = [[r["fabricante"], r["total"], r["cidades"] or "-"] for r in rows]
        return cab, linhas

    def dados_por_tipo(self) -> Tuple[List[str], List[List[Any]]]:
        cab = ["Tipo de Agente", "Quantidade de Extintores", "Cidades"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT tipo_agente, COUNT(*) AS total, GROUP_CONCAT(DISTINCT cidade) AS cidades
                FROM extintores
                GROUP BY tipo_agente
                ORDER BY total DESC, tipo_agente ASC;
                """
            ).fetchall()
        linhas = [[r["tipo_agente"], r["total"], r["cidades"] or "-"] for r in rows]
        return cab, linhas

    def dados_ordens_servico(self) -> Tuple[List[str], List[List[Any]]]:
        cab = ["Nº OS", "Extintor Nº", "Data Criação", "Status", "Peças Utilizadas"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT
                    os.numero_os,
                    os.numero_extintor,
                    os.data_criacao,
                    os.status,
                    COALESCE(
                        GROUP_CONCAT(pos.nome_peca || ' (' || pos.quantidade || ' ' || pos.unidade || ')', ', '),
                        'Nenhuma'
                    ) AS pecas
                FROM ordens_servico os
                LEFT JOIN pecas_ordem_servico pos ON pos.ordem_servico_id = os.id
                GROUP BY os.id
                ORDER BY os.id DESC;
                """
            ).fetchall()
        linhas = [
            [
                r["numero_os"],
                r["numero_extintor"],
                r["data_criacao"],
                r["status"],
                r["pecas"],
            ]
            for r in rows
        ]
        return cab, linhas

    def dados_pecas_utilizadas(self) -> Tuple[List[str], List[List[Any]]]:
        cab = ["OS", "Código Peça", "Nome da Peça", "Quantidade", "Unidade", "Data Registro"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT numero_os, codigo_peca, nome_peca, quantidade, unidade, data_registro
                FROM pecas_ordem_servico
                ORDER BY id DESC;
                """
            ).fetchall()
        linhas = [
            [
                r["numero_os"],
                r["codigo_peca"],
                r["nome_peca"],
                formatar_numero(r["quantidade"]),
                r["unidade"],
                r["data_registro"],
            ]
            for r in rows
        ]
        return cab, linhas

    def dados_estoque_atual(self) -> Tuple[List[str], List[List[Any]]]:
        cab = ["Código", "Nome da Peça", "Categoria", "Disponível", "Unidade", "Mínimo", "Situação"]
        with self.db.conectar() as conn:
            rows = conn.execute("SELECT * FROM pecas ORDER BY id ASC;").fetchall()
        linhas = [
            [
                r["codigo"],
                r["nome"],
                r["categoria"],
                formatar_numero(r["quantidade"]),
                r["unidade"],
                formatar_numero(r["estoque_minimo"]),
                "ESTOQUE BAIXO" if r["quantidade"] <= r["estoque_minimo"] else "Normal",
            ]
            for r in rows
        ]
        return cab, linhas

    def dados_estoque_baixo(self) -> Tuple[List[str], List[List[Any]]]:
        cab = ["Código", "Nome da Peça", "Categoria", "Disponível", "Mínimo", "Déficit", "Unidade"]
        with self.db.conectar() as conn:
            rows = conn.execute(
                "SELECT * FROM pecas WHERE quantidade <= estoque_minimo ORDER BY quantidade ASC, id ASC;"
            ).fetchall()
        linhas = [
            [
                r["codigo"],
                r["nome"],
                r["categoria"],
                formatar_numero(r["quantidade"]),
                formatar_numero(r["estoque_minimo"]),
                formatar_numero(max(0.0, float(r["estoque_minimo"]) - float(r["quantidade"]))),
                r["unidade"],
            ]
            for r in rows
        ]
        return cab, linhas

    # ------------------------------------------------------------------
    # Exibição e exportação interativa
    # ------------------------------------------------------------------

    def _apresentar_relatorio(
        self,
        titulo: str,
        nome_csv: str,
        cabecalhos: Sequence[str],
        linhas: Sequence[Sequence[Any]],
    ) -> None:
        exibir_titulo(titulo, 72)
        exibir_tabela(linhas, cabecalhos)
        if linhas:
            print(f"\nTotal de registros no relatório: {len(linhas)}")
            resp = ler_entrada("Deseja exportar este relatório para CSV (Excel)? (S/N) [N]: ")
            if resp and resp.strip().upper() in {"S", "SIM"}:
                try:
                    caminho = self.exportar_csv(nome_csv, cabecalhos, linhas)
                    exibir_sucesso(f"Relatório exportado com sucesso em: {caminho}")
                except OSError as exc:
                    exibir_erro(f"Falha ao exportar CSV: {exc}")
        pausar()

    def menu_relatorios(self) -> None:
        """Menu principal de relatórios (Seção 10)."""
        while True:
            exibir_titulo("RELATÓRIOS DO SISTEMA")
            print("1. Relatório de todos os extintores")
            print("2. Relatório por cidade")
            print("3. Relatório por fabricante")
            print("4. Relatório por tipo de extintor")
            print("5. Relatório de Ordens de Serviço")
            print("6. Relatório de peças utilizadas")
            print("7. Relatório de estoque atual")
            print("8. Relatório de estoque baixo")
            print("9. Voltar ao menu principal")

            opcao = ler_entrada("\nEscolha uma opção: ")
            if opcao is None:
                return

            if opcao == "1":
                cab, linhas = self.dados_todos_extintores()
                self._apresentar_relatorio(
                    "RELATÓRIO: TODOS OS EXTINTORES", "relatorio_extintores", cab, linhas
                )
            elif opcao == "2":
                cidade = ler_entrada(
                    "Digite o nome da cidade para detalhar (ou Enter para resumo por cidade): "
                )
                cab, linhas = self.dados_por_cidade(cidade)
                self._apresentar_relatorio(
                    "RELATÓRIO POR CIDADE", "relatorio_por_cidade", cab, linhas
                )
            elif opcao == "3":
                fab = ler_entrada(
                    "Digite o fabricante para detalhar (ou Enter para resumo por fabricante): "
                )
                cab, linhas = self.dados_por_fabricante(fab)
                self._apresentar_relatorio(
                    "RELATÓRIO POR FABRICANTE", "relatorio_por_fabricante", cab, linhas
                )
            elif opcao == "4":
                cab, linhas = self.dados_por_tipo()
                self._apresentar_relatorio(
                    "RELATÓRIO POR TIPO DE EXTINTOR", "relatorio_por_tipo", cab, linhas
                )
            elif opcao == "5":
                cab, linhas = self.dados_ordens_servico()
                self._apresentar_relatorio(
                    "RELATÓRIO DE ORDENS DE SERVIÇO", "relatorio_ordens_servico", cab, linhas
                )
            elif opcao == "6":
                cab, linhas = self.dados_pecas_utilizadas()
                self._apresentar_relatorio(
                    "RELATÓRIO DE PEÇAS UTILIZADAS", "relatorio_pecas_utilizadas", cab, linhas
                )
            elif opcao == "7":
                cab, linhas = self.dados_estoque_atual()
                self._apresentar_relatorio(
                    "RELATÓRIO DE ESTOQUE ATUAL", "relatorio_estoque_atual", cab, linhas
                )
            elif opcao == "8":
                cab, linhas = self.dados_estoque_baixo()
                if linhas:
                    exibir_aviso("ALERTA: ESTOQUE BAIXO!")
                self._apresentar_relatorio(
                    "RELATÓRIO DE ESTOQUE BAIXO", "relatorio_estoque_baixo", cab, linhas
                )
            elif opcao == "9":
                return
            else:
                exibir_erro("Opção inválida. Escolha de 1 a 9.")
