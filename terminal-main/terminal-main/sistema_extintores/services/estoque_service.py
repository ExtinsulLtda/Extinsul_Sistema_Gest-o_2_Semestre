"""
Serviço de controle de peças, movimentações de estoque e vinculação a Ordens de Serviço.
"""

from typing import List, Optional

from database import DatabaseManager
from models.estoque import Estoque
from models.ordem_servico import OrdemServico
from models.peca import Peca
from utils.terminal import (
    Fore,
    Style,
    exibir_aviso,
    exibir_erro,
    exibir_info,
    exibir_sucesso,
    exibir_tabela,
    exibir_titulo,
    formatar_numero,
    ler_entrada,
    pausar,
)
from utils.validacoes import (
    normalizar_numero_os,
    validar_decimal_positivo,
    validar_texto_obrigatorio,
)


class EstoqueService:
    """Gerencia operações de estoque e vinculação de peças às Ordens de Serviço."""

    def __init__(self, db: DatabaseManager) -> None:
        self.db = db
        self.estoque = Estoque(db)

    def _exibir_tabela_pecas(
        self,
        pecas: List[Peca],
        mensagem_vazia: str = "Nenhuma peça cadastrada.",
    ) -> None:
        linhas = []
        for p in pecas:
            situacao = "ESTOQUE BAIXO!" if p.esta_baixo() else "Normal"
            linhas.append(
                [
                    p.codigo,
                    p.nome,
                    p.categoria,
                    formatar_numero(p.quantidade),
                    p.unidade,
                    formatar_numero(p.estoque_minimo),
                    situacao,
                ]
            )
        exibir_tabela(
            linhas,
            ["Código", "Nome da Peça", "Categoria", "Disponível", "Un.", "Mínimo", "Situação"],
            mensagem_vazia=mensagem_vazia,
        )

    def _selecionar_peca(self, prompt: str = "Digite o código ou parte do nome da peça: ") -> Optional[Peca]:
        """Localiza uma peça por código exato ou busca por nome com seleção numerada."""
        termo = ler_entrada(prompt, permitir_cancelar=True)
        if termo is None or termo == "":
            return None

        exata = Peca.consultar_estoque(self.db, termo)
        if exata is not None:
            return exata

        candidatos = self.estoque.pesquisar_pecas(termo)
        if not candidatos:
            exibir_erro(f"Nenhuma peça encontrada para '{termo}'.")
            return None
        if len(candidatos) == 1:
            return candidatos[0]

        print("\nForam encontradas várias peças correspondentes:")
        for idx, p in enumerate(candidatos, start=1):
            print(
                f"  {idx}. [{p.codigo}] {p.nome} "
                f"(Disp: {formatar_numero(p.quantidade)} {p.unidade})"
            )

        while True:
            esc = ler_entrada("Escolha o número da peça (ou Enter para cancelar): ")
            if esc is None or esc == "":
                return None
            if esc.isdigit() and 1 <= int(esc) <= len(candidatos):
                return candidatos[int(esc) - 1]
            exibir_erro("Seleção inválida.")

    # ------------------------------------------------------------------
    # Menu 3: Ver estoque de peças
    # ------------------------------------------------------------------

    def ver_estoque_pecas(self) -> None:
        """Exibição rápida do estoque atual (Opção 3 do Menu Principal)."""
        exibir_titulo("ESTOQUE DE PEÇAS E COMPONENTES", 72)
        pecas = self.estoque.listar_pecas()
        self._exibir_tabela_pecas(pecas)

        baixos = self.estoque.verificar_estoque_baixo()
        print(f"\nTotal de itens catalogados: {len(pecas)}")
        if baixos:
            exibir_aviso(
                f"ALERTA: ESTOQUE BAIXO! {len(baixos)} item(ns) estão abaixo ou no limite mínimo."
            )
        pausar()

    # ------------------------------------------------------------------
    # Operações da Seção 7.4
    # ------------------------------------------------------------------

    def cadastrar_peca_interativo(self) -> Optional[Peca]:
        exibir_titulo("CADASTRAR NOVA PEÇA")
        exibir_info("Digite 'cancelar' para interromper.\n")

        with self.db.conectar() as conn:
            cod_sugerido = self.db.gerar_proximo_codigo_peca(conn)

        codigo = ler_entrada(
            f"Código de identificação [{cod_sugerido}]: ", permitir_cancelar=True
        )
        if codigo is None:
            return None
        if codigo == "":
            codigo = cod_sugerido

        while True:
            nome_in = ler_entrada("Nome da peça: ", permitir_cancelar=True)
            if nome_in is None:
                return None
            ok, nome, msg = validar_texto_obrigatorio(nome_in, "Nome da peça")
            if ok:
                break
            exibir_erro(msg)

        print("\nCategorias sugeridas:")
        print("  1. Mangueiras e Componentes Principais")
        print("  2. Peças Pequenas")
        print("  3. Outra categoria")
        while True:
            cat_in = ler_entrada("Escolha a categoria (1-3 ou digite) [2]: ", permitir_cancelar=True)
            if cat_in is None:
                return None
            if cat_in == "" or cat_in == "2":
                categoria = "Peças Pequenas"
                break
            if cat_in == "1":
                categoria = "Mangueiras e Componentes Principais"
                break
            if cat_in == "3":
                cat_custom = ler_entrada("Informe o nome da categoria: ", permitir_cancelar=True)
                if cat_custom is None:
                    return None
                ok, categoria, msg = validar_texto_obrigatorio(cat_custom, "Categoria")
                if ok:
                    break
                exibir_erro(msg)
            else:
                categoria = cat_in
                break

        while True:
            qtd_in = ler_entrada("Quantidade inicial disponível [0]: ", permitir_cancelar=True)
            if qtd_in is None:
                return None
            if qtd_in == "":
                quantidade = 0.0
                break
            ok, quantidade, msg = validar_decimal_positivo(
                qtd_in, "Quantidade inicial", permitir_zero=True
            )
            if ok:
                break
            exibir_erro(msg)

        unidade = ler_entrada("Unidade de medida (ex: un, pç, kit) [un]: ", permitir_cancelar=True)
        if unidade is None:
            return None
        unidade = unidade or "un"

        while True:
            min_in = ler_entrada("Quantidade mínima de estoque [5]: ", permitir_cancelar=True)
            if min_in is None:
                return None
            if min_in == "":
                estoque_minimo = 5.0
                break
            ok, estoque_minimo, msg = validar_decimal_positivo(
                min_in, "Quantidade mínima", permitir_zero=True
            )
            if ok:
                break
            exibir_erro(msg)

        obs = ler_entrada("Observações (opcional): ", permitir_cancelar=True)
        if obs is None:
            return None

        peca = Peca(
            codigo=codigo,
            nome=nome,
            categoria=categoria,
            quantidade=quantidade,
            unidade=unidade,
            estoque_minimo=estoque_minimo,
            observacoes=obs,
        )
        try:
            salva = self.estoque.cadastrar_peca(peca)
            exibir_sucesso(f"Peça [{salva.codigo}] '{salva.nome}' cadastrada com sucesso!")
            if salva.esta_baixo():
                exibir_aviso("ALERTA: ESTOQUE BAIXO!")
        except ValueError as exc:
            exibir_erro(str(exc))
            salva = None
        pausar()
        return salva

    def consultar_peca_interativo(self) -> None:
        exibir_titulo("CONSULTAR PEÇA")
        termo = ler_entrada("Informe código, nome ou categoria da peça: ")
        if not termo:
            return
        pecas = self.estoque.pesquisar_pecas(termo)
        self._exibir_tabela_pecas(
            pecas, mensagem_vazia=f"Nenhuma peça encontrada para '{termo}'."
        )
        if len(pecas) == 1:
            p = pecas[0]
            print(f"\nObservações: {p.observacoes or 'Nenhuma'}")
            if p.esta_baixo():
                exibir_aviso("ALERTA: ESTOQUE BAIXO!")
        pausar()

    def adicionar_quantidade_interativo(self) -> None:
        exibir_titulo("ADICIONAR QUANTIDADE AO ESTOQUE")
        peca = self._selecionar_peca()
        if peca is None or peca.id is None:
            pausar()
            return

        print(
            f"Peça selecionada: [{peca.codigo}] {peca.nome} | "
            f"Atual: {formatar_numero(peca.quantidade)} {peca.unidade}"
        )
        while True:
            qtd_in = ler_entrada("Quantidade a adicionar: ", permitir_cancelar=True)
            if qtd_in is None:
                return
            ok, qtd, msg = validar_decimal_positivo(qtd_in, "Quantidade a adicionar")
            if ok:
                break
            exibir_erro(msg)

        motivo = ler_entrada("Motivo / Documento (ex: Compra NF 123) [Reposição de estoque]: ")
        if motivo is None:
            return
        motivo = motivo or "Reposição de estoque"

        try:
            nova_qtd, _ = self.estoque.movimentar_estoque(
                peca.id, "ENTRADA", qtd, motivo=motivo
            )
            exibir_sucesso(
                f"Entrada registrada! Novo saldo de '{peca.nome}': "
                f"{formatar_numero(nova_qtd)} {peca.unidade}."
            )
        except ValueError as exc:
            exibir_erro(str(exc))
        pausar()

    def retirar_quantidade_interativo(self) -> None:
        exibir_titulo("RETIRAR QUANTIDADE DO ESTOQUE")
        peca = self._selecionar_peca()
        if peca is None or peca.id is None:
            pausar()
            return

        print(
            f"Peça selecionada: [{peca.codigo}] {peca.nome} | "
            f"Disponível: {formatar_numero(peca.quantidade)} {peca.unidade}"
        )
        if peca.quantidade <= 0:
            exibir_erro("Não há saldo disponível para retirada desta peça.")
            pausar()
            return

        while True:
            qtd_in = ler_entrada("Quantidade a retirar: ", permitir_cancelar=True)
            if qtd_in is None:
                return
            ok, qtd, msg = validar_decimal_positivo(qtd_in, "Quantidade a retirar")
            if not ok:
                exibir_erro(msg)
                continue
            if qtd > peca.quantidade:
                exibir_erro(
                    f"Quantidade indisponível! Máximo disponível: "
                    f"{formatar_numero(peca.quantidade)} {peca.unidade}."
                )
                continue
            break

        while True:
            motivo_in = ler_entrada("Motivo da retirada: ", permitir_cancelar=True)
            if motivo_in is None:
                return
            ok, motivo, msg = validar_texto_obrigatorio(motivo_in, "Motivo")
            if ok:
                break
            exibir_erro(msg)

        os_in = ler_entrada(
            "Ordem de Serviço relacionada (opcional, Enter se não houver): ",
            permitir_cancelar=True,
        )
        if os_in is None:
            return

        try:
            nova_qtd, alerta = self.estoque.movimentar_estoque(
                peca.id, "SAIDA", qtd, motivo=motivo, numero_os=os_in
            )
            exibir_sucesso(
                f"Retirada registrada! Novo saldo de '{peca.nome}': "
                f"{formatar_numero(nova_qtd)} {peca.unidade}."
            )
            if alerta:
                exibir_aviso("ALERTA: ESTOQUE BAIXO!")
        except ValueError as exc:
            exibir_erro(str(exc))
        pausar()

    def editar_peca_interativo(self) -> None:
        exibir_titulo("EDITAR INFORMAÇÕES DA PEÇA")
        peca = self._selecionar_peca()
        if peca is None:
            pausar()
            return

        exibir_info("Pressione Enter para manter o valor atual.\n")
        novo_cod = ler_entrada(f"Código [{peca.codigo}]: ", permitir_cancelar=True)
        if novo_cod is None:
            return
        novo_nome = ler_entrada(f"Nome [{peca.nome}]: ", permitir_cancelar=True)
        if novo_nome is None:
            return
        nova_cat = ler_entrada(f"Categoria [{peca.categoria}]: ", permitir_cancelar=True)
        if nova_cat is None:
            return
        nova_un = ler_entrada(f"Unidade [{peca.unidade}]: ", permitir_cancelar=True)
        if nova_un is None:
            return

        while True:
            min_in = ler_entrada(
                f"Estoque mínimo [{formatar_numero(peca.estoque_minimo)}]: ",
                permitir_cancelar=True,
            )
            if min_in is None:
                return
            if min_in == "":
                novo_min = peca.estoque_minimo
                break
            ok, novo_min, msg = validar_decimal_positivo(
                min_in, "Estoque mínimo", permitir_zero=True
            )
            if ok:
                break
            exibir_erro(msg)

        nova_obs = ler_entrada(
            f"Observações [{peca.observacoes or 'Nenhuma'}]: ", permitir_cancelar=True
        )
        if nova_obs is None:
            return

        peca.codigo = (novo_cod or peca.codigo).strip().upper()
        peca.nome = (novo_nome or peca.nome).strip()
        peca.categoria = (nova_cat or peca.categoria).strip()
        peca.unidade = (nova_un or peca.unidade).strip()
        peca.estoque_minimo = novo_min
        if nova_obs != "":
            peca.observacoes = nova_obs

        try:
            self.estoque.editar_peca(peca)
            exibir_sucesso(f"Peça [{peca.codigo}] atualizada com sucesso!")
        except ValueError as exc:
            exibir_erro(str(exc))
        pausar()

    def consultar_estoque_baixo_interativo(self) -> None:
        exibir_titulo("PEÇAS COM ESTOQUE BAIXO", 72)
        baixos = self.estoque.verificar_estoque_baixo()
        if baixos:
            exibir_aviso("ALERTA: ESTOQUE BAIXO! Os itens abaixo atingiram o mínimo configurado.\n")
        self._exibir_tabela_pecas(
            baixos, mensagem_vazia="Nenhuma peça está com estoque baixo no momento."
        )
        pausar()

    def consultar_historico_movimentacoes_interativo(self) -> None:
        exibir_titulo("HISTÓRICO DE MOVIMENTAÇÕES DE ESTOQUE", 72)
        print("Filtrar por:")
        print("  1. Todas as movimentações")
        print("  2. Por peça específica")
        print("  3. Por Ordem de Serviço")
        esc = ler_entrada("Escolha [1]: ") or "1"

        peca_id: Optional[int] = None
        numero_os: Optional[str] = None
        if esc == "2":
            p = self._selecionar_peca()
            if p is None:
                return
            peca_id = p.id
        elif esc == "3":
            os_in = ler_entrada("Número da OS: ")
            if not os_in:
                return
            numero_os = normalizar_numero_os(os_in)

        movs = self.estoque.consultar_historico(peca_id=peca_id, numero_os=numero_os)
        linhas = [
            [
                m["data_movimentacao"],
                m["hora_movimentacao"],
                m["tipo_movimentacao"],
                m["codigo_peca"],
                m["nome_peca"],
                formatar_numero(m["quantidade"]),
                formatar_numero(m["quantidade_anterior"]),
                formatar_numero(m["quantidade_nova"]),
                m["numero_os"] or "-",
                m["motivo"],
            ]
            for m in movs
        ]
        exibir_tabela(
            linhas,
            [
                "Data",
                "Hora",
                "Tipo",
                "Código",
                "Peça",
                "Qtd",
                "Ant.",
                "Nova",
                "OS",
                "Motivo",
            ],
            mensagem_vazia="Nenhuma movimentação registrada para o filtro selecionado.",
        )
        pausar()

    # ------------------------------------------------------------------
    # Seção 8: Vincular peças à Ordem de Serviço
    # ------------------------------------------------------------------

    def vincular_peca_a_os_interativo(
        self, numero_os_inicial: Optional[str] = None
    ) -> None:
        """Permite vincular uma ou mais peças utilizadas a uma OS com baixa no estoque."""
        exibir_titulo("VINCULAR PEÇAS À ORDEM DE SERVIÇO", 60)

        if numero_os_inicial:
            os_in = ler_entrada(
                f"Número da OS [{numero_os_inicial}]: ", permitir_cancelar=True
            )
            if os_in is None:
                return
            os_in = os_in or numero_os_inicial
        else:
            os_in = ler_entrada("Digite o número da OS (ex: OS-000001): ", permitir_cancelar=True)
            if os_in is None or os_in == "":
                return

        os_obj = OrdemServico.consultar(self.db, os_in)
        if os_obj is None:
            print("Ordem de Serviço não encontrada.")
            pausar()
            return

        if os_obj.status == "Cancelada":
            exibir_erro(f"A {os_obj.numero_os} está Cancelada e não aceita movimentação de peças.")
            pausar()
            return

        print(
            f"\nOS selecionada: {Style.BRIGHT}{os_obj.numero_os}{Style.RESET_ALL} | "
            f"Extintor Nº {os_obj.numero_extintor} | Status: {os_obj.status}"
        )

        while True:
            peca = self._selecionar_peca("\nInforme o código ou nome da peça utilizada: ")
            if peca is None or peca.id is None:
                break

            print(
                f"Peça: [{peca.codigo}] {peca.nome} | "
                f"Estoque disponível: {formatar_numero(peca.quantidade)} {peca.unidade}"
            )
            if peca.quantidade <= 0:
                exibir_erro("Estoque zerado para esta peça! Adicione estoque antes de utilizá-la.")
            else:
                while True:
                    qtd_in = ler_entrada(
                        f"Quantidade utilizada ({peca.unidade}): ",
                        permitir_cancelar=True,
                    )
                    if qtd_in is None:
                        break
                    ok, qtd, msg = validar_decimal_positivo(qtd_in, "Quantidade")
                    if not ok:
                        exibir_erro(msg)
                        continue
                    try:
                        _, msg_ok, alerta = os_obj.adicionar_peca(self.db, peca.id, qtd)
                        exibir_sucesso(msg_ok)
                        if alerta:
                            exibir_aviso("ALERTA: ESTOQUE BAIXO!")
                        break
                    except ValueError as exc:
                        exibir_erro(str(exc))

            cont = ler_entrada("Deseja vincular outra peça a esta OS? (S/N) [N]: ")
            if not cont or cont.strip().upper() not in {"S", "SIM"}:
                break

        pausar()

    # ------------------------------------------------------------------
    # Menu 6: Gerenciar peças e movimentações (Seção 7.4)
    # ------------------------------------------------------------------

    def menu_gerenciar_pecas(self) -> None:
        """Submenu completo de gerenciamento de peças e movimentações."""
        while True:
            exibir_titulo("GERENCIAR PEÇAS E MOVIMENTAÇÕES")
            print("1. Cadastrar peça")
            print("2. Consultar peça")
            print("3. Adicionar quantidade")
            print("4. Retirar quantidade")
            print("5. Editar informações")
            print("6. Consultar estoque baixo")
            print("7. Consultar todas as peças")
            print("8. Histórico de movimentações")
            print("9. Voltar ao menu principal")

            opcao = ler_entrada("\nEscolha uma opção: ")
            if opcao is None:
                return

            if opcao == "1":
                self.cadastrar_peca_interativo()
            elif opcao == "2":
                self.consultar_peca_interativo()
            elif opcao == "3":
                self.adicionar_quantidade_interativo()
            elif opcao == "4":
                self.retirar_quantidade_interativo()
            elif opcao == "5":
                self.editar_peca_interativo()
            elif opcao == "6":
                self.consultar_estoque_baixo_interativo()
            elif opcao == "7":
                self.ver_estoque_pecas()
            elif opcao == "8":
                self.consultar_historico_movimentacoes_interativo()
            elif opcao == "9":
                return
            else:
                exibir_erro("Opção inválida. Escolha de 1 a 9.")
