"""
Módulo de validações obrigatórias para entradas de dados do sistema.

Garante consistência de datas, anos, números decimais, tipos de agente,
unidades, quantidades de estoque e campos obrigatórios/opcionais.
"""

from datetime import datetime
import re
from typing import Dict, List, Optional, Tuple


TIPOS_AGENTE: Dict[str, str] = {
    "1": "Água",
    "2": "Pó ABC",
    "3": "Pó BC",
    "4": "CO2",
}

TIPOS_AGENTE_VALIDOS: Tuple[str, ...] = ("Água", "Pó ABC", "Pó BC", "CO2")

UNIDADES_PRESSAO_SUGERIDAS: Tuple[str, ...] = ("kgf/cm²", "bar", "psi", "MPa")

STATUS_OS_VALIDOS: Tuple[str, ...] = (
    "Aberta",
    "Em Andamento",
    "Concluída",
    "Cancelada",
)


def validar_texto_obrigatorio(valor: str, nome_campo: str) -> Tuple[bool, str, str]:
    """Valida se um campo de texto obrigatório não está vazio."""
    limpo = (valor or "").strip()
    if not limpo:
        return False, "", f"O campo '{nome_campo}' é obrigatório."
    return True, limpo, ""


def validar_numero_extintor(valor: str) -> Tuple[bool, str, str]:
    """Valida o número de identificação individual do extintor."""
    limpo = (valor or "").strip()
    if not limpo:
        return False, "", "O número de identificação do extintor é obrigatório."
    if len(limpo) > 50:
        return False, "", "O número do extintor deve ter no máximo 50 caracteres."
    return True, limpo, ""


def validar_ano_fabricacao(valor: str) -> Tuple[bool, int, str]:
    """Valida o ano de fabricação (entre 1950 e o ano corrente)."""
    limpo = (valor or "").strip()
    if not limpo:
        return False, 0, "O ano de fabricação é obrigatório."
    if not limpo.isdigit() or len(limpo) != 4:
        return False, 0, "Informe um ano válido com 4 dígitos (ex: 2022)."

    ano = int(limpo)
    ano_atual = datetime.now().year
    if ano < 1950 or ano > ano_atual:
        return (
            False,
            0,
            f"Ano de fabricação inválido. Informe um ano entre 1950 e {ano_atual}.",
        )
    return True, ano, ""


def validar_data_br(valor: str, permitir_futura: bool = False) -> Tuple[bool, str, str]:
    """Valida data estritamente no formato DD/MM/AAAA."""
    limpo = (valor or "").strip()
    if not limpo:
        return False, "", "A data é obrigatória no formato DD/MM/AAAA."

    if not re.match(r"^\d{2}/\d{2}/\d{4}$", limpo):
        return False, "", "Formato de data inválido. Utilize DD/MM/AAAA (ex: 15/08/2025)."

    try:
        data_obj = datetime.strptime(limpo, "%d/%m/%Y")
    except ValueError:
        return False, "", "Data inexistente no calendário. Verifique dia e mês."

    if not permitir_futura and data_obj.date() > datetime.now().date():
        return False, "", "A data não pode ser superior à data atual."

    return True, data_obj.strftime("%d/%m/%Y"), ""


def validar_decimal_positivo(
    valor: str,
    nome_campo: str,
    permitir_zero: bool = False,
) -> Tuple[bool, float, str]:
    """Valida números inteiros ou decimais (aceitando vírgula ou ponto)."""
    limpo = (valor or "").strip().replace(",", ".")
    if not limpo:
        return False, 0.0, f"O campo '{nome_campo}' é obrigatório."

    try:
        numero = float(limpo)
    except ValueError:
        return False, 0.0, f"'{nome_campo}' deve ser um valor numérico válido."

    if permitir_zero:
        if numero < 0:
            return False, 0.0, f"'{nome_campo}' não pode ser negativo."
    else:
        if numero <= 0:
            return False, 0.0, f"'{nome_campo}' deve ser maior que zero."

    return True, numero, ""


def validar_tipo_agente(escolha: str) -> Tuple[bool, str, str]:
    """Valida a opção de tipo de agente extintor (1 a 4 ou nome direto)."""
    limpo = (escolha or "").strip()
    if limpo in TIPOS_AGENTE:
        return True, TIPOS_AGENTE[limpo], ""

    mapa_nomes = {nome.lower(): nome for nome in TIPOS_AGENTE_VALIDOS}
    mapa_nomes.update({"agua": "Água", "po abc": "Pó ABC", "po bc": "Pó BC"})
    if limpo.lower() in mapa_nomes:
        return True, mapa_nomes[limpo.lower()], ""

    return False, "", "Tipo de agente inválido. Escolha uma opção de 1 a 4."


def normalizar_numero_os(valor: str) -> str:
    """
    Normaliza entradas de Ordem de Serviço.
    Aceita 'OS-000001', 'os-1', ou '1' -> 'OS-000001'.
    """
    limpo = (valor or "").strip().upper()
    if not limpo:
        return ""
    if limpo.isdigit():
        return f"OS-{int(limpo):06d}"
    match = re.match(r"^OS[-_\s]?(\d+)$", limpo)
    if match:
        return f"OS-{int(match.group(1)):06d}"
    return limpo


def validar_unidade_capacidade(unidade: str, tipo_agente: str) -> Tuple[bool, str, str]:
    """
    Valida a unidade de capacidade/peso conforme o equipamento.
    Não força mesma unidade para todos: permite kg, litros (L), g, etc.
    """
    limpo = (unidade or "").strip().lower()
    if not limpo:
        return False, "", "A unidade de medida da capacidade é obrigatória."

    aliases = {
        "l": "litros",
        "lt": "litros",
        "lts": "litros",
        "litro": "litros",
        "litros": "litros",
        "kg": "kg",
        "quilo": "kg",
        "quilos": "kg",
        "g": "g",
    }
    normalizada = aliases.get(limpo, limpo)

    if tipo_agente == "CO2" and normalizada == "litros":
        return False, "", "Para extintores de CO2, informe a carga nominal em kg."

    return True, normalizada, ""


def obter_unidades_sugeridas_capacidade(tipo_agente: str) -> List[str]:
    """Retorna as unidades recomendadas de capacidade para o tipo de agente."""
    if tipo_agente == "Água":
        return ["litros", "kg"]
    if tipo_agente == "CO2":
        return ["kg"]
    return ["kg", "g"]
