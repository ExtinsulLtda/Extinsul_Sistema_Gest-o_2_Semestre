"""
Serviço de cadastramento, edição, exclusão e registro de serviços de extintores.
"""

from datetime import datetime
from typing import Optional

from database import DatabaseManager
from models.extintor import Extintor
from models.ordem_servico import OrdemServico
from utils.terminal import (
    Fore,
    Style,
    confirmar,
    exibir_aviso,
    exibir_erro,
    exibir_info,
    exibir_separador,
    exibir_sucesso,
    exibir_titulo,
    formatar_numero,
    ler_entrada,
    pausar,
)
from utils.validacoes import (
    TIPOS_AGENTE,
    UNIDADES_PRESSAO_SUGERIDAS,
    obter_unidades_sugeridas_capacidade,
    validar_ano_fabricacao,
    validar_data_br,
    validar_decimal_positivo,
    validar_numero_extintor,
    validar_texto_obrigatorio,
    validar_tipo_agente,
    validar_unidade_capacidade,
)


class CadastroService:
    """Gerencia o fluxo de cadastro, edição e exclusão de extintores."""

    def __init__(self, db: DatabaseManager) -> None:
        self.db = db

    def _ler_campo_obrigatorio(self, prompt: str, nome_campo: str) -> Optional[str]:
        """Solicita um campo de texto obrigatório em loop até validar ou cancelar."""
        while True:
            entrada = ler_entrada(prompt, permitir_cancelar=True)
            if entrada is None:
                return None
            ok, limpo, msg = validar_texto_obrigatorio(entrada, nome_campo)
            if ok:
                return limpo
            exibir_erro(msg)

    def _selecionar_tipo_agente(self) -> Optional[str]:
        """Exibe as opções numeradas de agente extintor e valida a escolha."""
        print("\nTipo de agente extintor:")
        for chave, nome in TIPOS_AGENTE.items():
            print(f"  {chave}. {nome}")

        while True:
            entrada = ler_entrada("Escolha o tipo (1-4): ", permitir_cancelar=True)
            if entrada is None:
                return None
            ok, tipo, msg = validar_tipo_agente(entrada)
            if ok:
                return tipo
            exibir_erro(msg)

    def _ler_unidade_pressao(self) -> Optional[str]:
        """Permite escolher uma unidade de pressão sugerida ou informar outra."""
        print("\nUnidade de medida da pressão de trabalho:")
        for idx, un in enumerate(UNIDADES_PRESSAO_SUGERIDAS, start=1):
            print(f"  {idx}. {un}")
        print("  5. Outra unidade")

        while True:
            entrada = ler_entrada(
                "Escolha a unidade (1-5 ou digite diretamente) [1 = kgf/cm²]: ",
                permitir_cancelar=True,
            )
            if entrada is None:
                return None
            if entrada == "":
                return "kgf/cm²"
            if entrada in {"1", "2", "3", "4"}:
                return UNIDADES_PRESSAO_SUGERIDAS[int(entrada) - 1]
            if entrada == "5":
                return self._ler_campo_obrigatorio("Digite a unidade de pressão: ", "Unidade de pressão")
            ok, limpo, msg = validar_texto_obrigatorio(entrada, "Unidade de pressão")
            if ok:
                return limpo
            exibir_erro(msg)

    def _ler_capacidade_e_unidade(self, tipo_agente: str) -> Optional[tuple]:
        """Solicita capacidade/peso numérico e a unidade adequada ao equipamento."""
        sugestoes = obter_unidades_sugeridas_capacidade(tipo_agente)
        exemplos = {
            "Água": "Exemplos: 10 litros ou 10 kg",
            "CO2": "Exemplos: 4 kg, 6 kg",
            "Pó ABC": "Exemplos: 4 kg, 6 kg, 8 kg, 12 kg",
            "Pó BC": "Exemplos: 4 kg, 6 kg, 8 kg, 12 kg",
        }
        print(f"\nCapacidade ou peso ({exemplos.get(tipo_agente, 'Ex: 6 kg')}):")

        while True:
            valor_str = ler_entrada("Valor numérico da capacidade/peso: ", permitir_cancelar=True)
            if valor_str is None:
                return None
            ok, valor_num, msg = validar_decimal_positivo(valor_str, "Capacidade/Peso")
            if ok:
                break
            exibir_erro(msg)

        padrao = sugestoes[0]
        print(f"Unidades sugeridas para {tipo_agente}: {', '.join(sugestoes)}")
        while True:
            un_str = ler_entrada(
                f"Unidade de medida [{padrao}]: ",
                permitir_cancelar=True,
            )
            if un_str is None:
                return None
            if un_str == "":
                un_str = padrao
            ok, un_norm, msg = validar_unidade_capacidade(un_str, tipo_agente)
            if ok:
                return valor_num, un_norm
            exibir_erro(msg)

    def cadastrar_extintor_interativo(self) -> Optional[Extintor]:
        """Executa o formulário completo de cadastro de extintor no terminal."""
        exibir_titulo("CADASTRAR EXTINTOR")
        exibir_info("Digite 'cancelar' em qualquer campo para interromper o cadastro.\n")

        # 1. Número de identificação (validando duplicidade imediatamente)
        while True:
            num_raw = ler_entrada("1. Número de identificação do extintor: ", permitir_cancelar=True)
            if num_raw is None:
                exibir_aviso("Cadastro cancelado pelo usuário.")
                pausar()
                return None
            ok, numero, msg = validar_numero_extintor(num_raw)
            if not ok:
                exibir_erro(msg)
                continue
            if Extintor.consultar(self.db, numero) is not None:
                exibir_erro(
                    f"Já existe um extintor cadastrado com o número '{numero}'. Informe outro número."
                )
                continue
            break

        # 2. Norma técnica
        norma = self._ler_campo_obrigatorio(
            "2. Norma técnica (ex: ABNT NBR 15808): ",
            "Norma técnica",
        )
        if norma is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        # 3. Fabricante
        fabricante = self._ler_campo_obrigatorio("3. Fabricante: ", "Fabricante")
        if fabricante is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        # 4. Ano de fabricação
        while True:
            ano_raw = ler_entrada("4. Ano de fabricação (AAAA): ", permitir_cancelar=True)
            if ano_raw is None:
                exibir_aviso("Cadastro cancelado pelo usuário.")
                pausar()
                return None
            ok, ano_fabricacao, msg = validar_ano_fabricacao(ano_raw)
            if ok:
                break
            exibir_erro(msg)

        # 5. Último teste realizado
        while True:
            data_raw = ler_entrada(
                "5. Data do último teste realizado (DD/MM/AAAA): ",
                permitir_cancelar=True,
            )
            if data_raw is None:
                exibir_aviso("Cadastro cancelado pelo usuário.")
                pausar()
                return None
            ok, ultimo_teste, msg = validar_data_br(data_raw)
            if ok:
                break
            exibir_erro(msg)

        # 6. Pressão de trabalho
        while True:
            pressao_raw = ler_entrada(
                "6. Pressão de trabalho (ex: 10.5): ",
                permitir_cancelar=True,
            )
            if pressao_raw is None:
                exibir_aviso("Cadastro cancelado pelo usuário.")
                pausar()
                return None
            ok, pressao_trabalho, msg = validar_decimal_positivo(
                pressao_raw, "Pressão de trabalho"
            )
            if ok:
                break
            exibir_erro(msg)

        unidade_pressao = self._ler_unidade_pressao()
        if unidade_pressao is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        # 7. Tipo de agente extintor
        tipo_agente = self._selecionar_tipo_agente()
        if tipo_agente is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        # 8. Capacidade ou peso
        cap_res = self._ler_capacidade_e_unidade(tipo_agente)
        if cap_res is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None
        capacidade, unidade = cap_res

        # 9. Cidade
        cidade = self._ler_campo_obrigatorio("\n9. Cidade: ", "Cidade")
        if cidade is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        # 10. Observações adicionais (opcional)
        obs_raw = ler_entrada(
            "10. Observações adicionais (opcional, Enter para pular): ",
            permitir_cancelar=True,
        )
        if obs_raw is None:
            exibir_aviso("Cadastro cancelado pelo usuário.")
            pausar()
            return None

        extintor = Extintor(
            numero=numero,
            norma=norma,
            fabricante=fabricante,
            ano_fabricacao=ano_fabricacao,
            ultimo_teste=ultimo_teste,
            pressao_trabalho=pressao_trabalho,
            unidade_pressao=unidade_pressao,
            tipo_agente=tipo_agente,
            capacidade=capacidade,
            unidade=unidade,
            cidade=cidade,
            observacoes=obs_raw,
        )

        try:
            salvo, numero_os = extintor.cadastrar(self.db)
        except ValueError as exc:
            exibir_erro(str(exc))
            pausar()
            return None

        print()
        exibir_separador("=", 40)
        print(f"{Style.BRIGHT}{Fore.GREEN}CADASTRO REALIZADO COM SUCESSO{Style.RESET_ALL}")
        print()
        print(f"Número do extintor: {salvo.numero}")
        print(f"Fabricante: {salvo.fabricante}")
        print(f"Tipo: {salvo.tipo_agente}")
        print(f"Capacidade: {formatar_numero(salvo.capacidade)} {salvo.unidade}")
        print(f"Cidade: {salvo.cidade}")
        print(f"{Style.BRIGHT}{Fore.CYAN}Ordem de Serviço: {numero_os}{Style.RESET_ALL}")
        exibir_separador("=", 40)
        pausar()
        return salvo

    def editar_extintor_interativo(self, extintor: Extintor) -> Optional[Extintor]:
        """Edita os campos de um extintor preservando todo o histórico de serviços."""
        exibir_titulo(f"EDITAR EXTINTOR Nº {extintor.numero}")
        exibir_info("Pressione Enter para manter o valor atual de qualquer campo.\n")

        # Número
        while True:
            novo_num = ler_entrada(
                f"Número do extintor [{extintor.numero}]: ", permitir_cancelar=True
            )
            if novo_num is None:
                exibir_aviso("Edição cancelada.")
                return None
            if novo_num == "":
                novo_num = extintor.numero
                break
            ok, limpo, msg = validar_numero_extintor(novo_num)
            if not ok:
                exibir_erro(msg)
                continue
            outro = Extintor.consultar(self.db, limpo)
            if outro is not None and outro.id != extintor.id:
                exibir_erro(f"O número '{limpo}' já pertence a outro extintor.")
                continue
            novo_num = limpo
            break

        nova_norma = ler_entrada(f"Norma técnica [{extintor.norma}]: ", permitir_cancelar=True)
        if nova_norma is None:
            exibir_aviso("Edição cancelada.")
            return None
        nova_norma = nova_norma or extintor.norma

        novo_fab = ler_entrada(f"Fabricante [{extintor.fabricante}]: ", permitir_cancelar=True)
        if novo_fab is None:
            exibir_aviso("Edição cancelada.")
            return None
        novo_fab = novo_fab or extintor.fabricante

        while True:
            ano_str = ler_entrada(
                f"Ano de fabricação [{extintor.ano_fabricacao}]: ", permitir_cancelar=True
            )
            if ano_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if ano_str == "":
                novo_ano = extintor.ano_fabricacao
                break
            ok, novo_ano, msg = validar_ano_fabricacao(ano_str)
            if ok:
                break
            exibir_erro(msg)

        while True:
            teste_str = ler_entrada(
                f"Último teste (DD/MM/AAAA) [{extintor.ultimo_teste}]: ",
                permitir_cancelar=True,
            )
            if teste_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if teste_str == "":
                novo_teste = extintor.ultimo_teste
                break
            ok, novo_teste, msg = validar_data_br(teste_str)
            if ok:
                break
            exibir_erro(msg)

        while True:
            p_str = ler_entrada(
                f"Pressão de trabalho [{formatar_numero(extintor.pressao_trabalho)}]: ",
                permitir_cancelar=True,
            )
            if p_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if p_str == "":
                nova_pressao = extintor.pressao_trabalho
                break
            ok, nova_pressao, msg = validar_decimal_positivo(p_str, "Pressão de trabalho")
            if ok:
                break
            exibir_erro(msg)

        nova_un_pressao = ler_entrada(
            f"Unidade da pressão [{extintor.unidade_pressao}]: ",
            permitir_cancelar=True,
        )
        if nova_un_pressao is None:
            exibir_aviso("Edição cancelada.")
            return None
        nova_un_pressao = nova_un_pressao or extintor.unidade_pressao

        print(f"Tipo atual: {extintor.tipo_agente} (1. Água | 2. Pó ABC | 3. Pó BC | 4. CO2)")
        while True:
            t_str = ler_entrada(
                f"Novo tipo (1-4 ou Enter para manter '{extintor.tipo_agente}'): ",
                permitir_cancelar=True,
            )
            if t_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if t_str == "":
                novo_tipo = extintor.tipo_agente
                break
            ok, novo_tipo, msg = validar_tipo_agente(t_str)
            if ok:
                break
            exibir_erro(msg)

        while True:
            cap_str = ler_entrada(
                f"Capacidade/Peso [{formatar_numero(extintor.capacidade)}]: ",
                permitir_cancelar=True,
            )
            if cap_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if cap_str == "":
                nova_cap = extintor.capacidade
                break
            ok, nova_cap, msg = validar_decimal_positivo(cap_str, "Capacidade/Peso")
            if ok:
                break
            exibir_erro(msg)

        while True:
            un_cap_str = ler_entrada(
                f"Unidade da capacidade [{extintor.unidade}]: ",
                permitir_cancelar=True,
            )
            if un_cap_str is None:
                exibir_aviso("Edição cancelada.")
                return None
            if un_cap_str == "":
                un_cap_str = extintor.unidade
            ok, nova_un_cap, msg = validar_unidade_capacidade(un_cap_str, novo_tipo)
            if ok:
                break
            exibir_erro(msg)

        nova_cidade = ler_entrada(f"Cidade [{extintor.cidade}]: ", permitir_cancelar=True)
        if nova_cidade is None:
            exibir_aviso("Edição cancelada.")
            return None
        nova_cidade = nova_cidade or extintor.cidade

        nova_obs = ler_entrada(
            f"Observações [{extintor.observacoes or 'Nenhuma'}]: ",
            permitir_cancelar=True,
        )
        if nova_obs is None:
            exibir_aviso("Edição cancelada.")
            return None
        if nova_obs == "":
            nova_obs = extintor.observacoes

        extintor.numero = novo_num
        extintor.norma = nova_norma
        extintor.fabricante = novo_fab
        extintor.ano_fabricacao = novo_ano
        extintor.ultimo_teste = novo_teste
        extintor.pressao_trabalho = nova_pressao
        extintor.unidade_pressao = nova_un_pressao
        extintor.tipo_agente = novo_tipo
        extintor.capacidade = nova_cap
        extintor.unidade = nova_un_cap
        extintor.cidade = nova_cidade
        extintor.observacoes = nova_obs

        try:
            atualizado = extintor.editar(self.db)
            exibir_sucesso(
                f"Extintor '{atualizado.numero}' atualizado com sucesso! Histórico de serviços preservado."
            )
            pausar()
            return atualizado
        except ValueError as exc:
            exibir_erro(str(exc))
            pausar()
            return None

    def excluir_extintor_interativo(self, extintor: Extintor) -> bool:
        """Exclui um extintor após confirmação explícita, mantendo sequência de OS."""
        exibir_aviso(
            f"Você está prestes a excluir o extintor Nº {extintor.numero} ({extintor.cidade})."
        )
        exibir_info("As numerações de Ordens de Serviço já emitidas NÃO serão reutilizadas.")
        if not confirmar("Tem certeza que deseja excluir este extintor? (S/N): "):
            exibir_info("Exclusão cancelada.")
            return False

        if extintor.id is not None and Extintor.excluir(self.db, extintor.id):
            exibir_sucesso(f"Extintor Nº {extintor.numero} excluído com sucesso.")
            pausar()
            return True

        exibir_erro("Não foi possível excluir o extintor.")
        pausar()
        return False

    def registrar_nova_os_interativo(self, extintor: Extintor) -> Optional[OrdemServico]:
        """Gera uma nova Ordem de Serviço para um extintor já cadastrado."""
        exibir_titulo(f"NOVA ORDEM DE SERVIÇO - EXTINTOR {extintor.numero}")
        tipo_servico = ler_entrada(
            "Tipo de serviço (ex: Recarga, Inspeção, Teste Hidrostático) [Manutenção]: ",
            permitir_cancelar=True,
        )
        if tipo_servico is None:
            exibir_aviso("Operação cancelada.")
            return None
        tipo_servico = tipo_servico or "Manutenção"

        obs = ler_entrada("Observações do serviço (opcional): ", permitir_cancelar=True)
        if obs is None:
            exibir_aviso("Operação cancelada.")
            return None

        try:
            os_obj = OrdemServico.criar_para_extintor(
                self.db, extintor, tipo_servico=tipo_servico, observacoes=obs
            )
            exibir_sucesso(
                f"Ordem de Serviço {os_obj.numero_os} criada em {datetime.now().strftime('%d/%m/%Y')}!"
            )
            return os_obj
        except ValueError as exc:
            exibir_erro(str(exc))
            return None
