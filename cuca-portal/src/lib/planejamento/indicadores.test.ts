import { readFileSync } from "node:fs"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import {
    LIMITE_LISTA_CURTA, SEM_CATEGORIA, SEM_SITUACAO, agregarIndicadores, aplicarFiltrosIndicadores, filtrosIndicadoresDaUrl,
    filtrosIndicadoresParaUrl, lerProjetoIndicador, linkCelula, linkLista, montarAbasIndicadores, nivelCalor, nomeArquivoIndicadores,
    type ProjetoIndicador,
} from "./indicadores"
import { gerarXlsxIndicadores } from "./gerar-xlsx-indicadores"

const SETORES = ["direitos_humanos", "empregabilidade", "cultura", "artes_biblioteca", "educacao_tecnologia", "esportes"]

let seq = 0
function projeto(p: Partial<ProjetoIndicador> = {}): ProjetoIndicador {
    seq += 1
    return {
        id: `p${seq}`, nome: `Projeto ${seq}`, setor_id: "cultura", tipo: "projeto", status: "em_construcao", situacao_2026: "novo",
        periodo_ano_todo: false, data_inicio: null, data_fim: null, participantes_estimados: null, responsavel_nome: null,
        orcamento_total: 0, orcamento_categorias: {}, correcoes_abertas: 0, validado: false, ...p,
    }
}
const params = (q: string) => new URLSearchParams(q)

describe("lerProjetoIndicador", () => {
    it("converte números do banco e trata ausentes", () => {
        const p = lerProjetoIndicador({
            id: "a", nome: "X", setor_id: "cultura", tipo: "projeto", status: "aprovado", situacao_2026: null,
            periodo_ano_todo: false, data_inicio: "2027-03-01", data_fim: null, participantes_estimados: null,
            orcamento_total: "1500.50", orcamento_categorias: { material: "1000.5", sem_categoria: 500 }, correcoes_abertas: "2", validado: true,
        })
        expect(p.orcamento_total).toBe(1500.5)
        expect(p.orcamento_categorias).toEqual({ material: 1000.5, sem_categoria: 500 })
        expect(p.correcoes_abertas).toBe(2)
        expect(p.participantes_estimados).toBeNull()
        expect(p.responsavel_nome).toBeNull()
        expect(p.data_inicio).toBe("2027-03-01")
        expect(p.data_fim).toBeNull()
    })
})

describe("filtros do painel (AC8)", () => {
    it("ida e volta pelo endereço; valor desconhecido vira sem filtro", () => {
        const f = filtrosIndicadoresDaUrl(params("setor=cultura&status=aprovado&situacao=novo&tipo=projeto"), SETORES)
        expect(f).toEqual({ setor: "cultura", status: "aprovado", situacao: "novo", tipo: "projeto" })
        expect(filtrosIndicadoresParaUrl(f)).toBe("setor=cultura&status=aprovado&situacao=novo&tipo=projeto")
        expect(filtrosIndicadoresDaUrl(params("status=xx&situacao=yy&tipo=zz"), SETORES)).toEqual({ setor: "", status: "", situacao: "", tipo: "" })
    })

    it("setor fora do escopo nunca entra (não amplia)", () => {
        expect(filtrosIndicadoresDaUrl(params("setor=esportes"), ["cultura"]).setor).toBe("")
        expect(filtrosIndicadoresDaUrl(params("setor=esportes"), []).setor).toBe("")
    })

    it("todos os filtros valem juntos", () => {
        const lista = [
            projeto({ setor_id: "cultura", status: "aprovado", situacao_2026: "novo", tipo: "projeto" }),
            projeto({ setor_id: "cultura", status: "aprovado", situacao_2026: "mantem", tipo: "projeto" }),
            projeto({ setor_id: "esportes", status: "aprovado", situacao_2026: "novo", tipo: "projeto" }),
            projeto({ setor_id: "cultura", status: "reprovado", situacao_2026: "novo", tipo: "projeto" }),
            projeto({ setor_id: "cultura", status: "aprovado", situacao_2026: "novo", tipo: "evento_pontual" }),
        ]
        const r = aplicarFiltrosIndicadores(lista, { setor: "cultura", status: "aprovado", situacao: "novo", tipo: "projeto" })
        expect(r.map(p => p.id)).toEqual([lista[0].id])
    })
})

describe("agregarIndicadores", () => {
    const lista = [
        projeto({ setor_id: "cultura", status: "aprovado", situacao_2026: "mantem", participantes_estimados: 100,
            orcamento_total: 1000.1, orcamento_categorias: { material: 600.05, espaco: 400.05 }, data_inicio: "2027-02-10", data_fim: "2027-04-20" }),
        projeto({ setor_id: "cultura", status: "em_execucao", situacao_2026: "novo", participantes_estimados: 50,
            orcamento_total: 200.2, orcamento_categorias: { [SEM_CATEGORIA]: 200.2 }, periodo_ano_todo: true, validado: true }),
        projeto({ setor_id: "esportes", status: "em_construcao", situacao_2026: null, correcoes_abertas: 2,
            orcamento_total: 0.7, orcamento_categorias: { outros: 0.7 }, data_inicio: "2027-04-01", data_fim: "2027-04-01" }),
        projeto({ setor_id: "esportes", status: "reprovado", situacao_2026: "encerrado", correcoes_abertas: 1 }), // sem período
    ]
    const ind = agregarIndicadores(lista, SETORES)

    it("cartões: total, orçamento, participantes e os 6 status", () => {
        expect(ind.cartoes.projetos).toBe(4)
        expect(ind.cartoes.orcamento).toBe(1201)
        expect(ind.cartoes.participantes).toBe(150)
        expect(ind.cartoes.porStatus).toEqual({ em_construcao: 1, projeto_salvo: 0, aprovado: 1, em_execucao: 1, concluido: 0, reprovado: 1 })
    })

    it("os 6 setores aparecem na ordem dada, mesmo com 0 (AC3)", () => {
        expect(ind.setores.map(l => l.setor_id)).toEqual(SETORES)
        expect(ind.setores.find(l => l.setor_id === "empregabilidade")?.projetos).toBe(0)
        const cultura = ind.setores.find(l => l.setor_id === "cultura")!
        expect(cultura.projetos).toBe(2)
        expect(cultura.porStatus.aprovado).toBe(1)
        expect(cultura.porStatus.em_execucao).toBe(1)
        expect(cultura.porSituacao).toEqual({ mantem: 1, mantem_ajustes: 0, novo: 1, encerrado: 0, [SEM_SITUACAO]: 0 })
        expect(cultura.orcamento).toBe(1200.3)
    })

    it("as partes batem com os cartões: tabela, barras, situação e rosca (AC4)", () => {
        const soma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100
        expect(soma(ind.setores.map(l => l.projetos))).toBe(ind.cartoes.projetos)
        expect(ind.total.projetos).toBe(ind.cartoes.projetos)
        expect(soma(ind.setores.map(l => l.orcamento))).toBe(ind.cartoes.orcamento)
        expect(soma(ind.setores.map(l => l.participantes))).toBe(ind.cartoes.participantes)
        expect(soma(ind.setores.flatMap(l => Object.values(l.porStatus)))).toBe(ind.cartoes.projetos)
        expect(soma(Object.values(ind.total.porSituacao))).toBe(ind.cartoes.projetos)
        expect(soma(ind.orcamentoPorCategoria.map(c => c.valor))).toBe(ind.cartoes.orcamento)
    })

    it("orçamento por categoria: as 7 sempre, \"Sem categoria\" só quando há valor", () => {
        expect(ind.orcamentoPorCategoria.map(c => c.categoria)).toEqual(
            ["material", "espaco", "transporte", "alimentacao", "divulgacao", "servicos", "outros", SEM_CATEGORIA])
        expect(ind.orcamentoPorCategoria.find(c => c.categoria === "material")?.valor).toBe(600.05)
        expect(ind.orcamentoPorCategoria.find(c => c.categoria === SEM_CATEGORIA)?.valor).toBe(200.2)
        const semSem = agregarIndicadores([projeto({ orcamento_total: 10, orcamento_categorias: { material: 10 } })], SETORES)
        expect(semSem.orcamentoPorCategoria.some(c => c.categoria === SEM_CATEGORIA)).toBe(false)
    })

    it("situação vazia conta em \"Sem situação\"", () => {
        expect(ind.total.porSituacao[SEM_SITUACAO]).toBe(1)
    })

    it("visão mensal: projeto em vários meses, \"Ano todo\" separado, sem período fora da grade (AC7)", () => {
        const mes = (m: number | "ano_todo") => ind.visaoMensal.linhas.find(l => l.mes === m)!
        expect(ind.visaoMensal.linhas.map(l => l.mes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "ano_todo"])
        expect(mes(1).porSetor.cultura).toBe(0)
        expect([2, 3, 4].map(m => mes(m).porSetor.cultura)).toEqual([1, 1, 1])
        expect(mes(5).porSetor.cultura).toBe(0)
        expect(mes(4).porSetor.esportes).toBe(1)
        expect(mes(4).total).toBe(2)
        expect(mes("ano_todo").porSetor.cultura).toBe(1)
        expect(ind.visaoMensal.semPeriodo).toBe(1)
        expect(ind.visaoMensal.maximo).toBe(1)
    })

    it("acompanhamento: correções em aberto (mais correções primeiro), não validados e setores sem projeto (AC6)", () => {
        expect(ind.acompanhamento.correcoesAbertas.total).toBe(2)
        expect(ind.acompanhamento.correcoesAbertas.itens.map(i => i.correcoes)).toEqual([2, 1])
        expect(ind.acompanhamento.naoValidados.total).toBe(3)
        expect(ind.acompanhamento.setoresSemProjeto).toEqual(["direitos_humanos", "empregabilidade", "artes_biblioteca", "educacao_tecnologia"])
    })

    it("lista curta corta no limite, mas o total é o real", () => {
        const muitos = Array.from({ length: LIMITE_LISTA_CURTA + 5 }, () => projeto())
        const r = agregarIndicadores(muitos, SETORES)
        expect(r.acompanhamento.naoValidados.total).toBe(LIMITE_LISTA_CURTA + 5)
        expect(r.acompanhamento.naoValidados.itens).toHaveLength(LIMITE_LISTA_CURTA)
    })

    it("com filtro de setor, só ele aparece; projeto de setor fora do conjunto não entra em nada", () => {
        const r = agregarIndicadores(lista, ["esportes"])
        expect(r.setores.map(l => l.setor_id)).toEqual(["esportes"])
        expect(r.cartoes.projetos).toBe(2)
        expect(Object.keys(r.visaoMensal.linhas[0].porSetor)).toEqual(["esportes"])
        expect(r.acompanhamento.naoValidados.itens.every(i => i.setor_id === "esportes")).toBe(true)
    })

    it("sem projetos: tudo zero, sem quebrar", () => {
        const r = agregarIndicadores([], SETORES)
        expect(r.cartoes.projetos).toBe(0)
        expect(r.visaoMensal.maximo).toBe(0)
        expect(r.acompanhamento.setoresSemProjeto).toEqual(SETORES)
    })
})

describe("nivelCalor", () => {
    it("0 vazio; mais forte onde há mais atividades", () => {
        expect(nivelCalor(0, 8)).toBe(0)
        expect(nivelCalor(1, 8)).toBe(1)
        expect(nivelCalor(4, 8)).toBe(2)
        expect(nivelCalor(8, 8)).toBe(4)
        expect(nivelCalor(3, 0)).toBe(0)
    })
})

describe("links do painel", () => {
    const f = { setor: "", status: "aprovado" as const, situacao: "novo" as const, tipo: "" as const }

    it("lista com os filtros do painel e o recorte clicado", () => {
        expect(linkLista({ setor: "", status: "", situacao: "", tipo: "" })).toBe("/planejamento")
        expect(linkLista(f, { setor: "cultura" })).toBe("/planejamento?setor=cultura&status=aprovado&situacao=novo")
        expect(linkLista(f, { status: "reprovado" })).toBe("/planejamento?status=reprovado&situacao=novo")
        expect(linkLista(f, { correcao: "abertas" })).toBe("/planejamento?status=aprovado&situacao=novo&correcao=abertas")
    })

    it("célula com Calendário: o mês e só o setor ligado; \"Ano todo\" vai à visão do ano", () => {
        const todos = ["cultura", "esportes", "empregabilidade"]
        expect(linkCelula(6, "cultura", f, todos, true)).toBe("/planejamento/calendario?mes=6&ocultos=empregabilidade%2Cesportes&status=aprovado")
        expect(linkCelula("ano_todo", "cultura", f, todos, true)).toBe("/planejamento/calendario?ocultos=empregabilidade%2Cesportes&status=aprovado")
    })

    it("célula sem Calendário: a lista filtrada por setor e mês", () => {
        expect(linkCelula(6, "cultura", f, [], false)).toBe("/planejamento?setor=cultura&status=aprovado&situacao=novo&mes=6")
        expect(linkCelula("ano_todo", "cultura", f, [], false)).toBe("/planejamento?setor=cultura&status=aprovado&situacao=novo&mes=ano_todo")
    })
})

describe("exportação (AC9)", () => {
    const lista = [
        projeto({ setor_id: "esportes", nome: "Zeta", status: "aprovado", situacao_2026: "novo", participantes_estimados: 30,
            orcamento_total: 99.9, responsavel_nome: "Ana", validado: true, data_inicio: "2027-06-01", data_fim: "2027-08-31" }),
        projeto({ setor_id: "cultura", nome: "Alfa", situacao_2026: null, correcoes_abertas: 3 }),
    ]
    const ordem = (id: string) => SETORES.indexOf(id)
    const nome = (id: string) => ({ cultura: "Cultura", esportes: "Esportes" } as Record<string, string>)[id] ?? id
    const abas = montarAbasIndicadores(agregarIndicadores(lista, SETORES), lista, nome, ordem, "30/10/2026 10:00")

    it("três abas, com o resumo terminando no Total", () => {
        expect(abas.map(a => a.nomeAba)).toEqual(["Resumo por setor", "Visão mensal", "Lista de projetos"])
        const resumo = abas[0]
        expect(resumo.linhas).toHaveLength(SETORES.length + 1)
        expect(resumo.linhas.at(-1)?.[0]).toBe("Total")
        expect(resumo.linhas.at(-1)?.[1]).toBe(2)
        expect(resumo.colunas.map(c => c.titulo)).toContain("Sem situação")
    })

    it("visão mensal: 12 meses + Ano todo, uma coluna por setor + Total", () => {
        const mensal = abas[1]
        expect(mensal.linhas).toHaveLength(13)
        expect(mensal.colunas).toHaveLength(SETORES.length + 2)
        expect(mensal.linhas[6]).toEqual(["Julho", 0, 0, 0, 0, 0, 1, 1])
    })

    it("lista de projetos: ordem dos setores e todas as colunas do AC9", () => {
        const l = abas[2]
        expect(l.colunas.map(c => c.titulo)).toEqual(["Setor", "Nome", "Tipo", "Situação 2026", "Status", "Período", "Participantes",
            "Orçamento (R$)", "Responsável", "Validado", "Correções em aberto"])
        expect(l.linhas[0]).toEqual(["Cultura", "Alfa", "Projeto", "", "Em construção", "Sem período", "", 0, "", "Não", 3])
        expect(l.linhas[1]).toEqual(["Esportes", "Zeta", "Projeto", "Novo", "Aprovado", "Jun–Ago/2027", 30, 99.9, "Ana", "Sim", 0])
    })

    it("a planilha gerada tem os valores (sem fórmula) e abre de volta", async () => {
        const buffer = await gerarXlsxIndicadores(abas)
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buffer)
        expect(wb.worksheets.map(w => w.name)).toEqual(["Resumo por setor", "Visão mensal", "Lista de projetos"])
        const resumo = wb.getWorksheet("Resumo por setor")!
        const linhaTotal = resumo.getRow(3 + SETORES.length)
        expect(linhaTotal.getCell(1).value).toBe("Total")
        expect(linhaTotal.getCell(2).value).toBe(2)
        expect(wb.getWorksheet("Lista de projetos")!.getRow(4).getCell(8).value).toBe(99.9)
    })

    it("nome do arquivo com a data de Fortaleza", () => {
        // 30/10/2026 01:30 em UTC ainda é 29/10 em Fortaleza (UTC-3)
        expect(nomeArquivoIndicadores(new Date("2026-10-30T01:30:00Z"))).toBe("planejamento-2027_indicadores_2026-10-29.xlsx")
    })
})

describe("função do banco (migration)", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", "20261030120000_pla_08_indicadores.sql"), "utf8")

    it("deixa os excluídos de fora, só leitura e só o cliente de serviço executa", () => {
        expect(sql).toMatch(/p\.excluido_em is null/)
        expect(sql).toMatch(/\bstable\b/)
        expect(sql).not.toMatch(/\b(insert|update|delete)\s/i)
        expect(sql).toMatch(/revoke execute on function public\.pla_indicadores_projetos\(integer, text\[\]\) from public, anon, authenticated/)
        expect(sql).toMatch(/grant execute on function public\.pla_indicadores_projetos\(integer, text\[\]\) to service_role/)
    })
})
