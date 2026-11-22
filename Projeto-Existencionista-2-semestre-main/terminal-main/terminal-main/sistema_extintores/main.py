"""
Ponto de entrada do Sistema de Controle de Extintores via Terminal.

Responsável por instanciar a classe Sistema, inicializar o banco SQLite
e gerenciar o loop principal de navegação.
"""

from pathlib import Path
import sys

# Garante importações relativas à pasta sistema_extintores independente do CWD
RAIZ_PROJETO = Path(__file__).resolve().parent
if str(RAIZ_PROJETO) not in sys.path:
    sys.path.insert(0, str(RAIZ_PROJETO))

from database import DatabaseManager
from services.cadastro_service import CadastroService
from services.consulta_service import ConsultaService
from services.estoque_service import EstoqueService
from services.relatorio_service import RelatorioService
from utils.terminal import (
    Fore,
    Style,
    exibir_erro,
    exibir_info,
    exibir_separador,
    ler_entrada,
    limpar_tela,
    pausar,
)


class Sistema:
    """Classe principal controladora do menu e dos módulos do sistema."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db = DatabaseManager(db_path=db_path)
        self.cadastro_service = CadastroService(self.db)
        self.consulta_service = ConsultaService(self.db)
        self.estoque_service = EstoqueService(self.db)
        self.relatorio_service = RelatorioService(self.db)

    def exibir_menu_principal(self) -> None:
        """Exibe o menu principal numerado conforme especificação do projeto."""
        exibir_separador("=", 40)
        print(f"{Style.BRIGHT}{Fore.CYAN}SISTEMA DE CONTROLE DE EXTINTORES{Style.RESET_ALL}")
        print()
        print("1. Cadastrar extintor")
        print("2. Consultar extintor")
        print("3. Ver estoque de peças")
        print("4. Pesquisar extintor")
        print("5. Consultar Ordens de Serviço")
        print("6. Gerenciar peças e movimentações")
        print("7. Relatórios")
        print("8. Sair")

    def executar(self) -> None:
        """Executa o loop principal do sistema até o usuário optar por sair."""
        while True:
            limpar_tela()
            self.exibir_menu_principal()
            opcao = ler_entrada("\nEscolha uma opção: ")

            if opcao is None:
                print()
                exibir_info("Encerrando o sistema com segurança. Até logo!")
                break

            if opcao == "1":
                self.cadastro_service.cadastrar_extintor_interativo()
            elif opcao == "2":
                self.consulta_service.menu_consultar_extintor()
            elif opcao == "3":
                self.estoque_service.ver_estoque_pecas()
            elif opcao == "4":
                self.consulta_service.pesquisar_extintores_interativo()
            elif opcao == "5":
                self.consulta_service.menu_ordens_servico()
            elif opcao == "6":
                self.estoque_service.menu_gerenciar_pecas()
            elif opcao == "7":
                self.relatorio_service.menu_relatorios()
            elif opcao == "8":
                exibir_info("Sistema encerrado. Todos os dados foram salvos no banco local.")
                break
            else:
                exibir_erro("Opção inválida. Por favor, escolha um número de 1 a 8.")
                pausar()


def main() -> None:
    """Inicializa e executa o Sistema de Controle de Extintores."""
    import os

    env_db = os.environ.get("EXTINTORES_DB_PATH")
    db_path = Path(env_db) if env_db else None
    sistema = Sistema(db_path=db_path)
    sistema.executar()


if __name__ == "__main__":
    main()
