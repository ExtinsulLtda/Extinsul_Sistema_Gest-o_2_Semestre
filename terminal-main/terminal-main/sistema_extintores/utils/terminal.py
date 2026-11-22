"""
Módulo de utilitários para exibição e interação no terminal.

Suporta cores via Colorama (com fallback automático para ANSI ou texto puro)
e formatação de tabelas via Tabulate (com fallback ASCII integrado).
"""

import os
import sys
from typing import Any, Iterable, List, Optional, Sequence

# Tenta importar Colorama para suporte multiplataforma de cores no terminal
try:
    from colorama import Fore, Style, init as colorama_init

    colorama_init(autoreset=True)
    TEM_COLORAMA = True
except ImportError:
    TEM_COLORAMA = False

    class _AnsiFallback:
        """Fallback com códigos ANSI quando o terminal oferece suporte."""

        def __init__(self, habilitado: bool) -> None:
            self.RED = "\033[91m" if habilitado else ""
            self.GREEN = "\033[92m" if habilitado else ""
            self.YELLOW = "\033[93m" if habilitado else ""
            self.BLUE = "\033[94m" if habilitado else ""
            self.CYAN = "\033[96m" if habilitado else ""
            self.WHITE = "\033[97m" if habilitado else ""
            self.MAGENTA = "\033[95m" if habilitado else ""

    class _StyleFallback:
        def __init__(self, habilitado: bool) -> None:
            self.BRIGHT = "\033[1m" if habilitado else ""
            self.DIM = "\033[2m" if habilitado else ""
            self.RESET_ALL = "\033[0m" if habilitado else ""

    _suporta_ansi = hasattr(sys.stdout, "isatty") and sys.stdout.isatty()
    Fore = _AnsiFallback(_suporta_ansi)
    Style = _StyleFallback(_suporta_ansi)

# Tenta importar Tabulate para tabelas avançadas, mantendo alternativa nativa
try:
    from tabulate import tabulate as _tabulate

    TEM_TABULATE = True
except ImportError:
    TEM_TABULATE = False
    _tabulate = None


LARGURA_PADRAO = 72


def limpar_tela() -> None:
    """Limpa o conteúdo visível do terminal de acordo com o sistema operacional."""
    if not (hasattr(sys.stdout, "isatty") and sys.stdout.isatty()):
        print()
        return
    os.system("cls" if os.name == "nt" else "clear")


def exibir_separador(caractere: str = "=", largura: int = 40) -> None:
    """Exibe uma linha separadora estilizada no terminal."""
    print(f"{Fore.CYAN}{caractere * largura}{Style.RESET_ALL}")


def exibir_titulo(titulo: str, largura: int = 40) -> None:
    """Exibe um cabeçalho padronizado com separador superior."""
    print()
    exibir_separador("=", largura)
    print(f"{Style.BRIGHT}{Fore.CYAN}{titulo}{Style.RESET_ALL}")
    exibir_separador("=", largura)


def exibir_subtitulo(subtitulo: str, largura: int = 40) -> None:
    """Exibe um subtítulo discreto para seções internas."""
    print(f"\n{Style.BRIGHT}{Fore.BLUE}--- {subtitulo} ---{Style.RESET_ALL}")


def exibir_sucesso(mensagem: str) -> None:
    """Exibe mensagem de confirmação em verde."""
    print(f"{Style.BRIGHT}{Fore.GREEN}[SUCESSO] {mensagem}{Style.RESET_ALL}")


def exibir_erro(mensagem: str) -> None:
    """Exibe mensagem de erro em vermelho."""
    print(f"{Style.BRIGHT}{Fore.RED}[ERRO] {mensagem}{Style.RESET_ALL}")


def exibir_aviso(mensagem: str) -> None:
    """Exibe mensagem de alerta/aviso em amarelo."""
    print(f"{Style.BRIGHT}{Fore.YELLOW}[AVISO] {mensagem}{Style.RESET_ALL}")


def exibir_info(mensagem: str) -> None:
    """Exibe mensagem informativa em ciano."""
    print(f"{Fore.CYAN}[INFO] {mensagem}{Style.RESET_ALL}")


def pausar(mensagem: str = "Pressione Enter para continuar...") -> None:
    """Pausa a execução até que o usuário pressione Enter."""
    try:
        input(f"\n{Style.DIM}{mensagem}{Style.RESET_ALL}")
    except (EOFError, KeyboardInterrupt):
        print()


def ler_entrada(prompt: str, permitir_cancelar: bool = False) -> Optional[str]:
    """
    Lê uma entrada do usuário tratando interrupções sem encerrar abruptamente.
    Se permitir_cancelar=True e o usuário digitar '0' ou 'cancelar', retorna None.
    """
    try:
        valor = input(prompt)
    except EOFError:
        return None
    except KeyboardInterrupt:
        print()
        return None

    texto = valor.strip()
    if permitir_cancelar and texto.lower() in {"cancelar", "!cancelar"}:
        return None
    return texto


def confirmar(mensagem: str = "Deseja confirmar esta operação? (S/N): ") -> bool:
    """Solicita confirmação explícita S/N do usuário."""
    while True:
        resposta = ler_entrada(f"{Fore.YELLOW}{mensagem}{Style.RESET_ALL}")
        if resposta is None:
            return False
        resp_norm = resposta.strip().upper()
        if resp_norm in {"S", "SIM"}:
            return True
        if resp_norm in {"N", "NAO", "NÃO"}:
            return False
        exibir_erro("Resposta inválida. Digite S para Sim ou N para Não.")


def formatar_numero(valor: Any) -> str:
    """Formata inteiros sem '.0' e mantém decimais quando necessário."""
    if isinstance(valor, bool):
        return str(valor)
    if isinstance(valor, (int, float)):
        if float(valor).is_integer():
            return str(int(valor))
        return f"{float(valor):.2f}".rstrip("0").rstrip(".")
    return str(valor)


def _formatar_tabela_nativa(
    linhas: Sequence[Sequence[Any]],
    cabecalhos: Sequence[str],
) -> str:
    """Implementação nativa em Python puro de tabela ASCII/grid alinhada."""
    str_cabecalhos = [str(c) for c in cabecalhos]
    str_linhas = [[str(c) if c is not None else "" for c in linha] for linha in linhas]

    num_colunas = len(str_cabecalhos)
    larguras = [len(c) for c in str_cabecalhos]

    for linha in str_linhas:
        for i in range(min(num_colunas, len(linha))):
            larguras[i] = max(larguras[i], len(linha[i]))

    def _linha_borda(sep_cruz: str = "+", sep_horiz: str = "-") -> str:
        partes = [sep_horiz * (w + 2) for w in larguras]
        return f"{sep_cruz}{sep_cruz.join(partes)}{sep_cruz}"

    def _linha_dados(celulas: Sequence[str]) -> str:
        itens = []
        for i in range(num_colunas):
            conteudo = celulas[i] if i < len(celulas) else ""
            itens.append(f" {conteudo.ljust(larguras[i])} ")
        return f"|{'|'.join(itens)}|"

    saida: List[str] = [
        _linha_borda(),
        _linha_dados(str_cabecalhos),
        _linha_borda("+", "="),
    ]
    for linha in str_linhas:
        saida.append(_linha_dados(linha))
    saida.append(_linha_borda())
    return "\n".join(saida)


def exibir_tabela(
    linhas: Iterable[Sequence[Any]],
    cabecalhos: Sequence[str],
    mensagem_vazia: str = "Nenhum registro encontrado.",
) -> None:
    """Exibe uma tabela formatada usando Tabulate (se disponível) ou fallback nativo."""
    dados = list(linhas)
    if not dados:
        exibir_aviso(mensagem_vazia)
        return

    if TEM_TABULATE and _tabulate is not None:
        tabela = _tabulate(dados, headers=cabecalhos, tablefmt="grid")
    else:
        tabela = _formatar_tabela_nativa(dados, cabecalhos)
    print(tabela)
