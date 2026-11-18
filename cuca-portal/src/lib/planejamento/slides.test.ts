import { describe, expect, it } from "vitest"
import type { FilhasProjeto, LinhaProjeto } from "./projeto"
import {
    ALTURA_SLIDE, CORPO, MENSAGEM_FICHA_PARCIAL, acaoDaTecla, agruparPorCategoria, alturaBloco, navegar, separadoresRosca, angulosDasFatias, caminhoRosca, corTextoSobre,
    itensDoOrcamento, layoutCapa, limparEspacos, linhasDoOrcamento, montarSlides, nomeArquivoFicha, nomeArquivoSlides, paginarContinuacao, periodoExato, slug,
    tamanhoTituloCapa, tamanhoValorCartao, tonsDaCor, LAYOUT, type DadosSlides, type ResultadoSlides, type Slide,
} from "./slides"

function linha(p: Partial<LinhaProjeto> = {}): LinhaProjeto {
    return {
        id: "p1", ano: 2027, nome: "Olimpíadas da Rede", tipo: "projeto", setor_id: "esportes",
        responsavel_nome: null, responsavel_contato: null, situacao_2026: null, mudancas_2026: null, justificativa_2026: null,
        objetivo_geral: null, publico_alvo: null, faixa_etaria_min: null, faixa_etaria_max: null, participantes_estimados: null,
        periodo_ano_todo: false, data_inicio: null, data_fim: null, duracao: null, frequencia: null, frequencia_outra: null,
        dias_horarios: null, locais_unidades: [], local_outro: false, local_outro_texto: null, como_sera_realizado: null,
        resultados_2026_participantes: null, resultados_2026_principais: null, resultados_2026_funcionou: null,
        resultados_2026_melhorar: null, observacoes: null, status: "projeto_salvo", ficha: "final",
        criado_por_nome: null, atualizado_por_nome: null, created_at: "2026-10-28T10:00:00Z", updated_at: "2026-10-28T10:00:00Z",
        ...p,
    } as LinhaProjeto
}
const semFilhas = (): FilhasProjeto => ({ objetivos: [], orcamento: [], metas: [] })
const dados = (p: Partial<LinhaProjeto> = {}, filhas: Partial<FilhasProjeto> = {}): DadosSlides => ({
    projeto: linha(p),
    filhas: { ...semFilhas(), ...filhas },
    setor: { id: "esportes", nome: "Esportes", cor: "#16a34a" },
    unidades: [{ id: "u1", nome: "Cuca Barra" }, { id: "u2", nome: "Cuca Jangurussu" }],
})
const ok = (r: ResultadoSlides) => {
    if (r.tipo !== "ok") throw new Error("esperava slides")
    return r
}
const tipos = (r: ResultadoSlides) => ok(r).slides.map(s => s.tipo)
const doTipo = <T extends Slide["tipo"]>(r: ResultadoSlides, t: T) =>
    ok(r).slides.filter((s): s is Extract<Slide, { tipo: T }> => s.tipo === t)

const metas = (n: number) => Array.from({ length: n }, (_, i) => ({ ordem: i + 1, meta: `Meta ${i + 1}`, indicador: `Indicador ${i + 1}`, resultado_esperado: `${(i + 1) * 10}` }))
const orc = (...linhas: [string | null, string | null, number | null, number | null][]) =>
    linhas.map(([item, categoria, quantidade, valor_unitario], i) => ({ ordem: i + 1, item, categoria, quantidade, valor_unitario })) as FilhasProjeto["orcamento"]

const completo = (p: Partial<LinhaProjeto> = {}) => dados({
    situacao_2026: "mantem_ajustes", mudancas_2026: "Mais modalidades", justificativa_2026: "Demanda alta",
    responsavel_nome: "Ana", responsavel_contato: "(85) 99999-0000",
    objetivo_geral: "Promover o esporte", publico_alvo: "Jovens", faixa_etaria_min: 15, faixa_etaria_max: 29,
    participantes_estimados: 1200, data_inicio: "2027-06-10", data_fim: "2027-08-05", duracao: "2 meses",
    frequencia: "semanal", dias_horarios: "Sábados, 8h", locais_unidades: ["u1"], como_sera_realizado: "Torneios por unidade",
    resultados_2026_participantes: 900, resultados_2026_principais: "Final com 300 atletas", observacoes: "Risco de chuva",
    ...p,
}, {
    objetivos: [{ ordem: 1, texto: "Integrar unidades" }],
    orcamento: orc(["Medalhas", "material", 300, 10], ["Ônibus", "transporte", 4, 800]),
    metas: metas(2),
})

describe("ficha parcial (D7)", () => {
    it("não gera nenhum slide, nem com tudo preenchido", () => {
        expect(montarSlides({ ...completo(), projeto: linha({ ...completo().projeto, ficha: "parcial" }) }, "tela")).toEqual({ tipo: "ficha_parcial" })
        expect(montarSlides(dados({ ficha: "parcial" }), "pdf")).toEqual({ tipo: "ficha_parcial" })
        expect(MENSAGEM_FICHA_PARCIAL).toBe("Este projeto está salvo parcialmente. Os slides só são gerados depois do Salvar projeto")
    })
})

describe("quais slides aparecem", () => {
    it("ficha final mínima (só nome, tipo e setor): só Capa e Encerramento", () => {
        expect(tipos(montarSlides(dados(), "tela"))).toEqual(["capa", "encerramento"])
    })
    it("projeto completo, Mantém com ajustes: a sequência inteira, na ordem", () => {
        expect(tipos(montarSlides(completo(), "tela"))).toEqual([
            "capa", "numeros", "porque", "objetivos", "execucao", "orcamento", "metas", "aprendizados", "observacoes", "encerramento",
        ])
    })
    it("Novo: sem \"O que aprendemos em 2026\", mesmo com dado de 2026 guardado", () => {
        const t = tipos(montarSlides(completo({ situacao_2026: "novo" }), "tela"))
        expect(t).not.toContain("aprendizados")
        expect(t).toContain("porque")
    })
    it("Encerrado: só Capa, Por que, O que aprendemos e Encerramento", () => {
        expect(tipos(montarSlides(completo({ situacao_2026: "encerrado" }), "tela"))).toEqual(["capa", "porque", "aprendizados", "encerramento"])
    })
    it("Encerrado sem dado de 2026: só Capa, Por que e Encerramento", () => {
        expect(tipos(montarSlides(dados({ situacao_2026: "encerrado", justificativa_2026: "Acabou" }), "tela"))).toEqual(["capa", "porque", "encerramento"])
    })
    it("sem orçamento e sem metas: sem esses slides, e o card de metas some", () => {
        const r = montarSlides(completo(), "tela")
        const sem = montarSlides({ ...completo(), filhas: { ...completo().filhas, orcamento: [], metas: [] } }, "tela")
        expect(tipos(sem)).not.toContain("orcamento")
        expect(tipos(sem)).not.toContain("metas")
        expect(doTipo(r, "numeros")[0].cartoes.map(c => c.rotulo)).toEqual(["Participantes estimados", "Orçamento total", "Duração", "Metas"])
        expect(doTipo(sem, "numeros")[0].cartoes.map(c => c.rotulo)).toEqual(["Participantes estimados", "Duração"])
    })
    it("Números só com 2 ou mais preenchidos", () => {
        expect(tipos(montarSlides(dados({ participantes_estimados: 50 }), "tela"))).not.toContain("numeros")
        const r = montarSlides(dados({ participantes_estimados: 1500, periodo_ano_todo: true }), "tela")
        expect(doTipo(r, "numeros")[0].cartoes).toEqual([
            { rotulo: "Participantes estimados", valor: "1.500" },
            { rotulo: "Período", valor: "Ano todo" },
        ])
    })
    it("orçamento sem nenhum valor: o slide aparece com a lista, sem total, sem rosca e sem cartão de orçamento (S-PLA-09 AC3)", () => {
        const r = montarSlides(dados({ participantes_estimados: 10, duracao: "1 dia" }, { orcamento: orc(["Medalhas", "material", 100, null], ["30000", null, null, null]) }), "tela")
        const o = doTipo(r, "orcamento")
        expect(o).toHaveLength(1)
        expect(o[0].resumo).toBeNull()
        expect(o[0].itens).toEqual([
            { item: "Medalhas", categoria: "Material", quantidade: "100", unitario: "—", total: "—" },
            { item: "30000", categoria: "—", quantidade: "—", unitario: "—", total: "—" },
        ])
        expect(doTipo(r, "numeros")[0].cartoes.map(c => c.rotulo)).not.toContain("Orçamento total")
        expect(JSON.stringify(r)).not.toContain("R$ 0,00")
    })
    it("orçamento: linha toda vazia não aparece; sem nenhuma linha com dado, sem slide", () => {
        expect(tipos(montarSlides(dados({}, { orcamento: orc([null, null, null, null], ["  ", null, null, null]) }), "tela"))).not.toContain("orcamento")
    })
    it("Por que: selo da situação; Mantém sem textos fica só com o selo (desenhado no centro)", () => {
        const r = montarSlides(dados({ situacao_2026: "mantem" }), "tela")
        expect(doTipo(r, "porque")[0]).toMatchObject({ selo: "MANTÉM", blocos: [] })
        const ajustes = montarSlides(completo(), "tela")
        expect(doTipo(ajustes, "porque")[0].blocos.map(b => b.rotulo)).toEqual(["O que muda", "Por que muda"])
        const novo = montarSlides(dados({ situacao_2026: "novo", mudancas_2026: "guardado de antes", justificativa_2026: "Pedido da juventude" }), "tela")
        expect(doTipo(novo, "porque")[0]).toMatchObject({ selo: "NOVO", blocos: [{ rotulo: "Por que criar", texto: "Pedido da juventude" }] })
    })
    it("Como vai acontecer: linha do tempo pelos meses do período; Ano todo; só \"como\" sem período", () => {
        const r = montarSlides(completo(), "tela")
        expect(doTipo(r, "execucao")[0]).toMatchObject({
            linhaDoTempo: { anoTodo: false, meses: [6, 7, 8] }, periodo: "10/06/2027 a 05/08/2027 · 2 meses",
            itens: [{ rotulo: "Frequência", texto: "Semanal" }, { rotulo: "Dias e horários", texto: "Sábados, 8h" }, { rotulo: "Local", texto: "Cuca Barra" }],
        })
        expect(doTipo(montarSlides(dados({ periodo_ano_todo: true }), "tela"), "execucao")[0].linhaDoTempo).toEqual({ anoTodo: true, meses: [] })
        expect(doTipo(montarSlides(dados({ como_sera_realizado: "Oficinas" }), "tela"), "execucao")[0]).toMatchObject({ linhaDoTempo: null, periodo: null, como: "Oficinas" })
    })
    it("meta preenchida pela metade não imprime rótulo vazio; linha toda vazia não conta", () => {
        const r = montarSlides(dados({}, { metas: [
            { ordem: 1, meta: "Atender 500", indicador: null, resultado_esperado: null },
            { ordem: 2, meta: "  ", indicador: null, resultado_esperado: "" },
        ] }), "tela")
        const m = doTipo(r, "metas")
        expect(m).toHaveLength(1)
        expect(m[0].metas).toEqual([{ meta: "Atender 500", indicador: null, esperado: null }])
    })
    it("meta que não cabe no cartão pequeno: cartões da largura toda, quantos couberem; numeração segue; nada cortado", () => {
        const texto = "Garantir que 75% das atrações culturais e esportivas sejam compostas por artistas, grupos e coletivos da própria juventude de Fortaleza, com acompanhamento mensal das inscrições, relatórios por unidade, registro fotográfico das apresentações e avaliação com os coletivos ao final de cada etapa"
        const longas = metas(5).map(m => ({ ...m, meta: "7", indicador: texto }))
        const m = doTipo(montarSlides(dados({}, { metas: longas }), "tela"), "metas")
        expect(m.every(s => s.layout === "lista")).toBe(true)
        expect(m.flatMap(s => s.metas.map(x => x.indicador))).toEqual(Array(5).fill(texto))
        expect(m.flatMap(s => s.metas.map(x => x.meta))).toEqual(Array(5).fill("7"))
        expect(m.map(s => s.inicio)).toEqual(m.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 1 : acc[i - 1] + m[i - 1].metas.length], []))
    })
    it("mais de 4 metas continuam em outro slide", () => {
        const r = montarSlides(dados({}, { metas: metas(9) }), "tela")
        const m = doTipo(r, "metas")
        expect(m.map(s => [s.parte, s.partes, s.metas.length, s.inicio, s.layout])).toEqual([[1, 3, 4, 1, "grade"], [2, 3, 4, 5, "grade"], [3, 3, 1, 9, "grade"]])
        expect(m.map(s => s.titulo)).toEqual(["Metas e indicadores (1/3)", "Metas e indicadores (2/3)", "Metas e indicadores (3/3)"])
    })
    it("O que aprendemos: barras 2026 × 2027 proporcionais; só texto quando não há número", () => {
        const r = doTipo(montarSlides(completo(), "tela"), "aprendizados")[0]
        expect(r.barras.map(b => [b.rotulo, b.valorTexto, Number(b.proporcao.toFixed(2))])).toEqual([["2026 atendidos", "900", 0.75], ["2027 estimados", "1.200", 1]])
        const so = doTipo(montarSlides(dados({ resultados_2026_melhorar: "Divulgação" }), "tela"), "aprendizados")[0]
        expect(so).toMatchObject({ barras: [], blocos: [{ rotulo: "O que melhorar", texto: "Divulgação" }] })
    })
    it("rodapé, cor do setor e títulos", () => {
        const r = ok(montarSlides(completo(), "tela"))
        expect(r.rodape).toBe("Planejamento 2027 · Esportes")
        expect(r.cor).toBe("#16a34a")
        expect(r.slides[0]).toMatchObject({ titulo: "Capa", nome: "Olimpíadas da Rede", tipoProjeto: "Projeto", responsavel: "Ana" })
        expect(r.slides.at(-1)).toMatchObject({ tipo: "encerramento", responsavel: "Ana", contato: "(85) 99999-0000" })
        expect(new Set(r.slides.map(s => s.id)).size).toBe(r.slides.length)
    })
})

describe("texto longo (S-PLA-09: nada cortado, tela = PDF)", () => {
    const longo = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ")
    const textos = (r: ResultadoSlides) => JSON.stringify(ok(r).slides)

    it("tela e PDF geram exatamente os mesmos slides", () => {
        const d = dados({ observacoes: longo(400), objetivo_geral: longo(300), como_sera_realizado: longo(200) }, { objetivos: Array.from({ length: 12 }, (_, i) => ({ ordem: i + 1, texto: longo(25) })) })
        expect(montarSlides(d, "tela")).toEqual(montarSlides(d, "pdf"))
    })
    it("nenhuma reticência colocada pelo sistema; o resto vai para a continuação logo depois, e nada se perde", () => {
        const texto = longo(400)
        const r = montarSlides(dados({ observacoes: texto }), "tela")
        expect(textos(r)).not.toContain("…\"")
        const t = tipos(r)
        const i = t.indexOf("observacoes")
        expect(t[i + 1]).toBe("continuacao")
        const cont = ok(r).slides.filter(s => s.tipo === "continuacao")
        expect(cont[0].titulo).toBe("Riscos e observações … continuação")
        const juntado = [doTipo(r, "observacoes")[0].texto, ...cont.flatMap(c => c.tipo === "continuacao" ? c.blocos.map(b => b.texto) : [])].join(" ")
        expect(juntado.split(/\s+/)).toEqual(texto.split(" "))
    })
    it("corte prefere o fim do parágrafo: nunca fica uma palavra solta (caso \"Promover…\")", () => {
        const p1 = "O evento é realizado em alusão ao Dia Internacional da Juventude, comemorado no dia 12 de agosto. ".repeat(4).trim()
        const p2 = "Promover a maior virada cultural, esportiva e de cidadania da cidade de Fortaleza, com programação gratuita. ".repeat(6).trim()
        const r = montarSlides(dados({ objetivo_geral: `${p1}\n\n${p2}` }, { objetivos: Array.from({ length: 5 }, (_, i) => ({ ordem: i + 1, texto: `Objetivo ${i + 1}` })) }), "tela")
        const o = doTipo(r, "objetivos")[0]
        const cont = doTipo(r, "continuacao")
        if (cont.length) {
            expect(o.objetivoGeral === null || !/Promover$/.test(o.objetivoGeral)).toBe(true)
            const tudo = [o.objetivoGeral ?? "", ...cont.flatMap(c => c.blocos.filter(b => b.rotulo === "Objetivo geral").map(b => b.texto))].join("\n\n")
            expect(tudo.replace(/\s+/g, " ")).toBe(`${p1} ${p2}`.replace(/\s+/g, " "))
        }
    })
    it("objetivos específicos: todos aparecem (no slide ou na continuação), sem \"… e mais N\"", () => {
        const poucos = Array.from({ length: 8 }, (_, i) => ({ ordem: i + 1, texto: `Objetivo ${i + 1}` }))
        expect(doTipo(montarSlides(dados({}, { objetivos: poucos }), "tela"), "objetivos")[0].especificos).toHaveLength(8)
        const muitos = Array.from({ length: 30 }, (_, i) => ({ ordem: i + 1, texto: `Objetivo específico número ${i + 1} com um texto de tamanho médio` }))
        const r = montarSlides(dados({}, { objetivos: muitos }), "tela")
        const visiveis = doTipo(r, "objetivos")[0].especificos
        const resto = doTipo(r, "continuacao").flatMap(c => c.blocos.filter(b => b.rotulo === "Objetivos específicos").flatMap(b => b.texto.split("\n").map(l => l.replace(/^• /, ""))))
        expect([...visiveis, ...resto]).toEqual(muitos.map(o => o.texto))
    })
    it("paginarContinuacao: cada página cabe na área do slide (pela altura) e a ordem é mantida", () => {
        const paginas = paginarContinuacao([{ rotulo: "A", texto: longo(900) }, { rotulo: "B", texto: Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n") }, { rotulo: "C", texto: "fim" }])
        expect(paginas.length).toBeGreaterThan(2)
        for (const pg of paginas) expect(pg.reduce((s, b) => s + alturaBloco(b.texto, CORPO.largura, LAYOUT.continuacao), 0)).toBeLessThanOrEqual(CORPO.altura)
        expect(paginas.at(-1)?.at(-1)).toEqual({ rotulo: "C", texto: "fim" })
        expect(paginas.flat().filter(b => b.rotulo === "B").map(b => b.texto).join("\n")).toBe(Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n"))
    })
    it("só espaço em branco muda: tabulação, espaços seguidos, linhas em branco a mais e espaço nas pontas; letras e \"-----\" ficam", () => {
        expect(limparEspacos("  a\t b  c \n\n\n\n -----  \r\nfim ")).toBe("a b c\n\n-----\nfim")
        expect(limparEspacos(" \t \n ")).toBeNull()
        expect(limparEspacos("começa minúsculo")).toBe("começa minúsculo")
        const r = montarSlides(dados({ nome: "OLIMPIADAS DA JUVENTUDE  DE FORTALEZA", observacoes: "-----" }), "tela")
        expect(doTipo(r, "capa")[0].nome).toBe("OLIMPIADAS DA JUVENTUDE DE FORTALEZA")
        expect(doTipo(r, "observacoes")[0].texto).toBe("-----")
    })
})

describe("orçamento", () => {
    it("agrupa por categoria, só valores acima de zero, da maior para a menor", () => {
        const itens = itensDoOrcamento({ ...semFilhas(), orcamento: orc(["A", "material", 2, 50], ["B", "transporte", 1, 300], ["C", "material", 1, 100], ["D", null, 1, 50], ["E", "espaco", 0, 10]) })
        const fatias = agruparPorCategoria(itens, "#16a34a")
        expect(fatias.map(x => [x.rotulo, x.valor, x.percentual])).toEqual([["Transporte", 300, 54.5], ["Material", 200, 36.4], ["Sem categoria", 50, 9.1]])
        expect(fatias[0].cor).toBe("#16a34a")
    })
    it("todas as linhas, na ordem da ficha, como digitadas; total e rosca só com os itens de valor", () => {
        const linhas = orc(["a", "material", 1, 1], ["b", "material", 1, 2], ["c", "material", 1, 3], [null, "transporte", 1, 4], ["e", "material", 1, 5], ["f", "material", 1, 6], ["Arbitragem", "servicos", null, null])
        const o = doTipo(montarSlides(dados({}, { orcamento: linhas }), "tela"), "orcamento")[0]
        expect(o.resumo?.total).toBe("R$ 21,00")
        expect(o.resumo?.fatias.map(x => x.rotulo)).toEqual(["Material", "Transporte"])
        expect(o.itens.map(l => l.item)).toEqual(["a", "b", "c", "—", "e", "f", "Arbitragem"])
        expect(o.itens[6]).toEqual({ item: "Arbitragem", categoria: "Serviços", quantidade: "—", unitario: "—", total: "—" })
        expect(linhasDoOrcamento({ ...semFilhas(), orcamento: orc(["Lanche", "alimentacao", 250, 20.5]) })[0]).toEqual({ item: "Lanche", categoria: "Alimentação", quantidade: "250", unitario: "R$ 20,50", total: "R$ 5.125,00" })
    })
    it("muitos itens continuam em \"Orçamento … continuação\" (resumo só no primeiro); nome de item longo inteiro", () => {
        const nomeLongo = "equipe geral - coordenação/ produção/ comunicação/ jurados/ apresentadores e equipe de apoio nas unidades"
        const linhas = orc(...Array.from({ length: 40 }, (_, i) => [i === 0 ? nomeLongo : String(i + 1), "servicos", 1, 100] as [string, string, number, number]))
        const o = doTipo(montarSlides(dados({}, { orcamento: linhas }), "tela"), "orcamento")
        expect(o.length).toBeGreaterThan(1)
        expect(o[0].resumo).not.toBeNull()
        expect(o.slice(1).every(x => x.resumo === null && x.titulo === "Orçamento … continuação")).toBe(true)
        expect(o.flatMap(x => x.itens.map(l => l.item))).toEqual([nomeLongo, ...Array.from({ length: 39 }, (_, i) => String(i + 2))])
    })
    it("rosca com uma categoria só (100%) desenha a volta inteira", () => {
        const [a] = angulosDasFatias([{ valor: 10 }])
        expect(a).toEqual({ inicio: 0, fim: 360 })
        const d = caminhoRosca(100, 100, 80, 50, a.inicio, a.fim)
        expect(d.match(/M /g)).toHaveLength(4)
        expect(d).not.toMatch(/NaN|Infinity/)
    })
    it("ângulos somam 360; pedaço de meia volta ou mais é dividido (nenhum arco chega a 179°)", () => {
        const ang = angulosDasFatias([{ valor: 3 }, { valor: 1 }])
        expect(ang).toEqual([{ inicio: 0, fim: 270 }, { inicio: 270, fim: 360 }])
        expect(caminhoRosca(0, 0, 10, 5, 0, 270).match(/M /g)).toHaveLength(2)
        expect(caminhoRosca(0, 0, 10, 5, 270, 360).match(/M /g)).toHaveLength(1)
        const metade = angulosDasFatias([{ valor: 1 }, { valor: 1 }])
        expect(metade).toEqual([{ inicio: 0, fim: 180 }, { inicio: 180, fim: 360 }])
        expect(caminhoRosca(0, 0, 10, 5, 0, 180).match(/M /g)).toHaveLength(2)
    })
    it("separadores só entre categorias diferentes (uma categoria: nenhum)", () => {
        expect(separadoresRosca(100, 100, 96, 58, angulosDasFatias([{ valor: 10 }]))).toEqual([])
        expect(separadoresRosca(100, 100, 96, 58, angulosDasFatias([{ valor: 1 }, { valor: 3 }]))).toHaveLength(2)
    })
})

describe("cores, capa e arquivos", () => {
    it("texto branco nas cores dos setores; escuro em cor clara", () => {
        for (const cor of ["#7c3aed", "#2563eb", "#db2777", "#ea580c", "#0891b2", "#16a34a"]) expect(corTextoSobre(cor)).toBe("#ffffff")
        expect(corTextoSobre("#fde047")).toBe("#0f172a")
        expect(corTextoSobre("inválida")).toBe("#ffffff")
    })
    it("tons vão da cor do setor para mais claro", () => {
        expect(tonsDaCor("#000000", 3)).toEqual(["#000000", "#5c5c5c", "#b8b8b8"])
        expect(tonsDaCor("#16a34a", 1)).toEqual(["#16a34a"])
    })
    it("setor sem cor válida usa a cor padrão", () => {
        const r = ok(montarSlides({ ...dados(), setor: { id: "x", nome: "X", cor: "" } }, "tela"))
        expect(r.cor).toBe("#1e3a8a")
    })
    it("nome da capa diminui conforme o tamanho, nunca é cortado", () => {
        expect(tamanhoTituloCapa("Sarau")).toBe(54)
        expect(tamanhoTituloCapa("x".repeat(200))).toBe(24)
        expect(tamanhoTituloCapa("SARAU DA JUVENTUDE NA PERIFERIA DE FORTALEZA")).toBeLessThan(tamanhoTituloCapa("Sarau da juventude na periferia de Fortaleza"))
        const nome = "Projeto ".repeat(25).trim()
        expect(doTipo(montarSlides(dados({ nome }), "tela"), "capa")[0].nome).toBe(nome)
        const longo = "Responsável ".repeat(10).trim()
        const r = montarSlides(dados({ responsavel_nome: longo }), "pdf")
        expect(doTipo(r, "capa")[0].responsavel).toBe(longo)
        expect(doTipo(r, "encerramento")[0].responsavel).toBe(longo)
    })
    it("capa: o nome diminui até o bloco caber acima do rodapé, com nome e responsável inteiros", () => {
        expect(layoutCapa("Sarau", "Ana")).toEqual({ tamanho: 54, topo: 140, respiro: 22 })
        const grande = layoutCapa("X".repeat(200), "R".repeat(120))
        expect(grande.tamanho).toBeLessThan(24)
        expect(grande.topo).toBeLessThan(ALTURA_SLIDE)
    })
    it("cartões de números: o valor cabe numa linha conforme a quantidade de cartões", () => {
        expect(tamanhoValorCartao("30.000", 4)).toBe(34)
        expect(tamanhoValorCartao("R$ 238.420,00", 4)).toBeLessThan(tamanhoValorCartao("R$ 238.420,00", 2))
        expect(tamanhoValorCartao("R$ 238.420,00", 4)).toBeGreaterThanOrEqual(16)
    })
    it("datas exatas: um dia, período, uma data só, final antes da inicial, ano todo", () => {
        const base = { periodo_ano_todo: false, data_inicio: null, data_fim: null }
        expect(periodoExato({ ...base, data_inicio: "2027-04-10", data_fim: "2027-04-10" })).toBe("10/04/2027")
        expect(periodoExato({ ...base, data_inicio: "2027-08-06", data_fim: "2027-09-03" })).toBe("06/08/2027 a 03/09/2027")
        expect(periodoExato({ ...base, data_fim: "2027-09-03" })).toBe("03/09/2027")
        expect(periodoExato({ ...base, data_inicio: "2027-09-03", data_fim: "2027-08-06" })).toBe("03/09/2027 a 06/08/2027")
        expect(periodoExato({ ...base, periodo_ano_todo: true })).toBe("Ano todo")
        expect(periodoExato(base)).toBeNull()
        const r = montarSlides(dados({ participantes_estimados: 10, data_inicio: "2027-04-10", data_fim: "2027-04-10" }), "tela")
        expect(doTipo(r, "numeros")[0].cartoes[1]).toEqual({ rotulo: "Período", valor: "10/04/2027" })
    })
    it("nome do arquivo: planejamento-2027_{setor}_{nome}.pdf, sem acento e com _ só entre as partes", () => {
        expect(nomeArquivoSlides("Educação e Tecnologia", "Olimpíadas da Rede: 2ª edição!")).toBe("planejamento-2027_educacao-e-tecnologia_olimpiadas-da-rede-2a-edicao.pdf")
        expect(nomeArquivoFicha("Esportes", "Sarau_noturno")).toBe("ficha-planejamento-2027_esportes_sarau-noturno.pdf")
        expect(slug("!!!")).toBe("projeto")
    })
})

describe("modo apresentar (AC6)", () => {
    it("setas, espaço, Home/End e Esc", () => {
        expect(["ArrowRight", " ", "PageDown"].map(acaoDaTecla)).toEqual(["proximo", "proximo", "proximo"])
        expect(["ArrowLeft", "PageUp"].map(acaoDaTecla)).toEqual(["anterior", "anterior"])
        expect([acaoDaTecla("Home"), acaoDaTecla("End"), acaoDaTecla("Escape"), acaoDaTecla("a")]).toEqual(["inicio", "fim", "sair", null])
    })
    it("não passa do primeiro nem do último slide", () => {
        expect(navegar(0, 5, "anterior")).toBe(0)
        expect(navegar(4, 5, "proximo")).toBe(4)
        expect(navegar(2, 5, "proximo")).toBe(3)
        expect(navegar(2, 5, "fim")).toBe(4)
        expect(navegar(3, 5, "inicio")).toBe(0)
        expect(navegar(0, 0, "proximo")).toBe(0)
    })
})
