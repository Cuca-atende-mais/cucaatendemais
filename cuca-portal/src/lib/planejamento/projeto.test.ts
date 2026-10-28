import { describe, expect, it } from "vitest"
import {
    bloco2026Visivel, camposDaSituacao, dataNoAno, errosDeValidacao, fichaAposGravacao, formDeLinha, formVazio,
    mensagemObrigatorios, mostrarSalvarProjeto, nomePadraoResponsavel, mostrarSeloFichaEmConstrucao, obrigatoriosFaltando, payloadDoForm,
    percentualPreenchido, primeiraSecaoIncompleta, secoesVisiveis, statusAposGravacao, sugerirDuracao,
    textoBRParaNumero, totalLinhaOrcamento, totalOrcamento, STATUS_MANUAIS,
    type FormProjeto, type LinhaProjeto,
} from "./projeto"

function formCompleto(over: Partial<FormProjeto> = {}): FormProjeto {
    return {
        ...formVazio(),
        nome: "Copa Cuca", tipo: "evento_pontual", setor_id: "esportes",
        responsavel_nome: "Ana", responsavel_contato: "85999990000",
        situacao_2026: "mantem",
        objetivo_geral: "Integrar", objetivos: ["Jogar"], publico_alvo: "Jovens",
        faixa_etaria_min: "15", faixa_etaria_max: "29", participantes_estimados: "80",
        periodo_ano_todo: false, data_inicio: "2027-03-01", data_fim: "2027-05-31", duracao: "3 meses",
        frequencia: "semanal", dias_horarios: "Sábados", locais_unidades: ["u1"], como_sera_realizado: "Etapas",
        orcamento: [{ item: "Bola", categoria: "material", quantidade: "2", valor_unitario: "10,50" }],
        metas: [{ meta: "Atender", indicador: "Inscritos", resultado_esperado: "80" }],
        resultados_2026_participantes: "70", resultados_2026_principais: "Bom",
        resultados_2026_funcionou: "Divulgação", resultados_2026_melhorar: "Horário",
        observacoes: "Nada",
        ...over,
    }
}

describe("orçamento", () => {
    it("lê números no formato brasileiro", () => {
        expect(textoBRParaNumero("1.234,56")).toBe(1234.56)
        expect(textoBRParaNumero("10,5")).toBe(10.5)
        expect(textoBRParaNumero("3")).toBe(3)
        expect(textoBRParaNumero("")).toBeNull()
        expect(textoBRParaNumero("abc")).toBeNaN()
        expect(textoBRParaNumero(",")).toBeNaN()
    })

    it("ponto sem vírgula: milhar só no formato 1.000, senão decimal", () => {
        expect(textoBRParaNumero("1.000")).toBe(1000)
        expect(textoBRParaNumero("12.500.000")).toBe(12500000)
        expect(textoBRParaNumero("10.50")).toBe(10.5)
        expect(textoBRParaNumero("1.5")).toBe(1.5)
        expect(textoBRParaNumero("1.2.3")).toBeNaN()
    })

    it("total da linha e total geral, ignorando linhas incompletas", () => {
        expect(totalLinhaOrcamento({ item: "Bola", categoria: "material", quantidade: "2", valor_unitario: "10,50" })).toBe(21)
        expect(totalLinhaOrcamento({ item: "x", categoria: "", quantidade: "", valor_unitario: "10" })).toBe(0)
        expect(totalOrcamento([
            { item: "a", categoria: "", quantidade: "3", valor_unitario: "1.000,10" },
            { item: "b", categoria: "", quantidade: "1,5", valor_unitario: "2" },
            { item: "c", categoria: "", quantidade: "x", valor_unitario: "2" },
        ])).toBe(3003.3)
    })

    it("o corpo enviado ao banco leva números com ponto decimal", () => {
        const p = payloadDoForm(formCompleto()) as { orcamento: { valor_unitario: string }[]; objetivos: { texto: string }[] }
        expect(p.orcamento[0].valor_unitario).toBe("10.5")
        expect(p.objetivos).toEqual([{ texto: "Jogar" }])
    })

    it("com 'Ano todo', o corpo não leva datas", () => {
        const p = payloadDoForm(formCompleto({ periodo_ano_todo: true })) as { data_inicio: string; data_fim: string }
        expect(p.data_inicio).toBe("")
        expect(p.data_fim).toBe("")
    })
})

describe("campos que somem", () => {
    it("Encerrado esconde as seções 3 a 6", () => {
        expect(secoesVisiveis("encerrado")).toEqual([1, 2, 7])
        expect(secoesVisiveis("novo")).toEqual([1, 2, 3, 4, 5, 6, 7])
        expect(secoesVisiveis("")).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it("o bloco de 2026 some só com Novo", () => {
        expect(bloco2026Visivel("novo")).toBe(false)
        expect(bloco2026Visivel("mantem")).toBe(true)
        expect(bloco2026Visivel("encerrado")).toBe(true)
    })

    it("campos de mudança por situação", () => {
        expect(camposDaSituacao("mantem")).toMatchObject({ mudancas: false, justificativa: false })
        expect(camposDaSituacao("mantem_ajustes")).toMatchObject({ mudancas: true, justificativa: true })
        expect(camposDaSituacao("novo")).toEqual({ mudancas: false, justificativa: true, rotuloJustificativa: "Por que criar" })
        expect(camposDaSituacao("encerrado")).toEqual({ mudancas: false, justificativa: true, rotuloJustificativa: "Por que encerra" })
    })
})

describe("percentual de preenchimento", () => {
    it("ficha completa = 100%", () => {
        expect(percentualPreenchido(formCompleto())).toBe(100)
        expect(primeiraSecaoIncompleta(formCompleto())).toBeNull()
    })

    it("ficha vazia = 0%, e a primeira seção incompleta é a 1", () => {
        expect(percentualPreenchido(formVazio())).toBe(0)
        expect(primeiraSecaoIncompleta(formVazio())).toBe(1)
    })

    it("campos escondidos não contam: Encerrado com só as seções 1, 2 e 7 preenchidas = 100%", () => {
        const f = formCompleto({
            situacao_2026: "encerrado", justificativa_2026: "Acabou o recurso",
            objetivo_geral: "", objetivos: [], orcamento: [], metas: [], frequencia: "",
        })
        expect(percentualPreenchido(f)).toBe(100)
    })

    it("Novo não cobra o bloco de 2026", () => {
        const f = formCompleto({
            situacao_2026: "novo", justificativa_2026: "Demanda nova",
            resultados_2026_participantes: "", resultados_2026_principais: "", resultados_2026_funcionou: "", resultados_2026_melhorar: "",
        })
        expect(percentualPreenchido(f)).toBe(100)
    })

    it("Mantém com ajustes passa a cobrar mudanças e justificativa", () => {
        const f = formCompleto({ situacao_2026: "mantem_ajustes" })
        expect(percentualPreenchido(f)).toBeLessThan(100)
        expect(primeiraSecaoIncompleta(f)).toBe(2)
    })

    it("frequência 'Outra' cobra o texto", () => {
        const f = formCompleto({ frequencia: "outra" })
        expect(primeiraSecaoIncompleta(f)).toBe(4)
        expect(percentualPreenchido({ ...f, frequencia_outra: "A cada 3 semanas" })).toBe(100)
    })

    it("o tipo não muda os campos cobrados", () => {
        for (const tipo of ["evento_pontual", "atividade_continua", "projeto"] as const) {
            expect(percentualPreenchido(formCompleto({ tipo }))).toBe(100)
        }
    })
})

describe("datas e números", () => {
    it("só aceita datas de 2027", () => {
        expect(dataNoAno("2027-01-01")).toBe(true)
        expect(dataNoAno("2027-12-31")).toBe(true)
        expect(dataNoAno("2026-12-31")).toBe(false)
        expect(dataNoAno("2028-01-01")).toBe(false)
        expect(dataNoAno("2027-02-30")).toBe(false)
    })

    it("fim antes do início é erro; com 'Ano todo' as datas não contam", () => {
        const f = formCompleto({ data_inicio: "2027-05-10", data_fim: "2027-05-01" })
        expect(errosDeValidacao(f).map(e => e.campo)).toEqual(["data_fim"])
        expect(errosDeValidacao({ ...f, periodo_ano_todo: true })).toEqual([])
        expect(errosDeValidacao(formCompleto({ data_inicio: "2026-05-10" })).map(e => e.campo)).toEqual(["data_inicio"])
    })

    it("faixa etária: o 'de' não pode ser maior que o 'até'", () => {
        expect(errosDeValidacao(formCompleto({ faixa_etaria_min: "30", faixa_etaria_max: "15" })).map(e => e.campo)).toEqual(["faixa_etaria_min"])
    })

    it("participantes: inteiro ≥ 0", () => {
        expect(errosDeValidacao(formCompleto({ participantes_estimados: "-1" }))).toHaveLength(1)
        expect(errosDeValidacao(formCompleto({ participantes_estimados: "2,5" }))).toHaveLength(1)
        expect(errosDeValidacao(formCompleto({ participantes_estimados: "" }))).toEqual([])
    })

    it("números acima do que o banco aceita viram aviso claro antes de gravar", () => {
        expect(errosDeValidacao(formCompleto({ participantes_estimados: "2147483647" }))).toEqual([])
        expect(errosDeValidacao(formCompleto({ participantes_estimados: "2147483648" })).map(e => e.mensagem))
            .toEqual(["Nº estimado de participantes: número alto demais. Confira o valor digitado."])
        expect(errosDeValidacao(formCompleto({ resultados_2026_participantes: "99999999999" }))).toHaveLength(1)

        const linha = (quantidade: string, valor_unitario: string) => formCompleto({ orcamento: [{ item: "x", categoria: "", quantidade, valor_unitario }] })
        expect(errosDeValidacao(linha("1", "9.999.999.999,99"))).toEqual([])
        expect(errosDeValidacao(linha("1", "10.000.000.000,00")).map(e => e.campo)).toEqual(["orcamento.0.valor_unitario"])
        expect(errosDeValidacao(linha("10.000.000.000", "1")).map(e => e.campo)).toEqual(["orcamento.0.quantidade"])
        expect(errosDeValidacao(linha("1.000.000", "1.000.000,00")).map(e => e.mensagem))
            .toEqual(["Orçamento, linha 1: valor total alto demais. Confira quantidade e valor unitário."])
        expect(errosDeValidacao(linha("1.000", "999.999.999,99"))).toEqual([])
    })

    it("duração sugerida a partir das datas", () => {
        expect(sugerirDuracao("2027-03-01", "2027-03-01", false)).toBe("1 dia")
        expect(sugerirDuracao("2027-03-01", "2027-03-05", false)).toBe("5 dias")
        expect(sugerirDuracao("2027-03-01", "2027-03-21", false)).toBe("3 semanas")
        expect(sugerirDuracao("2027-03-01", "2027-05-31", false)).toBe("3 meses")
        expect(sugerirDuracao("2027-01-01", "2027-12-31", false)).toBe("12 meses")
        expect(sugerirDuracao("", "", true)).toBe("Ano todo")
        expect(sugerirDuracao("2027-05-01", "2027-03-01", false)).toBe("")
    })
})

describe("responsável padrão", () => {
    it("nome do colaborador; sem cadastro (contas Developer), o e-mail de login", () => {
        expect(nomePadraoResponsavel("Ana Souza", "ana@x.com")).toBe("Ana Souza")
        expect(nomePadraoResponsavel(null, "dev.cucaatendemais@gmail.com")).toBe("dev.cucaatendemais@gmail.com")
        expect(nomePadraoResponsavel("  ", "valmir@cucateste.com")).toBe("valmir@cucateste.com")
        expect(nomePadraoResponsavel(undefined, undefined)).toBe("")
    })
})

describe("obrigatórios e botão Salvar projeto", () => {
    it("nome, tipo e setor são os únicos obrigatórios", () => {
        expect(obrigatoriosFaltando(formVazio())).toEqual(["nome do projeto", "tipo", "setor"])
        expect(obrigatoriosFaltando(formVazio({ setor_id: "cultura" }))).toEqual(["nome do projeto", "tipo"])
        expect(obrigatoriosFaltando({ ...formVazio({ setor_id: "cultura" }), nome: "X", tipo: "projeto" })).toEqual([])
        expect(mensagemObrigatorios(["nome do projeto", "tipo"])).toBe("Falta preencher: nome do projeto e tipo.")
        expect(mensagemObrigatorios([])).toBeNull()
    })

    it("aparece com os obrigatórios ou ao chegar na última seção, e não some depois", () => {
        expect(mostrarSalvarProjeto({ obrigatoriosOk: false, chegouUltimaSecao: false, jaMostrado: false })).toBe(false)
        expect(mostrarSalvarProjeto({ obrigatoriosOk: true, chegouUltimaSecao: false, jaMostrado: false })).toBe(true)
        expect(mostrarSalvarProjeto({ obrigatoriosOk: false, chegouUltimaSecao: true, jaMostrado: false })).toBe(true)
        expect(mostrarSalvarProjeto({ obrigatoriosOk: false, chegouUltimaSecao: false, jaMostrado: true })).toBe(true)
    })
})

describe("regra de status dos botões (AC9)", () => {
    it("projeto novo nasce Em construção (parcial ou caixa de saída) ou Projeto salvo", () => {
        expect(statusAposGravacao(null, "parcial")).toBe("em_construcao")
        expect(statusAposGravacao(null, "manter")).toBe("em_construcao")
        expect(statusAposGravacao(null, "final")).toBe("projeto_salvo")
        expect(fichaAposGravacao(null, "manter")).toBe("parcial")
    })

    it("os dois status dos botões acompanham o botão", () => {
        expect(statusAposGravacao("em_construcao", "final")).toBe("projeto_salvo")
        expect(statusAposGravacao("projeto_salvo", "parcial")).toBe("em_construcao")
        expect(statusAposGravacao("projeto_salvo", "manter")).toBe("projeto_salvo")
        expect(statusAposGravacao("em_construcao", "manter")).toBe("em_construcao")
    })

    it("os quatro status manuais nunca mudam pelos botões", () => {
        for (const s of STATUS_MANUAIS) {
            for (const modo of ["parcial", "final", "manter"] as const) {
                expect(statusAposGravacao(s, modo)).toBe(s)
            }
        }
    })

    it("a ficha acompanha o botão; a caixa de saída mantém", () => {
        expect(fichaAposGravacao("final", "parcial")).toBe("parcial")
        expect(fichaAposGravacao("parcial", "final")).toBe("final")
        expect(fichaAposGravacao("final", "manter")).toBe("final")
        expect(fichaAposGravacao("parcial", "manter")).toBe("parcial")
    })

    it("selo 'Ficha em construção' só para status manual com ficha parcial", () => {
        expect(mostrarSeloFichaEmConstrucao("aprovado", "parcial")).toBe(true)
        expect(mostrarSeloFichaEmConstrucao("aprovado", "final")).toBe(false)
        expect(mostrarSeloFichaEmConstrucao("em_construcao", "parcial")).toBe(false)
    })
})

describe("formDeLinha", () => {
    it("monta o formulário a partir do banco, com listas na ordem e dinheiro com vírgula", () => {
        const linha = {
            id: "p1", ano: 2027, nome: "X", tipo: "projeto", setor_id: "cultura",
            responsavel_nome: null, responsavel_contato: null, situacao_2026: null, mudancas_2026: null, justificativa_2026: null,
            objetivo_geral: null, publico_alvo: null, faixa_etaria_min: 15, faixa_etaria_max: null, participantes_estimados: 0,
            periodo_ano_todo: false, data_inicio: "2027-02-01", data_fim: null, duracao: null, frequencia: null, frequencia_outra: null,
            dias_horarios: null, locais_unidades: null, local_outro: false, local_outro_texto: null, como_sera_realizado: null,
            resultados_2026_participantes: null, resultados_2026_principais: null, resultados_2026_funcionou: null,
            resultados_2026_melhorar: null, observacoes: null, status: "em_construcao", ficha: "parcial",
            criado_por_nome: null, atualizado_por_nome: null, created_at: "", updated_at: "",
        } satisfies LinhaProjeto
        const f = formDeLinha(linha, {
            objetivos: [{ ordem: 2, texto: "B" }, { ordem: 1, texto: "A" }],
            orcamento: [{ ordem: 1, item: "Bola", categoria: "material", quantidade: "2.00", valor_unitario: "10.5" }],
            metas: [],
        })
        expect(f.objetivos).toEqual(["A", "B"])
        expect(f.orcamento[0]).toEqual({ item: "Bola", categoria: "material", quantidade: "2", valor_unitario: "10,50" })
        expect(f.faixa_etaria_min).toBe("15")
        expect(f.participantes_estimados).toBe("0")
        expect(f.locais_unidades).toEqual([])
    })
})
