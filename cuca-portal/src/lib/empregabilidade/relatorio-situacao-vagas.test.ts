import { describe, expect, it } from "vitest"
import {
    classificarOrigem,
    contarEnviadosPorVaga,
    diaFortaleza,
    diasEmAberto,
    filtrarLinhas,
    formatarData,
    formatarDatasSelecao,
    montarLinha,
    ordenarPorCadastro,
    paginar,
    ROTULO_REDE,
    rotuloUnidade,
    textoRodape,
    totaisRodape,
    type VagaAberta,
} from "./relatorio-situacao-vagas"

const TALENTO = "292363eb-2b32-4b8a-a14e-f1aaf6199db5"
const JANGURUSSU = "e325a27a-c25b-4627-8ce4-b0eb5ae21d65"
const UNIDADES = [{ id: JANGURUSSU, nome: "CUCA Jangurussu" }]
const AGORA = new Date("2026-11-09T15:00:00Z")

function vaga(p: Partial<VagaAberta> = {}): VagaAberta {
    return {
        id: "v1",
        tipo: "vaga_normal",
        titulo: "AUXILIAR DE LIMPEZA",
        empresa: "IEP - INSTITUTO DE EDUCACAO PORTAL",
        created_at: "2026-10-29T12:00:00Z",
        liberada_em: "2026-10-29T16:05:52Z",
        liberada_por_email: "cucajangurussu.empregabilidade@gmail.com",
        data_selecao_prevista: "2026-11-06",
        datas_selecao: null,
        ...p,
    }
}

describe("origem do currículo (AC3)", () => {
    it("convocado do Banco de Talentos só com o id do talento", () => {
        expect(classificarOrigem(`banco_talentos:${TALENTO}`)).toBe("banco_talentos")
        expect(classificarOrigem(`BANCO_TALENTOS:${TALENTO.toUpperCase()}`)).toBe("banco_talentos")
    })

    it("sem observação = automação (link/WhatsApp)", () => {
        expect(classificarOrigem(null)).toBe("automacao")
        expect(classificarOrigem(undefined)).toBe("automacao")
        expect(classificarOrigem("  ")).toBe("automacao")
    })

    it("qualquer outro texto = incluído à mão (não é banco nem automação)", () => {
        expect(classificarOrigem("Incluído manualmente (outro canal)")).toBe("manual")
        expect(classificarOrigem("banco_talentos: cadastro via WhatsApp")).toBe("manual")
        expect(classificarOrigem("banco_talentos: candidatura geral")).toBe("manual")
    })

    it("conta por vaga; incluídos à mão entram só no total (banco + automação ≤ total)", () => {
        const mapa = contarEnviadosPorVaga([
            { vaga_id: "a", observacoes: `banco_talentos:${TALENTO}` },
            { vaga_id: "a", observacoes: `banco_talentos:${TALENTO}` },
            { vaga_id: "a", observacoes: null },
            { vaga_id: "a", observacoes: "Incluído manualmente (outro canal)" },
            { vaga_id: "b", observacoes: null },
        ])
        const a = mapa.get("a")!
        expect(a).toEqual({ total: 4, banco_talentos: 2, automacao: 1 })
        expect(a.total - a.banco_talentos - a.automacao).toBe(1)
        expect(mapa.get("b")).toEqual({ total: 1, banco_talentos: 0, automacao: 1 })
        expect(mapa.has("c")).toBe(false)
    })
})

describe("datas (AC3, AC5)", () => {
    it("dia no calendário de Fortaleza, não UTC", () => {
        // 30/10 02:00 UTC = 29/10 23:00 em Fortaleza.
        expect(diaFortaleza("2026-10-30T02:00:00Z")).toBe("2026-10-29")
        expect(diaFortaleza("2026-10-30T03:00:00Z")).toBe("2026-10-30")
    })

    it("formata dd/mm/aaaa e devolve null para vazio ou inválido", () => {
        expect(formatarData("2026-10-29")).toBe("29/10/2026")
        expect(formatarData(null)).toBeNull()
        expect(formatarData("29/10/2026")).toBeNull()
    })

    it("dias em aberto contam do dia da liberação até hoje, em Fortaleza", () => {
        expect(diasEmAberto("2026-10-29T16:05:52Z", AGORA)).toBe(11)
        expect(diasEmAberto("2026-11-09T13:03:08Z", AGORA)).toBe(0)
        // Liberada às 23h de Fortaleza (02h UTC do dia seguinte) conta pelo dia de Fortaleza.
        expect(diasEmAberto("2026-11-09T02:00:00Z", AGORA)).toBe(1)
        expect(diasEmAberto(null, AGORA)).toBeNull()
    })

    it("seleção mostra todas as datas, em ordem, com hora", () => {
        expect(formatarDatasSelecao([{ data: "2026-11-25", hora: "09:00" }, { data: "2026-11-11", hora: "09:00" }])).toBe("11/11 09:00 · 25/11 09:00")
        expect(formatarDatasSelecao([{ data: "2026-11-17", hora: "" }])).toBe("17/11")
        expect(formatarDatasSelecao([])).toBeNull()
        expect(formatarDatasSelecao(null)).toBeNull()
        expect(formatarDatasSelecao([{ data: "lixo" }])).toBeNull()
    })
})

describe("linha do relatório (AC3, AC4, AC5)", () => {
    it("vaga: datas, dias, enviados por origem, entrevista e quem liberou", () => {
        const l = montarLinha({ vaga: vaga(), unidadeNome: "CUCA Jangurussu", enviados: { total: 35, banco_talentos: 30, automacao: 5 }, agora: AGORA })
        expect(l).toMatchObject({
            rotuloTipo: "Vaga",
            unidade: "CUCA Jangurussu",
            cadastradaEmTexto: "29/10/2026",
            liberadaEmTexto: "29/10/2026",
            diasEmAberto: 11,
            enviados: { total: 35, banco_talentos: 30, automacao: 5 },
            dataEntrevistaSelecao: "06/11/2026",
            liberadaPor: "cucajangurussu.empregabilidade@gmail.com",
        })
    })

    it("vaga sem nenhum enviado mostra zeros, não vazio", () => {
        const l = montarLinha({ vaga: vaga(), unidadeNome: "x", enviados: undefined, agora: AGORA })
        expect(l.enviados).toEqual({ total: 0, banco_talentos: 0, automacao: 0 })
    })

    it("seleção: sem colunas de currículo, com todas as datas da seleção (D6)", () => {
        const l = montarLinha({
            vaga: vaga({ tipo: "selecao_evento", data_selecao_prevista: null, datas_selecao: [{ data: "2026-11-11", hora: "09:00" }, { data: "2026-11-25", hora: "09:00" }] }),
            unidadeNome: "CUCA Pici",
            enviados: { total: 7, banco_talentos: 7, automacao: 0 },
            agora: AGORA,
        })
        expect(l.rotuloTipo).toBe("Seleção")
        expect(l.enviados).toBeNull()
        expect(l.dataEntrevistaSelecao).toBe("11/11 09:00 · 25/11 09:00")
    })

    it("liberada antes de 15/10 (sem registro): liberação, dias e quem liberou vazios", () => {
        const l = montarLinha({ vaga: vaga({ liberada_em: null, liberada_por_email: null, data_selecao_prevista: null }), unidadeNome: "x", enviados: undefined, agora: AGORA })
        expect(l.liberadaEmTexto).toBeNull()
        expect(l.diasEmAberto).toBeNull()
        expect(l.liberadaPor).toBeNull()
        expect(l.dataEntrevistaSelecao).toBeNull()
    })

    it("rótulo da rede diz que a vaga não tem unidade, não que são todas", () => {
        expect(ROTULO_REDE).toBe("Sem unidade definida (Rede Cuca)")
    })

    it("unidade pelo nome; rede ou desconhecida vira o rótulo da rede", () => {
        expect(rotuloUnidade(JANGURUSSU, UNIDADES)).toBe("CUCA Jangurussu")
        expect(rotuloUnidade("rede", UNIDADES)).toBe(ROTULO_REDE)
        expect(rotuloUnidade(null, UNIDADES)).toBe(ROTULO_REDE)
    })
})

describe("ordem, filtro e rodapé (AC5.1, AC6)", () => {
    const linhas = [
        montarLinha({ vaga: vaga({ id: "1", created_at: "2026-10-29T12:00:00Z" }), unidadeNome: "x", enviados: undefined, agora: AGORA }),
        montarLinha({ vaga: vaga({ id: "2", titulo: "Sushiman", empresa: "Restaurante Ação", created_at: "2026-11-09T12:00:00Z" }), unidadeNome: "x", enviados: undefined, agora: AGORA }),
        montarLinha({ vaga: vaga({ id: "3", tipo: "selecao_evento", titulo: "Processo Seletivo — SINGULAR", created_at: "2026-05-26T12:00:00Z" }), unidadeNome: "x", enviados: undefined, agora: AGORA }),
    ]

    it("mais recente primeiro pela data de cadastro", () => {
        expect(ordenarPorCadastro(linhas).map(l => l.id)).toEqual(["2", "1", "3"])
    })

    it("filtra por tipo e busca em título ou empresa, sem acento", () => {
        expect(filtrarLinhas(linhas, { tipo: "vagas", busca: "" }).map(l => l.id)).toEqual(["1", "2"])
        expect(filtrarLinhas(linhas, { tipo: "selecoes", busca: "" }).map(l => l.id)).toEqual(["3"])
        expect(filtrarLinhas(linhas, { tipo: "todas", busca: "restaurante acao" }).map(l => l.id)).toEqual(["2"])
        expect(filtrarLinhas(linhas, { tipo: "todas", busca: "EDUCAÇÃO" }).map(l => l.id)).toEqual(["1", "3"])
        expect(filtrarLinhas(linhas, { tipo: "todas", busca: "singular" }).map(l => l.id)).toEqual(["3"])
    })

    it("rodapé conta o que está na tela", () => {
        expect(totaisRodape(linhas)).toEqual({ vagas: 2, selecoes: 1, total: 3 })
        expect(textoRodape(filtrarLinhas(linhas, { tipo: "selecoes", busca: "" }))).toBe("Vagas = 0 · Seleções = 1 · Total = 1")
        expect(textoRodape([])).toBe("Vagas = 0 · Seleções = 0 · Total = 0")
    })
})

describe("paginação (AC6)", () => {
    const cem = Array.from({ length: 250 }, (_, i) => i + 1)

    it("até 100 linhas: uma página só", () => {
        expect(paginar(cem.slice(0, 19), 0)).toEqual({ itens: cem.slice(0, 19), pagina: 0, totalPaginas: 1, de: 1, ate: 19 })
        expect(paginar(cem.slice(0, 100), 0).totalPaginas).toBe(1)
    })

    it("acima de 100: páginas de 100, a última com o resto", () => {
        expect(paginar(cem, 0)).toMatchObject({ pagina: 0, totalPaginas: 3, de: 1, ate: 100 })
        expect(paginar(cem, 2)).toMatchObject({ pagina: 2, de: 201, ate: 250 })
        expect(paginar(cem, 2).itens).toHaveLength(50)
    })

    it("página fora do intervalo é ajustada (ex.: filtro reduziu as linhas)", () => {
        expect(paginar(cem.slice(0, 30), 5)).toMatchObject({ pagina: 0, de: 1, ate: 30 })
        expect(paginar(cem, -1).pagina).toBe(0)
    })

    it("zero linhas: página 0 de 1, sem intervalo", () => {
        expect(paginar([], 3)).toEqual({ itens: [], pagina: 0, totalPaginas: 1, de: 0, ate: 0 })
    })
})
