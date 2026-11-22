"""
Testes automatizados cobrindo todos os cenários exigidos na Seção 16 e validações.
"""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RAIZ_PROJETO = Path(__file__).resolve().parent.parent
if str(RAIZ_PROJETO) not in sys.path:
    sys.path.insert(0, str(RAIZ_PROJETO))

from database import DatabaseManager, PECAS_INICIAIS
from models.estoque import Estoque
from models.extintor import Extintor
from models.ordem_servico import OrdemServico
from models.peca import Peca
from services.consulta_service import ConsultaService
from services.relatorio_service import RelatorioService
from utils.validacoes import (
    normalizar_numero_os,
    validar_ano_fabricacao,
    validar_data_br,
    validar_decimal_positivo,
    validar_tipo_agente,
    validar_unidade_capacidade,
)


class TestSistemaExtintores(unittest.TestCase):
    """Suite de testes de integração, persistência e regras de negócio."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "teste_extintores.db"
        self.db = DatabaseManager(db_path=self.db_path)
        self.estoque = Estoque(self.db)
        self.consulta = ConsultaService(self.db)
        self.relatorio = RelatorioService(self.db)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _criar_extintor_exemplo(self, numero: str = "265", cidade: str = "Varginha") -> tuple:
        ext = Extintor(
            numero=numero,
            norma="ABNT NBR 15808",
            fabricante="Exemplo",
            ano_fabricacao=2023,
            ultimo_teste="10/05/2025",
            pressao_trabalho=10.5,
            unidade_pressao="kgf/cm²",
            tipo_agente="Pó ABC",
            capacidade=6,
            unidade="kg",
            cidade=cidade,
            observacoes="Equipamento revisado",
        )
        return ext.cadastrar(self.db)

    def test_01_seed_inicial_29_pecas_preservando_nomenclatura(self) -> None:
        pecas = self.estoque.listar_pecas()
        self.assertEqual(len(pecas), len(PECAS_INICIAIS))
        nomes = {p.nome for p in pecas}
        self.assertIn("O'Hing de pino", nomes)
        self.assertIn("Bucha PO4, PO6, PO8, PO12 e AP10 — pequena", nomes)
        self.assertIn("Anel do miolo da válvula Yanes", nomes)
        self.assertIn("Vedantes e O'Hings diversos", nomes)
        self.assertIn("Arruela inox M30 P4", nomes)

    def test_02_cadastro_extintor_duplicidade_e_os_automatica(self) -> None:
        ext1, os1 = self._criar_extintor_exemplo("265", "Varginha")
        self.assertEqual(os1, "OS-000001")
        self.assertIsNotNone(ext1.id)

        # Tentativa de cadastrar o mesmo número deve falhar
        duplicado = Extintor(
            numero="265",
            norma="NBR 15808",
            fabricante="Outro",
            ano_fabricacao=2024,
            ultimo_teste="12/05/2025",
            pressao_trabalho=14.0,
            unidade_pressao="bar",
            tipo_agente="CO2",
            capacidade=6,
            unidade="kg",
            cidade="Três Corações",
        )
        with self.assertRaises(ValueError):
            duplicado.cadastrar(self.db)

        # Segundo cadastro válido recebe OS-000002
        _, os2 = self._criar_extintor_exemplo("266", "Varginha")
        self.assertEqual(os2, "OS-000002")

        # Mesmo excluindo o extintor 266, a próxima OS deve ser OS-000003 (nunca reutiliza)
        ext266 = Extintor.consultar(self.db, "266")
        self.assertIsNotNone(ext266)
        Extintor.excluir(self.db, ext266.id)  # type: ignore[arg-type]

        _, os3 = self._criar_extintor_exemplo("267", "Lavras")
        self.assertEqual(os3, "OS-000003")

    def test_03_consultas_por_numero_os_cidade_e_combinada(self) -> None:
        self._criar_extintor_exemplo("101", "Varginha")
        self._criar_extintor_exemplo("102", "Varginha")
        self._criar_extintor_exemplo("103", "Alfenas")

        # Consulta por número
        e101 = self.consulta.buscar_por_numero("101")
        self.assertIsNotNone(e101)
        self.assertEqual(e101.cidade, "Varginha")  # type: ignore[union-attr]

        # Consulta por OS
        os_obj = self.consulta.buscar_por_os("OS-000002")
        self.assertIsNotNone(os_obj)
        self.assertEqual(os_obj.numero_extintor, "102")  # type: ignore[union-attr]
        self.assertIsNone(self.consulta.buscar_por_os("OS-999999"))

        # Consulta por cidade
        varginha = self.consulta.buscar_por_cidade("Varginha")
        self.assertEqual(len(varginha), 2)

        # Pesquisa combinada
        comb = self.consulta.pesquisar_combinado(
            cidade="Varginha",
            fabricante="Exemplo",
            tipo_agente="Pó ABC",
            ano_fabricacao=2023,
        )
        self.assertEqual(len(comb), 2)

    def test_04_edicao_preserva_historico_servicos(self) -> None:
        ext, os1 = self._criar_extintor_exemplo("500", "Varginha")
        hist_antes = self.consulta.obter_historico_extintor("500")
        self.assertEqual(len(hist_antes), 1)
        self.assertEqual(hist_antes[0]["numero_os"], os1)

        ext.cidade = "Pouso Alegre"
        ext.observacoes = "Atualizado após vistoria"
        ext.editar(self.db)

        ext_atual = Extintor.consultar(self.db, "500")
        self.assertEqual(ext_atual.cidade, "Pouso Alegre")  # type: ignore[union-attr]
        hist_depois = self.consulta.obter_historico_extintor("500")
        self.assertEqual(len(hist_depois), 1)
        self.assertEqual(hist_depois[0]["numero_os"], os1)

    def test_05_estoque_cadastro_entrada_retirada_bloqueio_e_vincular_os(self) -> None:
        # Cadastrar nova peça
        nova = Peca(
            codigo="PC-099",
            nome="Anel teste especial",
            categoria="Peças Pequenas",
            quantidade=0,
            unidade="un",
            estoque_minimo=3,
        )
        salva = self.estoque.cadastrar_peca(nova)
        self.assertIsNotNone(salva.id)

        # Adicionar estoque
        qtd_pos_entrada, alerta = self.estoque.movimentar_estoque(
            salva.id, "ENTRADA", 10, "Compra fornecedor"  # type: ignore[arg-type]
        )
        self.assertEqual(qtd_pos_entrada, 10)
        self.assertFalse(alerta)

        # Tentar retirar mais do que existe -> deve lançar ValueError
        with self.assertRaises(ValueError):
            self.estoque.movimentar_estoque(
                salva.id, "SAIDA", 15, "Teste inválido"  # type: ignore[arg-type]
            )

        # Retirar 4 unidades manualmente (sobram 6 > mínimo 3)
        qtd_pos_saida, alerta = self.estoque.movimentar_estoque(
            salva.id, "SAIDA", 4, "Uso interno"  # type: ignore[arg-type]
        )
        self.assertEqual(qtd_pos_saida, 6)
        self.assertFalse(alerta)

        # Vincular 4 unidades a uma OS -> sobram 2 <= mínimo 3 -> deve gerar alerta de estoque baixo!
        _, num_os = self._criar_extintor_exemplo("700", "Varginha")
        os_obj = OrdemServico.consultar(self.db, num_os)
        self.assertIsNotNone(os_obj)

        ok, _, alerta_baixo = os_obj.adicionar_peca(self.db, salva.id, 4)  # type: ignore[union-attr, arg-type]
        self.assertTrue(ok)
        self.assertTrue(alerta_baixo)

        # Reconsultar OS e confirmar peças vinculadas e histórico atualizado
        os_reconsultada = OrdemServico.consultar(self.db, num_os)
        self.assertEqual(len(os_reconsultada.pecas_utilizadas), 1)  # type: ignore[union-attr]
        self.assertEqual(os_reconsultada.pecas_utilizadas[0]["quantidade"], 4)  # type: ignore[union-attr]

        hist = self.consulta.obter_historico_extintor("700")
        self.assertIn("Anel teste especial", hist[0]["pecas_utilizadas"])

        movs = self.estoque.consultar_historico(peca_id=salva.id)
        self.assertEqual(len(movs), 3)

    def test_06_persistencia_entre_fechamento_e_reabertura(self) -> None:
        self._criar_extintor_exemplo("900", "Itajubá")
        # Cria uma nova instância apontando para o mesmo arquivo SQLite
        novo_db = DatabaseManager(db_path=self.db_path)
        ext = Extintor.consultar(novo_db, "900")
        self.assertIsNotNone(ext)
        self.assertEqual(ext.cidade, "Itajubá")  # type: ignore[union-attr]
        os_obj = OrdemServico.consultar(novo_db, "OS-000001")
        self.assertIsNotNone(os_obj)

    def test_07_relatorios_e_exportacao_csv(self) -> None:
        self._criar_extintor_exemplo("801", "Varginha")
        cab, linhas = self.relatorio.dados_todos_extintores()
        self.assertEqual(len(linhas), 1)
        csv_path = self.relatorio.exportar_csv(
            "teste_extintores",
            cab,
            linhas,
            pasta_destino=Path(self.temp_dir.name) / "csv",
        )
        self.assertTrue(csv_path.exists())
        conteudo = csv_path.read_text(encoding="utf-8-sig")
        self.assertIn("801", conteudo)
        self.assertIn("OS-000001", conteudo)

    def test_08_validacoes_unitarias(self) -> None:
        self.assertFalse(validar_ano_fabricacao("1800")[0])
        self.assertTrue(validar_ano_fabricacao("2022")[0])
        self.assertFalse(validar_data_br("31/02/2024")[0])
        self.assertTrue(validar_data_br("28/02/2024")[0])
        self.assertTrue(validar_decimal_positivo("10,5", "Pressão")[0])
        self.assertFalse(validar_decimal_positivo("-2", "Qtd")[0])
        self.assertEqual(validar_tipo_agente("4")[1], "CO2")
        self.assertFalse(validar_unidade_capacidade("litros", "CO2")[0])
        self.assertTrue(validar_unidade_capacidade("litros", "Água")[0])
        self.assertEqual(normalizar_numero_os("os-12"), "OS-000012")

    def test_09_execucao_terminal_real_e_persistencia_entre_sessoes(self) -> None:
        """Simula execução real pelo terminal abrindo main.py, cadastrando, fechando e reabrindo."""
        import os

        env = os.environ.copy()
        env["EXTINTORES_DB_PATH"] = str(self.db_path)

        # Sessão 1: opção inválida, cadastra extintor 265 e sai
        sessao1 = "\n".join(
            [
                "99",
                "",
                "1",
                "265",
                "ABNT NBR 15808",
                "Exemplo",
                "2023",
                "15/08/2025",
                "10.5",
                "1",
                "2",
                "6",
                "kg",
                "Varginha",
                "",
                "",
                "8",
            ]
        ) + "\n"
        proc1 = subprocess.run(
            [sys.executable, str(RAIZ_PROJETO / "main.py")],
            input=sessao1,
            text=True,
            capture_output=True,
            env=env,
            timeout=10,
        )
        self.assertEqual(proc1.returncode, 0)
        self.assertIn("Opção inválida", proc1.stdout)
        self.assertIn("CADASTRO REALIZADO COM SUCESSO", proc1.stdout)
        self.assertIn("Ordem de Serviço: OS-000001", proc1.stdout)

        # Sessão 2 (reabertura após fechar): consulta OS-000001 e verifica persistência
        sessao2 = "2\n2\nOS-000001\n\n5\n8\n"
        proc2 = subprocess.run(
            [sys.executable, str(RAIZ_PROJETO / "main.py")],
            input=sessao2,
            text=True,
            capture_output=True,
            env=env,
            timeout=10,
        )
        self.assertEqual(proc2.returncode, 0)
        self.assertIn("FICHA DO EXTINTOR Nº 265", proc2.stdout)
        self.assertIn("Varginha", proc2.stdout)
        self.assertIn("OS-000001", proc2.stdout)
        self.assertIn("Sistema encerrado", proc2.stdout)

    def test_10_fluxo_interativo_completo_estoque_os_relatorios(self) -> None:
        """Executa fluxo interativo de estoque, bloqueio, vinculação à OS e relatório."""
        import io
        from unittest.mock import patch
        from main import Sistema

        inputs = [
            "1", "301", "NBR 15808", "ExtinFab", "2024", "10/01/2025", "12", "1", "4", "6", "kg", "Varginha", "", "",
            "6", "3", "PC-001", "10", "Compra", "", "4", "PC-001", "20", "3", "Uso", "", "", "9",
            "5", "3", "OS-000001", "PC-001", "3", "N", "", "1", "OS-000001", "", "7",
            "7", "1", "N", "", "9",
            "8",
        ]
        buf = io.StringIO()
        with patch("builtins.input", side_effect=inputs), patch("sys.stdout", buf):
            Sistema(db_path=self.db_path).executar()
        out = buf.getvalue()
        self.assertIn("Ordem de Serviço: OS-000001", out)
        self.assertIn("Quantidade indisponível!", out)
        self.assertIn("ALERTA: ESTOQUE BAIXO!", out)
        self.assertIn("Mangueira de CO2", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
