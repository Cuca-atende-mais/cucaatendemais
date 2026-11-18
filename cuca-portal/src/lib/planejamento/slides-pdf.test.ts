import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import { renderToBuffer } from "@react-pdf/renderer"
import type { FilhasProjeto, LinhaProjeto } from "./projeto"
import { montarSlides, type DadosSlides } from "./slides"
import { CorposPdfDocument, SlidesPdfDocument } from "./slides-pdf"
import { FichaPdfDocument } from "./ficha-pdf"

// S-PLA-05 (AC7, AC8, DoD) / S-PLA-09 (AC7): gera os PDFs de verdade com dados de exemplo e confere:
// - cada slide vira exatamente uma página;
// - nenhum corpo de slide passa da área de conteúdo: o corpo de cada slide é desenhado sozinho numa
//   página do tamanho exato da área (848 × 368); se passar, essa página quebra em duas.
// Com PLA_PDF_EXEMPLOS=<pasta>, grava os arquivos para conferência visual.

const LOGO = join(__dirname, "..", "..", "..", "public", "logo-rede-cuca.png")
const PASTA = process.env.PLA_PDF_EXEMPLOS

const longo = (frase: string, vezes: number) => Array.from({ length: vezes }, () => frase).join(" ")

function linha(p: Partial<LinhaProjeto>): LinhaProjeto {
    return {
        id: "p1", ano: 2027, nome: "Olimpíadas da Juventude Rede Cuca", tipo: "projeto", setor_id: "esportes",
        responsavel_nome: "Ana Beatriz Souza", responsavel_contato: "(85) 99999-0000", situacao_2026: "mantem_ajustes",
        mudancas_2026: "Inclusão de vôlei de praia e e-sports, com etapas classificatórias em cada unidade.",
        justificativa_2026: "Em 2026 a procura superou as vagas em 40% e as unidades pediram modalidades novas.",
        objetivo_geral: "Promover a integração entre as unidades da Rede Cuca por meio do esporte, estimulando hábitos saudáveis e o protagonismo juvenil.",
        publico_alvo: "Jovens atendidos pelas unidades da Rede Cuca e comunidade do entorno", faixa_etaria_min: 15, faixa_etaria_max: 29,
        participantes_estimados: 1200, periodo_ano_todo: false, data_inicio: "2027-06-10", data_fim: "2027-08-05", duracao: "2 meses",
        frequencia: "semanal", frequencia_outra: null, dias_horarios: "Sábados, das 8h às 12h", locais_unidades: ["u1", "u2"],
        local_outro: true, local_outro_texto: "Ginásio Paulo Sarasate", como_sera_realizado: "Etapas classificatórias em cada unidade, seguidas de uma final com cerimônia de abertura e premiação.",
        resultados_2026_participantes: 900, resultados_2026_principais: "Final com 300 atletas e 12 modalidades.",
        resultados_2026_funcionou: "Parceria com as escolas do entorno.", resultados_2026_melhorar: "Divulgação antecipada e transporte entre unidades.",
        observacoes: "Risco de chuva nas etapas externas; plano B com quadras cobertas.", status: "projeto_salvo", ficha: "final",
        criado_por_nome: "Ana", atualizado_por_nome: "Ana", created_at: "2026-10-28T10:00:00Z", updated_at: "2026-10-28T10:00:00Z",
        ...p,
    } as LinhaProjeto
}

const FILHAS: FilhasProjeto = {
    objetivos: [
        { ordem: 1, texto: "Integrar as unidades em um calendário esportivo comum" },
        { ordem: 2, texto: "Ampliar a participação feminina nas modalidades coletivas" },
        { ordem: 3, texto: "Revelar talentos para as equipes da Rede" },
    ],
    orcamento: [
        { ordem: 1, item: "Medalhas e troféus", categoria: "material", quantidade: 300, valor_unitario: 18 },
        { ordem: 2, item: "Ônibus para as finais", categoria: "transporte", quantidade: 6, valor_unitario: 950 },
        { ordem: 3, item: "Lanches", categoria: "alimentacao", quantidade: 1200, valor_unitario: 6.5 },
        { ordem: 4, item: "Camisetas", categoria: "material", quantidade: 600, valor_unitario: 22 },
        { ordem: 5, item: "Arbitragem", categoria: "servicos", quantidade: 20, valor_unitario: 150 },
        { ordem: 6, item: "Banners", categoria: "divulgacao", quantidade: 10, valor_unitario: 80 },
    ],
    metas: [
        { ordem: 1, meta: "Atender 1.200 jovens", indicador: "Lista de inscritos por unidade", resultado_esperado: "1.200 inscritos" },
        { ordem: 2, meta: "Ter 40% de participação feminina", indicador: "Inscrições por gênero", resultado_esperado: "480 atletas" },
        { ordem: 3, meta: "Realizar etapas em todas as unidades", indicador: null, resultado_esperado: "6 etapas" },
    ],
}

const SETOR = { id: "esportes", nome: "Esportes", cor: "#16a34a" }
const UNIDADES = [{ id: "u1", nome: "Cuca Barra" }, { id: "u2", nome: "Cuca Jangurussu" }]

const CASOS: { nome: string; dados: DadosSlides }[] = [
    { nome: "completo-mantem-ajustes", dados: { projeto: linha({}), filhas: FILHAS, setor: SETOR, unidades: UNIDADES } },
    {
        nome: "novo-cultura",
        dados: {
            projeto: linha({ nome: "Sarau", situacao_2026: "novo", justificativa_2026: "Pedido do conselho juvenil.", periodo_ano_todo: true, data_inicio: null, data_fim: null, duracao: null, frequencia: "mensal" }),
            filhas: { ...FILHAS, orcamento: [{ ordem: 1, item: "Som", categoria: "servicos", quantidade: 12, valor_unitario: 400 }] },
            setor: { id: "cultura", nome: "Cultura", cor: "#db2777" },
            unidades: UNIDADES,
        },
    },
    {
        nome: "encerrado",
        dados: { projeto: linha({ nome: "Copa de Futsal de Areia", situacao_2026: "encerrado", justificativa_2026: "A quadra de areia foi desativada." }), filhas: FILHAS, setor: SETOR, unidades: UNIDADES },
    },
    {
        nome: "muitas-metas-e-textos-longos",
        dados: {
            projeto: linha({
                nome: "Programa de Formação Continuada em Tecnologia, Inovação e Cidadania Digital para Juventudes das Periferias de Fortaleza",
                justificativa_2026: longo("A demanda por formação em tecnologia cresceu muito entre os jovens atendidos, e as turmas de 2026 lotaram rapidamente.", 9),
                mudancas_2026: longo("Novos módulos de programação e robótica.", 12),
                objetivo_geral: longo("Formar jovens para o mercado de tecnologia.", 10),
                como_sera_realizado: longo("Turmas semestrais com aulas práticas, mentorias e projetos finais apresentados à comunidade.", 8),
                observacoes: longo("Depende da renovação do convênio com a universidade parceira e da chegada dos novos computadores.", 25),
            }),
            filhas: {
                ...FILHAS,
                objetivos: Array.from({ length: 8 }, (_, i) => ({ ordem: i + 1, texto: `Objetivo específico número ${i + 1}, com um texto de tamanho médio para testar a lista` })),
                metas: Array.from({ length: 9 }, (_, i) => ({ ordem: i + 1, meta: `Meta ${i + 1}: ${longo("concluir as turmas planejadas", 4)}`, indicador: "Lista de presença e certificados emitidos", resultado_esperado: `${(i + 1) * 20} jovens certificados` })),
            },
            setor: { id: "educacao_tecnologia", nome: "Educação e Tecnologia", cor: "#0891b2" },
            unidades: UNIDADES,
        },
    },
]

// Pior caso: textos muito longos, em MAIÚSCULAS (mais largas que o texto comum na Helvetica), nome de
// 200 caracteres, responsável de 120, valores máximos. Nada é cortado: tudo continua em outros slides.
const MAIUSCULAS = "PROGRAMAÇÃO ESPORTIVA COM MODALIDADES COLETIVAS E INDIVIDUAIS NAS UNIDADES DA REDE "
const caps = (n: number) => MAIUSCULAS.repeat(Math.ceil(n / MAIUSCULAS.length)).slice(0, n).trimEnd().padEnd(n, "M")
CASOS.push({
    nome: "pior-caso-maiusculas",
    dados: {
        projeto: linha({
            nome: caps(200),
            responsavel_nome: caps(120), responsavel_contato: caps(60),
            mudancas_2026: caps(900), justificativa_2026: caps(900),
            objetivo_geral: caps(800), publico_alvo: caps(500),
            participantes_estimados: 2_000_000_000, duracao: caps(40),
            frequencia: "outra", frequencia_outra: caps(300), dias_horarios: caps(300),
            local_outro: true, local_outro_texto: caps(300), como_sera_realizado: caps(1500),
            resultados_2026_participantes: 1_999_999_999,
            resultados_2026_principais: caps(700), resultados_2026_funcionou: caps(700),
            resultados_2026_melhorar: caps(700), observacoes: caps(2500),
        }),
        filhas: {
            objetivos: Array.from({ length: 9 }, (_, i) => ({ ordem: i + 1, texto: caps(220) })),
            orcamento: Array.from({ length: 7 }, (_, i) => ({ ordem: i + 1, item: caps(200), categoria: (["material", "espaco", "transporte", "alimentacao", "divulgacao", "servicos", "outros"] as const)[i], quantidade: 9_999_999, valor_unitario: 99_999 })),
            metas: Array.from({ length: 6 }, (_, i) => ({ ordem: i + 1, meta: caps(300), indicador: caps(300), resultado_esperado: caps(300) })),
        },
        setor: { id: "educacao_tecnologia", nome: "Educação e Tecnologia", cor: "#0891b2" },
        unidades: UNIDADES,
    },
})

// Padrões encontrados nos projetos reais (varredura de 2026-11-18), com dados sintéticos.
const linhasCurtas = Array.from({ length: 45 }, (_, i) => i % 7 === 0 ? "" : `Atividade ${i}: oficina prática com os estudantes.`).join("\n")
CASOS.push({
    nome: "padroes-reais",
    dados: {
        projeto: linha({
            nome: "OLIMPIADAS DA JUVENTUDE  DE FORTALEZA 2027", situacao_2026: "mantem", mudancas_2026: null, justificativa_2026: null,
            objetivo_geral: "O evento é realizado em alusão ao Dia Internacional da Juventude.\n \t\nPromover a maior virada cultural,  esportiva e de cidadania da cidade, com 35 horas de programação gratuita.",
            publico_alvo: "Sendo 100% aberto a comunidade.", data_inicio: "2027-08-06", data_fim: "2027-09-03", duracao: "4 semanas", frequencia: "semanal", dias_horarios: "36h",
            como_sera_realizado: linhasCurtas, observacoes: "-----", resultados_2026_principais: "-----",
        }),
        filhas: {
            objetivos: [],
            orcamento: [
                { ordem: 1, item: "30000", categoria: null, quantidade: null, valor_unitario: null },
                { ordem: 2, item: "MEDALHAS", categoria: "material", quantidade: 750, valor_unitario: null },
                ...Array.from({ length: 16 }, (_, i) => ({ ordem: i + 3, item: String(i + 1), categoria: (["servicos", "material", "alimentacao", "outros", "espaco", "transporte", "divulgacao"] as const)[i % 7], quantidade: i + 1, valor_unitario: 100 * (i + 1) })),
                { ordem: 20, item: "Item sem categoria", categoria: null, quantidade: 1, valor_unitario: 50 },
                { ordem: 21, item: null, categoria: null, quantidade: null, valor_unitario: null },
            ],
            metas: [
                { ordem: 1, meta: "7", indicador: "Garantir que 75% das atrações culturais e esportivas (música, dança, literatura) sejam compostas por artistas, grupos e coletivos da própria juventude de Fortaleza", resultado_esperado: null },
                { ordem: 2, meta: "8", indicador: "Atender 750 participantes no Circuito de Corridas da Rede Cuca", resultado_esperado: "750" },
            ],
        },
        setor: { id: "cultura", nome: "Cultura", cor: "#db2777" },
        unidades: UNIDADES,
    },
})

function paginas(pdf: Buffer): number {
    return (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

describe("PDF dos slides (AC7)", () => {
    for (const caso of CASOS) {
        it(`${caso.nome}: um slide por página, e nenhum corpo passa da área de conteúdo`, async () => {
            const r = montarSlides(caso.dados, "pdf")
            if (r.tipo !== "ok") throw new Error("esperava slides")
            const pdf = await renderToBuffer(createElement(SlidesPdfDocument, { apresentacao: r, logo: LOGO, titulo: caso.nome }) as never)
            expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
            expect(paginas(pdf)).toBe(r.slides.length)
            const corpos = await renderToBuffer(createElement(CorposPdfDocument, { apresentacao: r, logo: LOGO }) as never)
            expect(paginas(corpos)).toBe(r.slides.filter(sl => sl.tipo !== "capa" && sl.tipo !== "encerramento").length)
            if (PASTA) {
                mkdirSync(PASTA, { recursive: true })
                writeFileSync(join(PASTA, `slides-${caso.nome}.pdf`), pdf)
            }
        }, 60_000)
    }
    it("o detector pega estouro: um corpo maior que a área vira duas páginas", async () => {
        const r = montarSlides(CASOS[0].dados, "pdf")
        if (r.tipo !== "ok") throw new Error("esperava slides")
        const grande = { ...r, slides: [{ tipo: "observacoes" as const, texto: Array.from({ length: 40 }, (_, i) => `linha ${i}`).join("\n"), tamanho: 13, id: "o", titulo: "Obs" }] }
        const pdf = await renderToBuffer(createElement(CorposPdfDocument, { apresentacao: grande, logo: LOGO }) as never)
        expect(paginas(pdf)).toBeGreaterThan(1)
    }, 30_000)
})

describe("PDF da ficha (AC8)", () => {
    for (const ficha of ["final", "parcial"] as const) {
        it(`ficha ${ficha}: gera A4 retrato`, async () => {
            const d = CASOS[0].dados
            const pdf = await renderToBuffer(createElement(FichaPdfDocument, {
                projeto: { ...d.projeto, ficha }, filhas: d.filhas, setor: d.setor, unidades: d.unidades, logo: LOGO,
            }) as never)
            expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
            expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0 0 595\.\d+ 841\.\d+\s*\]/)
            if (PASTA) writeFileSync(join(PASTA, `ficha-${ficha}.pdf`), pdf)
        }, 30_000)
    }
})
