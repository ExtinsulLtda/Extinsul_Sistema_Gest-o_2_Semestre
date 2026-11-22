"""
Serviço de consultas, pesquisas multicritério e gestão de Ordens de Serviço.
"""

from typing import Any, Dict, List, Optional

from database import DatabaseManager
from models.extintor import Extintor
from models.ordem_servico import OrdemServico
from services.cadastro_service import CadastroService
from services.estoque_service import EstoqueService
from utils.terminal import (
    Fore,
    Style,
    exibir_aviso,
    exibir_erro,
    exibir_info,
    exibir_separador,
    exibir_subtitulo,
    exibir_sucesso,
    exibir_tabela,
    exibir_titulo,
    formatar_numero,
    ler_entrada,
    pausar,
)
from utils.validacoes import (
    STATUS_OS_VALIDOS,
    TIPOS_AGENTE,
    normalizar_numero_os,
    validar_ano_fabricacao,
    validar_data_br,
    validar_tipo_agente,
)


class ConsultaService:
    """Gerencia consultas, pesquisas combinadas, Ordens de Serviço e histórico."""

    def __init__(self, db: DatabaseManager) -> None:
        self.db = db
        self.cadastro_service = CadastroService(db)
        self.estoque_service = EstoqueService(db)

    # ------------------------------------------------------------------
    # Métodos de consulta reutilizáveis (puros / sem I/O)
    # ------------------------------------------------------------------

    def buscar_por_numero(self, numero: str) -> Optional[Extintor]:
        return Extintor.consultar(self.db, numero)

    def buscar_por_os(self, numero_os: str) -> Optional[OrdemServico]:
        return OrdemServico.consultar(self.db, numero_os)

    def buscar_por_cidade(self, cidade: str) -> List[Extintor]:
        termo = f"%{cidade.strip()}%"
        with self.db.conectar() as conn:
            rows = conn.execute(
                "SELECT * FROM extintores WHERE LOWER(cidade) LIKE LOWER(?) ORDER BY numero ASC;",
                (termo,),
            ).fetchall()
            return [Extintor.from_row(r) for r in rows]

    def listar_todos(self) -> List[Extintor]:
        return Extintor.listar_todos(self.db)

    def pesquisar_combinado(
        self,
        numero: Optional[str] = None,
        numero_os: Optional[str] = None,
        cidade: Optional[str] = None,
        fabricante: Optional[str] = None,
        tipo_agente: Optional[str] = None,
        ano_fabricacao: Optional[int] = None,
        ultimo_teste: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Pesquisa extintores combinando múltiplos critérios opcionais.
        Retorna lista de dicionários com dados do extintor e última/respectiva OS.
        """
        filtros: List[str] = []
        params: List[Any] = []

        if numero:
            filtros.append("LOWER(e.numero) LIKE LOWER(?)")
            params.append(f"%{numero.strip()}%")
        if numero_os:
            os_norm = normalizar_numero_os(numero_os)
            filtros.append("UPPER(os.numero_os) LIKE UPPER(?)")
            params.append(f"%{os_norm}%")
        if cidade:
            filtros.append("LOWER(e.cidade) LIKE LOWER(?)")
            params.append(f"%{cidade.strip()}%")
        if fabricante:
            filtros.append("LOWER(e.fabricante) LIKE LOWER(?)")
            params.append(f"%{fabricante.strip()}%")
        if tipo_agente:
            filtros.append("LOWER(e.tipo_agente) = LOWER(?)")
            params.append(tipo_agente.strip())
        if ano_fabricacao is not None:
            filtros.append("e.ano_fabricacao = ?")
            params.append(int(ano_fabricacao))
        if ultimo_teste:
            filtros.append("e.ultimo_teste LIKE ?")
            params.append(f"%{ultimo_teste.strip()}%")

        where = f"WHERE {' AND '.join(filtros)}" if filtros else ""
        sql = f"""
            SELECT
                e.*,
                COALESCE(GROUP_CONCAT(os.numero_os, ', '), 'Sem OS') AS ordens_servico
            FROM extintores e
            LEFT JOIN ordens_servico os ON os.extintor_id = e.id
            {where}
            GROUP BY e.id
            ORDER BY e.id ASC;
        """

        with self.db.conectar() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def obter_historico_extintor(self, numero_extintor: str) -> List[Dict[str, Any]]:
        """Retorna todo o histórico de serviços de um extintor."""
        with self.db.conectar() as conn:
            rows = conn.execute(
                """
                SELECT * FROM historico_servicos
                WHERE LOWER(numero_extintor) = LOWER(?)
                ORDER BY id DESC;
                """,
                (numero_extintor.strip(),),
            ).fetchall()
            return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Exibição detalhada e ações sobre um extintor
    # ------------------------------------------------------------------

    def _exibir_ficha_extintor(self, extintor: Extintor) -> None:
        """Exibe todas as informações técnicas e Ordens de Serviço do extintor."""
        exibir_titulo(f"FICHA DO EXTINTOR Nº {extintor.numero}", 52)
        print(f"Número de identificação : {Style.BRIGHT}{extintor.numero}{Style.RESET_ALL}")
        print(f"Norma técnica           : {extintor.norma}")
        print(f"Fabricante              : {extintor.fabricante}")
        print(f"Ano de fabricação       : {extintor.ano_fabricacao}")
        print(f"Último teste realizado  : {extintor.ultimo_teste}")
        print(
            f"Pressão de trabalho     : {formatar_numero(extintor.pressao_trabalho)} {extintor.unidade_pressao}"
        )
        print(f"Tipo de agente extintor : {extintor.tipo_agente}")
        print(
            f"Capacidade / Peso       : {formatar_numero(extintor.capacidade)} {extintor.unidade}"
        )
        print(f"Cidade                  : {extintor.cidade}")
        print(f"Observações             : {extintor.observacoes or 'Nenhuma'}")
        print(f"Data de cadastro        : {extintor.data_cadastro}")

        if extintor.id is not None:
            ordens = OrdemServico.listar_por_extintor(self.db, extintor.id)
            exibir_subtitulo("Ordens de Serviço vinculadas", 52)
            if ordens:
                linhas = [
                    [o.numero_os, o.data_criacao, o.status, o.observacoes]
                    for o in ordens
                ]
                exibir_tabela(linhas, ["Nº OS", "Data Criação", "Status", "Observações"])
            else:
                exibir_info("Nenhuma Ordem de Serviço vinculada.")

    def _acoes_extintor(self, extintor: Extintor) -> None:
        """Exibe a ficha e permite editar, ver histórico, abrir OS/vincular peças ou excluir."""
        atual: Optional[Extintor] = extintor
        while atual is not None:
            self._exibir_ficha_extintor(atual)
            print(
                f"\n{Fore.CYAN}Ações:{Style.RESET_ALL} "
                "[E] Editar | [H] Histórico | [N] Nova OS | [P] Vincular peças a OS | [X] Excluir | [Enter] Voltar"
            )
            acao = ler_entrada("Escolha uma ação: ")
            if acao is None or acao == "":
                break

            cmd = acao.strip().upper()
            if cmd == "E":
                editado = self.cadastro_service.editar_extintor_interativo(atual)
                if editado is not None:
                    atual = editado
            elif cmd == "H":
                self._exibir_historico_extintor(atual.numero)
            elif cmd == "N":
                nova_os = self.cadastro_service.registrar_nova_os_interativo(atual)
                if nova_os is not None:
                    pausar()
            elif cmd == "P":
                ordens = (
                    OrdemServico.listar_por_extintor(self.db, atual.id)
                    if atual.id is not None
                    else []
                )
                sugestao = ordens[0].numero_os if ordens else None
                self.estoque_service.vincular_peca_a_os_interativo(sugestao)
            elif cmd == "X":
                if self.cadastro_service.excluir_extintor_interativo(atual):
                    break
            else:
                exibir_erro("Ação inválida.")

    def _exibir_historico_extintor(self, numero_extintor: str) -> None:
        """Exibe o histórico de serviços de um extintor."""
        exibir_titulo(f"HISTÓRICO DE SERVIÇOS - EXTINTOR {numero_extintor}", 60)
        historico = self.obter_historico_extintor(numero_extintor)
        linhas = [
            [
                h["data_servico"],
                h["numero_os"],
                h["tipo_servico"],
                h["pecas_utilizadas"] or "Nenhuma",
                h["observacoes"] or "-",
            ]
            for h in historico
        ]
        exibir_tabela(
            linhas,
            ["Data", "Ordem de Serviço", "Tipo de Serviço", "Peças Utilizadas", "Observações"],
            mensagem_vazia="Nenhum registro de serviço encontrado para este extintor.",
        )
        pausar()

    def _exibir_lista_extintores_com_selecao(
        self,
        extintores: List[Extintor],
        titulo: str,
        mensagem_vazia: str = "Nenhum extintor encontrado.",
    ) -> None:
        """Mostra uma tabela resumida de extintores e permite abrir a ficha de um deles."""
        exibir_titulo(titulo, 64)
        if not extintores:
            exibir_aviso(mensagem_vazia)
            pausar()
            return

        with self.db.conectar() as conn:
            linhas = []
            for ext in extintores:
                os_rows = conn.execute(
                    "SELECT numero_os FROM ordens_servico WHERE extintor_id = ? ORDER BY id ASC;",
                    (ext.id,),
                ).fetchall()
                lista_os = ", ".join(r["numero_os"] for r in os_rows) if os_rows else "-"
                linhas.append(
                    [
                        ext.numero,
                        ext.tipo_agente,
                        f"{formatar_numero(ext.capacidade)} {ext.unidade}",
                        ext.fabricante,
                        ext.ano_fabricacao,
                        ext.ultimo_teste,
                        ext.cidade,
                        lista_os,
                    ]
                )

        exibir_tabela(
            linhas,
            [
                "Número",
                "Tipo",
                "Capacidade",
                "Fabricante",
                "Ano",
                "Último Teste",
                "Cidade",
                "Ordens de Serviço",
            ],
        )
        print(f"Total encontrado: {len(extintores)} extintor(es).")
        sel = ler_entrada(
            "\nDigite o número do extintor para ver ficha completa (ou Enter para voltar): "
        )
        if sel:
            encontrado = self.buscar_por_numero(sel)
            if encontrado is not None:
                self._acoes_extintor(encontrado)
            else:
                exibir_erro(f"Extintor '{sel}' não encontrado.")
                pausar()

    # ------------------------------------------------------------------
    # Menu 2: Consultar extintor (Seção 5)
    # ------------------------------------------------------------------

    def menu_consultar_extintor(self) -> None:
        """Submenu de consulta de extintores conforme especificação da Seção 5."""
        while True:
            exibir_titulo("CONSULTAR EXTINTOR")
            print("1. Consultar por número do extintor")
            print("2. Consultar por Ordem de Serviço")
            print("3. Consultar por cidade")
            print("4. Consultar todos os extintores")
            print("5. Voltar ao menu principal")

            opcao = ler_entrada("\nEscolha uma opção: ")
            if opcao is None:
                return

            if opcao == "1":
                num = ler_entrada("Digite o número do extintor: ")
                if not num:
                    exibir_erro("Número do extintor não informado.")
                    pausar()
                    continue
                ext = self.buscar_por_numero(num)
                if ext is None:
                    exibir_erro(f"Extintor '{num}' não encontrado.")
                    pausar()
                else:
                    self._acoes_extintor(ext)

            elif opcao == "2":
                os_in = ler_entrada("Digite o número da OS: ")
                if not os_in:
                    exibir_erro("Número da OS não informado.")
                    pausar()
                    continue
                os_obj = self.buscar_por_os(os_in)
                if os_obj is None:
                    print("Ordem de Serviço não encontrada.")
                    pausar()
                elif os_obj.extintor is None:
                    exibir_aviso(
                        f"A {os_obj.numero_os} foi localizada (Extintor Nº {os_obj.numero_extintor}), "
                        "porém o cadastro do extintor foi excluído."
                    )
                    self._exibir_detalhes_os(os_obj)
                    pausar()
                else:
                    self._acoes_extintor(os_obj.extintor)

            elif opcao == "3":
                while True:
                    cidade = ler_entrada("Digite a cidade: ")
                    if not cidade:
                        exibir_erro("Cidade não informada.")
                        pausar()
                        break
                    resultados = self.buscar_por_cidade(cidade)
                    self._exibir_lista_extintores_com_selecao(
                        resultados,
                        f"EXTINTORES NA CIDADE: {cidade.upper()}",
                        mensagem_vazia=f"Nenhum extintor cadastrado na cidade '{cidade}'.",
                    )
                    outra = ler_entrada("Deseja consultar outra cidade? (S/N) [N]: ")
                    if not outra or outra.strip().upper() not in {"S", "SIM"}:
                        break

            elif opcao == "4":
                todos = self.listar_todos()
                self._exibir_lista_extintores_com_selecao(
                    todos,
                    "TODOS OS EXTINTORES CADASTRADOS",
                    mensagem_vazia="Nenhum extintor cadastrado até o momento.",
                )

            elif opcao == "5":
                return
            else:
                exibir_erro("Opção inválida. Escolha de 1 a 5.")

    # ------------------------------------------------------------------
    # Menu 4: Pesquisar extintor multicritério (Seção 6)
    # ------------------------------------------------------------------

    def pesquisar_extintores_interativo(self) -> None:
        """Pesquisa equipamentos combinando quaisquer critérios informados."""
        exibir_titulo("PESQUISAR EXTINTOR (CRITÉRIOS COMBINADOS)")
        exibir_info("Preencha os critérios desejados ou pressione Enter para ignorar o filtro.\n")

        numero = ler_entrada("Número de identificação: ", permitir_cancelar=True)
        if numero is None:
            return
        numero_os = ler_entrada("Ordem de Serviço (ex: OS-000001): ", permitir_cancelar=True)
        if numero_os is None:
            return
        cidade = ler_entrada("Cidade: ", permitir_cancelar=True)
        if cidade is None:
            return
        fabricante = ler_entrada("Fabricante: ", permitir_cancelar=True)
        if fabricante is None:
            return

        print("Tipo de agente (1. Água | 2. Pó ABC | 3. Pó BC | 4. CO2 | Enter para todos):")
        tipo_agente = ""
        while True:
            t_in = ler_entrada("Tipo de agente: ", permitir_cancelar=True)
            if t_in is None:
                return
            if t_in == "":
                break
            ok, tipo_agente, msg = validar_tipo_agente(t_in)
            if ok:
                break
            exibir_erro(msg)

        ano_fab: Optional[int] = None
        while True:
            ano_in = ler_entrada("Ano de fabricação (AAAA): ", permitir_cancelar=True)
            if ano_in is None:
                return
            if ano_in == "":
                break
            ok, ano_fab, msg = validar_ano_fabricacao(ano_in)
            if ok:
                break
            exibir_erro(msg)

        ultimo_teste = ""
        while True:
            dt_in = ler_entrada("Data do último teste (DD/MM/AAAA): ", permitir_cancelar=True)
            if dt_in is None:
                return
            if dt_in == "":
                break
            ok, ultimo_teste, msg = validar_data_br(dt_in)
            if ok:
                break
            exibir_erro(msg)

        resultados = self.pesquisar_combinado(
            numero=numero or None,
            numero_os=numero_os or None,
            cidade=cidade or None,
            fabricante=fabricante or None,
            tipo_agente=tipo_agente or None,
            ano_fabricacao=ano_fab,
            ultimo_teste=ultimo_teste or None,
        )

        exibir_titulo("RESULTADO DA PESQUISA", 64)
        linhas = [
            [
                r["numero"],
                r["ordens_servico"],
                r["tipo_agente"],
                f"{formatar_numero(r['capacidade'])} {r['unidade']}",
                r["fabricante"],
                r["ano_fabricacao"],
                r["ultimo_teste"],
                r["cidade"],
            ]
            for r in resultados
        ]
        exibir_tabela(
            linhas,
            [
                "Número",
                "OS",
                "Tipo",
                "Capacidade",
                "Fabricante",
                "Ano",
                "Último Teste",
                "Cidade",
            ],
            mensagem_vazia="Nenhum extintor corresponde aos critérios informados.",
        )

        if resultados:
            print(f"Total encontrado: {len(resultados)} equipamento(s).")
            sel = ler_entrada(
                "\nDigite o número do extintor para abrir ficha detalhada (ou Enter para voltar): "
            )
            if sel:
                ext = self.buscar_por_numero(sel)
                if ext is not None:
                    self._acoes_extintor(ext)
                else:
                    exibir_erro("Extintor não encontrado.")
                    pausar()
        else:
            pausar()

    # ------------------------------------------------------------------
    # Menu 5: Consultar Ordens de Serviço (Seções 4, 8 e 9)
    # ------------------------------------------------------------------

    def _exibir_detalhes_os(self, os_obj: OrdemServico) -> None:
        """Mostra dados completos da OS, equipamento e peças utilizadas."""
        exibir_titulo(f"ORDEM DE SERVIÇO: {os_obj.numero_os}", 56)
        print(f"Número da OS       : {Style.BRIGHT}{os_obj.numero_os}{Style.RESET_ALL}")
        print(f"Data de criação    : {os_obj.data_criacao}")
        print(f"Status             : {os_obj.status}")
        print(f"Extintor Nº        : {os_obj.numero_extintor}")
        print(f"Observações        : {os_obj.observacoes or 'Nenhuma'}")

        if os_obj.extintor is not None:
            e = os_obj.extintor
            print(
                f"Dados do Extintor  : {e.tipo_agente} | "
                f"{formatar_numero(e.capacidade)} {e.unidade} | "
                f"Fab: {e.fabricante} | Cidade: {e.cidade}"
            )
        else:
            exibir_aviso("Equipamento associado não está mais no cadastro ativo.")

        exibir_subtitulo("Peças utilizadas nesta OS", 56)
        linhas_pecas = [
            [
                p["codigo_peca"],
                p["nome_peca"],
                formatar_numero(p["quantidade"]),
                p["unidade"],
                p["data_registro"],
            ]
            for p in os_obj.pecas_utilizadas
        ]
        exibir_tabela(
            linhas_pecas,
            ["Código", "Peça", "Qtd", "Unidade", "Data Registro"],
            mensagem_vazia="Nenhuma peça vinculada a esta Ordem de Serviço.",
        )

    def _atualizar_status_os_interativo(self) -> None:
        os_in = ler_entrada("Digite o número da OS (ex: OS-000001): ")
        if not os_in:
            return
        os_obj = self.buscar_por_os(os_in)
        if os_obj is None:
            print("Ordem de Serviço não encontrada.")
            pausar()
            return

        print(f"\nStatus atual da {os_obj.numero_os}: {os_obj.status}")
        for idx, st in enumerate(STATUS_OS_VALIDOS, start=1):
            print(f"  {idx}. {st}")

        escolha = ler_entrada("Escolha o novo status (1-4): ")
        if not escolha or escolha not in {"1", "2", "3", "4"}:
            exibir_erro("Opção de status inválida.")
            pausar()
            return

        novo_status = STATUS_OS_VALIDOS[int(escolha) - 1]
        try:
            os_obj.atualizar_status(self.db, novo_status)
            exibir_sucesso(f"Status da {os_obj.numero_os} atualizado para '{novo_status}'.")
        except ValueError as exc:
            exibir_erro(str(exc))
        pausar()

    def menu_ordens_servico(self) -> None:
        """Menu completo de consulta e operação de Ordens de Serviço e histórico."""
        while True:
            exibir_titulo("CONSULTAR ORDENS DE SERVIÇO")
            print("1. Consultar OS por número")
            print("2. Listar todas as Ordens de Serviço")
            print("3. Vincular peças utilizadas à OS")
            print("4. Atualizar status da OS")
            print("5. Gerar nova OS para extintor existente")
            print("6. Consultar histórico de serviços por extintor")
            print("7. Voltar ao menu principal")

            opcao = ler_entrada("\nEscolha uma opção: ")
            if opcao is None:
                return

            if opcao == "1":
                os_in = ler_entrada("Digite o número da OS: ")
                if not os_in:
                    exibir_erro("Número da OS não informado.")
                    pausar()
                    continue
                os_obj = self.buscar_por_os(os_in)
                if os_obj is None:
                    print("Ordem de Serviço não encontrada.")
                    pausar()
                else:
                    self._exibir_detalhes_os(os_obj)
                    pausar()

            elif opcao == "2":
                todas = OrdemServico.listar_todas(self.db)
                exibir_titulo("TODAS AS ORDENS DE SERVIÇO", 64)
                with self.db.conectar() as conn:
                    linhas = []
                    for o in todas:
                        cnt = conn.execute(
                            "SELECT COUNT(*) AS total FROM pecas_ordem_servico WHERE ordem_servico_id = ?;",
                            (o.id,),
                        ).fetchone()["total"]
                        linhas.append(
                            [
                                o.numero_os,
                                o.numero_extintor,
                                o.data_criacao,
                                o.status,
                                cnt,
                            ]
                        )
                exibir_tabela(
                    linhas,
                    ["Nº OS", "Extintor", "Data Criação", "Status", "Qtd Itens/Peças"],
                    mensagem_vazia="Nenhuma Ordem de Serviço gerada até o momento.",
                )
                pausar()

            elif opcao == "3":
                self.estoque_service.vincular_peca_a_os_interativo()

            elif opcao == "4":
                self._atualizar_status_os_interativo()

            elif opcao == "5":
                num = ler_entrada("Digite o número do extintor: ")
                if not num:
                    continue
                ext = self.buscar_por_numero(num)
                if ext is None:
                    exibir_erro(f"Extintor '{num}' não encontrado.")
                    pausar()
                    continue
                nova = self.cadastro_service.registrar_nova_os_interativo(ext)
                if nova is not None:
                    if ler_entrada("Deseja vincular peças a esta OS agora? (S/N) [N]: ") in {
                        "S",
                        "s",
                        "SIM",
                        "sim",
                    }:
                        self.estoque_service.vincular_peca_a_os_interativo(nova.numero_os)
                    else:
                        pausar()

            elif opcao == "6":
                num = ler_entrada("Digite o número do extintor: ")
                if not num:
                    continue
                self._exibir_historico_extintor(num)

            elif opcao == "7":
                return
            else:
                exibir_erro("Opção inválida. Escolha de 1 a 7.")
