// S-PLA-05: regras puras dos slides do projeto (sem React, sem Supabase). Uma fonte de verdade: este
// módulo decide QUAIS slides existem e O QUE cada um mostra; a tela (componentes) e o PDF (react-pdf)
// só desenham. Assim os dois nunca divergem.
//
// - Só há slides com a ficha final (D7). Ficha parcial → nenhum slide.
// - Slide sem dado não aparece; nunca há "não informado" nem "R$ 0,00" solto (AC4).
// - Texto longo: na tela é cortado com reticências; no PDF o resto vai para slides de continuação (AC5).
// - O texto daqui não usa símbolos que a fonte padrão do PDF não desenha (setas, "✔", emojis): o
//   desenho cuida disso com formas.

import { mesesDoPeriodo, rotuloPeriodo } from "./lista"
import {
    ANO_PLANEJAMENTO, camposDaSituacao, rotuloCategoria, rotuloFrequencia, rotuloSituacao, rotuloTipo,
    type FilhasProjeto, type LinhaProjeto, type Situacao2026,
} from "./projeto"

// ── Grade de desenho ─────────────────────────────────────────────────────────────────────────

// Todo slide é desenhado numa grade de 960 × 540 (16:9). No PDF, 1 unidade = 1 ponto. Na tela, a
// grade escala com a largura do slide (miniaturas incluídas).
export const LARGURA_SLIDE = 960
export const ALTURA_SLIDE = 540

// ── Entrada ──────────────────────────────────────────────────────────────────────────────────

export type SetorSlides = { id: string; nome: string; cor: string }
export type DadosSlides = {
    projeto: LinhaProjeto
    filhas: FilhasProjeto
    setor: SetorSlides | null
    unidades: { id: string; nome: string }[]
}
export type ModoSlides = "tela" | "pdf"

// ── Saída ────────────────────────────────────────────────────────────────────────────────────

export type Bloco = { rotulo: string; texto: string }
export type Cartao = { rotulo: string; valor: string }
export type MetaSlide = { meta: string | null; indicador: string | null; esperado: string | null }
export type Fatia = { chave: string; rotulo: string; valor: number; valorTexto: string; percentual: number; cor: string }
export type Barra = { rotulo: string; valor: number; valorTexto: string; proporcao: number }

export type ConteudoSlide =
    | { tipo: "capa"; nome: string; tipoProjeto: string; responsavel: string | null }
    | { tipo: "numeros"; cartoes: Cartao[] }
    | { tipo: "porque"; situacao: Situacao2026; selo: string; blocos: Bloco[] }
    | { tipo: "objetivos"; objetivoGeral: string | null; especificos: string[]; maisEspecificos: number; publico: string | null; faixa: string | null }
    | { tipo: "execucao"; linhaDoTempo: { anoTodo: boolean; meses: number[] } | null; periodo: string | null; itens: Bloco[]; como: string | null }
    | { tipo: "orcamento"; total: string; fatias: Fatia[]; maiores: Cartao[] }
    | { tipo: "metas"; metas: MetaSlide[]; parte: number; partes: number; inicio: number; layout: "grade" | "lista" }
    | { tipo: "aprendizados"; barras: Barra[]; blocos: Bloco[] }
    | { tipo: "observacoes"; texto: string }
    | { tipo: "encerramento"; responsavel: string | null; contato: string | null }
    | { tipo: "continuacao"; de: TipoSlide; blocos: Bloco[] }

export type TipoSlide = ConteudoSlide["tipo"]
export type Slide = ConteudoSlide & { id: string; titulo: string }

export type Apresentacao = {
    cor: string
    corTexto: string
    rodape: string
    setor: string
    slides: Slide[]
}

export type ResultadoSlides = { tipo: "ficha_parcial" } | ({ tipo: "ok" } & Apresentacao)

export const TITULOS: Record<TipoSlide, string> = {
    capa: "Capa",
    numeros: "Números do projeto",
    porque: "Por que este projeto",
    objetivos: "Objetivos e público",
    execucao: "Como vai acontecer",
    orcamento: "Orçamento",
    metas: "Metas e indicadores",
    aprendizados: "O que aprendemos em 2026",
    observacoes: "Riscos e observações",
    encerramento: "Encerramento",
    continuacao: "Continuação",
}

// ── Limites de texto (em caracteres) por campo ──────────────────────────────────────────────
// Medidos para a grade 960 × 540 com a tipografia dos componentes. Acima do limite: reticências
// na tela; no PDF, o resto vai para a continuação.

export const LIMITES = {
    porqueUnico: 700,
    porqueDuplo: 340,
    objetivoGeral: 240,
    especifico: 110,
    especificosPorSlide: 5,
    publico: 150,
    itemExecucao: 110,
    como: 360,
    meta: 110,
    aprendizado: 230,
    observacoes: 950,
    continuacao: 1200,
} as const

export const METAS_POR_SLIDE = 4
// Meta com algum campo acima disto não cabe no cartão da grade 2 × 2: as metas passam a 2 por slide,
// em cartões da largura toda.
export const META_CURTA = 55
export const METAS_POR_SLIDE_LISTA = 2
// No PDF, uma sobra menor que isto fica no próprio slide (os limites têm folga para ela): evita um
// slide de continuação com uma palavra só.
export const FOLGA_PDF = 30
export const MAIORES_ITENS = 5

// ── Utilitários de texto ─────────────────────────────────────────────────────────────────────

const limpo = (v: string | null | undefined): string | null => {
    const t = (v ?? "").replace(/\r\n?/g, "\n").trim()
    return t === "" ? null : t
}

// Corta em até `limite` caracteres, de preferência num espaço. Devolve [parte, resto].
export function cortarTexto(texto: string, limite: number): [string, string] {
    if (texto.length <= limite) return [texto, ""]
    const janela = texto.slice(0, limite + 1)
    const espaco = Math.max(janela.lastIndexOf(" "), janela.lastIndexOf("\n"))
    const corte = espaco >= limite * 0.6 ? espaco : limite
    return [texto.slice(0, corte).trimEnd(), texto.slice(corte).trimStart()]
}

// Tela: corta com reticências.
export function truncar(texto: string, limite: number): string {
    if (texto.length <= limite) return texto
    return `${cortarTexto(texto, limite - 1)[0]}…`
}

// Acumula o que não coube no slide (só no PDF).
class Sobras {
    blocos: Bloco[] = []
    constructor(private modo: ModoSlides) {}
    texto(rotulo: string, valor: string, limite: number): string {
        if (valor.length <= limite) return valor
        if (this.modo === "tela") return truncar(valor, limite)
        if (valor.length <= limite + FOLGA_PDF) return valor
        const [parte, resto] = cortarTexto(valor, limite)
        this.blocos.push({ rotulo, texto: resto })
        return `${parte}…`
    }
    lista(rotulo: string, itens: string[], porSlide: number, limiteItem: number): { visiveis: string[]; mais: number } {
        const cortados = itens.map(i => this.texto(rotulo, i, limiteItem))
        if (cortados.length <= porSlide) return { visiveis: cortados, mais: 0 }
        if (this.modo === "tela") return { visiveis: cortados.slice(0, porSlide), mais: cortados.length - porSlide }
        this.blocos.push({ rotulo, texto: itens.slice(porSlide).map(i => `• ${i}`).join("\n") })
        return { visiveis: cortados.slice(0, porSlide), mais: 0 }
    }
}

// Reparte os blocos que sobraram em slides de continuação (cada um cabe em `LIMITES.continuacao`).
export function paginarContinuacao(blocos: Bloco[], limite: number = LIMITES.continuacao): Bloco[][] {
    const paginas: Bloco[][] = []
    let atual: Bloco[] = []
    let usado = 0
    const fechar = () => { if (atual.length) paginas.push(atual); atual = []; usado = 0 }
    for (const b of blocos) {
        let resto = b.texto
        while (resto) {
            const espaco = limite - usado - 40 // o rótulo também ocupa lugar
            if (espaco < 200 && atual.length) { fechar(); continue }
            const [parte, sobra] = cortarTexto(resto, Math.max(espaco, 200))
            atual.push({ rotulo: b.rotulo, texto: parte })
            usado += parte.length + 40
            resto = sobra
            if (resto) fechar()
        }
    }
    fechar()
    return paginas
}

// ── Números e cores ──────────────────────────────────────────────────────────────────────────

const numero = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : null
}
export const inteiroBR = (n: number) => Math.round(n).toLocaleString("pt-BR")
// Sem o espaço especial do toLocaleString de moeda (o PDF desenha melhor um espaço comum).
export const reais = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const COR_PADRAO = "#1e3a8a"

function rgb(cor: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(cor.trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = (c: [number, number, number]) => `#${c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`

// Texto legível sobre a cor de destaque: branco nas cores escuras/médias, quase preto nas claras.
export function corTextoSobre(cor: string): string {
    const c = rgb(cor)
    if (!c) return "#ffffff"
    const [r, g, b] = c.map(v => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminancia > 0.45 ? "#0f172a" : "#ffffff"
}

// Tons da cor do setor para as fatias da rosca: do mais forte ao mais claro.
export function tonsDaCor(cor: string, quantidade: number): string[] {
    const base = rgb(cor) ?? rgb(COR_PADRAO)!
    if (quantidade <= 1) return [hex(base)]
    return Array.from({ length: quantidade }, (_, i) => {
        const mistura = (i / (quantidade - 1)) * 0.72
        return hex(base.map(v => v + (255 - v) * mistura) as [number, number, number])
    })
}

// ── Geometria (a mesma para tela e PDF) ──────────────────────────────────────────────────────

const ponto = (cx: number, cy: number, r: number, angulo: number) => {
    const rad = ((angulo - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
const f = (n: number) => Number(n.toFixed(2))

// Caminho SVG de um pedaço de rosca, de `inicio` a `fim` (graus, 0 = topo, sentido horário).
// Pedaço de 179° ou mais é dividido ao meio (recursivamente): um arco de volta inteira não desenha
// nada, e um arco de exatamente meia volta faz o desenhista do PDF dividir por zero ("Infinity").
// Assim uma categoria só (100%) e duas categorias iguais (50% + 50%) também saem certas.
export function caminhoRosca(cx: number, cy: number, rExt: number, rInt: number, inicio: number, fim: number): string {
    if (fim - inicio >= 179) {
        const meio = (inicio + fim) / 2
        return `${caminhoRosca(cx, cy, rExt, rInt, inicio, meio)} ${caminhoRosca(cx, cy, rExt, rInt, meio, fim)}`
    }
    const grande = 0
    const a = ponto(cx, cy, rExt, inicio)
    const b = ponto(cx, cy, rExt, fim)
    const c = ponto(cx, cy, rInt, fim)
    const d = ponto(cx, cy, rInt, inicio)
    return `M ${f(a.x)} ${f(a.y)} A ${rExt} ${rExt} 0 ${grande} 1 ${f(b.x)} ${f(b.y)} L ${f(c.x)} ${f(c.y)} A ${rInt} ${rInt} 0 ${grande} 0 ${f(d.x)} ${f(d.y)} Z`
}

// Separadores brancos entre categorias (no lugar de contorno em cada pedaço, que riscaria por dentro
// uma fatia dividida em partes). Uma categoria só: nenhum separador.
export function separadoresRosca(cx: number, cy: number, rExt: number, rInt: number, angulos: { inicio: number }[]): string[] {
    if (angulos.length <= 1) return []
    return angulos.map(({ inicio }) => {
        const a = ponto(cx, cy, rInt - 1, inicio)
        const b = ponto(cx, cy, rExt + 1, inicio)
        return `M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}`
    })
}

// Ângulos acumulados de cada fatia.
export function angulosDasFatias(fatias: { valor: number }[]): { inicio: number; fim: number }[] {
    const total = fatias.reduce((s, x) => s + x.valor, 0)
    let acumulado = 0
    return fatias.map(x => {
        const inicio = acumulado
        acumulado += total > 0 ? (x.valor / total) * 360 : 0
        return { inicio, fim: acumulado }
    })
}

// Tamanho do nome do projeto na capa, conforme o comprimento (o nome nunca é cortado). Maiúscula
// ocupa mais espaço que minúscula, então pesa mais na conta.
export function tamanhoTituloCapa(nome: string): number {
    const maiusculas = (nome.match(/\p{Lu}/gu) ?? []).length
    const n = nome.length + maiusculas * 0.35
    if (n <= 28) return 54
    if (n <= 50) return 44
    if (n <= 80) return 36
    if (n <= 120) return 30
    return 24
}

// Topo do bloco de texto da capa: sobe quando o nome é grande, para caber tudo.
export function topoCapa(nome: string): number {
    return tamanhoTituloCapa(nome) <= 30 ? 116 : 140
}
// Espaço acima e abaixo da barrinha da capa: menor quando o nome ocupa muitas linhas.
export function respiroCapa(nome: string): number {
    return tamanhoTituloCapa(nome) <= 24 ? 14 : 22
}

// Tamanho do texto corrido conforme a quantidade (texto curto fica maior, com menos espaço vazio).
export function tamanhoTexto(caracteres: number): number {
    if (caracteres <= 250) return 17
    if (caracteres <= 500) return 15
    return 13
}

// Valor dos cartões de números: diminui para caber numa linha.
export function tamanhoValorCartao(valor: string): number {
    return valor.length > 9 ? 26 : 34
}

// ── Nomes de arquivo ─────────────────────────────────────────────────────────────────────────

export function slug(texto: string): string {
    return texto.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "projeto"
}

// `planejamento-2027_{setor}_{nome-do-projeto}.pdf` (AC7). O `_` só separa as três partes.
export function nomeArquivoSlides(setor: string, projeto: string, ano = ANO_PLANEJAMENTO): string {
    return `planejamento-${ano}_${slug(setor)}_${slug(projeto)}.pdf`
}
export function nomeArquivoFicha(setor: string, projeto: string, ano = ANO_PLANEJAMENTO): string {
    return `ficha-planejamento-${ano}_${slug(setor)}_${slug(projeto)}.pdf`
}

// ── Montagem ─────────────────────────────────────────────────────────────────────────────────

type ItemOrcamento = { nome: string; categoria: string; valor: number }

export function itensDoOrcamento(filhas: FilhasProjeto): ItemOrcamento[] {
    return [...filhas.orcamento].sort((a, b) => a.ordem - b.ordem).map(o => {
        const q = numero(o.quantidade) ?? 0
        const v = numero(o.valor_unitario) ?? 0
        return {
            nome: limpo(o.item) ?? (rotuloCategoria(o.categoria) || "Item"),
            categoria: o.categoria ?? "sem_categoria",
            valor: Math.round(q * v * 100) / 100,
        }
    })
}

// Rosca por categoria, só com valores acima de zero, da maior para a menor.
export function agruparPorCategoria(itens: ItemOrcamento[], cor: string): Fatia[] {
    const somas = new Map<string, number>()
    for (const i of itens) if (i.valor > 0) somas.set(i.categoria, (somas.get(i.categoria) ?? 0) + i.valor)
    const total = [...somas.values()].reduce((s, v) => s + v, 0)
    const ordenadas = [...somas.entries()].sort((a, b) => b[1] - a[1])
    const tons = tonsDaCor(cor, ordenadas.length)
    return ordenadas.map(([chave, valor], i) => ({
        chave,
        rotulo: rotuloCategoria(chave) || "Sem categoria",
        valor: Math.round(valor * 100) / 100,
        valorTexto: reais(valor),
        percentual: total > 0 ? Math.round((valor / total) * 1000) / 10 : 0,
        cor: tons[i],
    }))
}

export function metasValidas(filhas: FilhasProjeto): MetaSlide[] {
    return [...filhas.metas].sort((a, b) => a.ordem - b.ordem)
        .map(m => ({ meta: limpo(m.meta), indicador: limpo(m.indicador), esperado: limpo(m.resultado_esperado) }))
        .filter(m => m.meta || m.indicador || m.esperado)
}

function faixaEtaria(min: number | null, max: number | null): string | null {
    if (min === null && max === null) return null
    if (min !== null && max !== null) return `${min} a ${max} anos`
    return min !== null ? `A partir de ${min} anos` : `Até ${max} anos`
}

export function montarSlides(dados: DadosSlides, modo: ModoSlides): ResultadoSlides {
    const p = dados.projeto
    if (p.ficha !== "final") return { tipo: "ficha_parcial" }

    const cor = dados.setor && rgb(dados.setor.cor) ? dados.setor.cor : COR_PADRAO
    const setorNome = dados.setor?.nome ?? ""
    const situacao = p.situacao_2026
    const encerrado = situacao === "encerrado"
    const saida: ConteudoSlide[] = []

    // Adiciona o slide e, no PDF, as continuações do que não coube nele.
    const adicionar = (conteudo: ConteudoSlide, sobras: Sobras) => {
        saida.push(conteudo)
        for (const blocos of paginarContinuacao(sobras.blocos)) saida.push({ tipo: "continuacao", de: conteudo.tipo, blocos })
    }
    const novo = () => new Sobras(modo)

    const itensOrc = itensDoOrcamento(dados.filhas)
    const totalOrc = Math.round(itensOrc.reduce((s, i) => s + i.valor, 0) * 100) / 100
    const metas = metasValidas(dados.filhas)
    const periodo = rotuloPeriodo(p) || null
    const duracao = limpo(p.duracao)

    // 1. Capa
    // O responsável aparece inteiro no Encerramento; na capa, até 40 caracteres.
    const responsavel = limpo(p.responsavel_nome)
    saida.push({ tipo: "capa", nome: p.nome, tipoProjeto: rotuloTipo(p.tipo), responsavel: responsavel ? truncar(responsavel, 40) : null })

    // 2. Números (com pelo menos 2 preenchidos)
    if (!encerrado) {
        const cartoes: Cartao[] = []
        if (p.participantes_estimados !== null) cartoes.push({ rotulo: "Participantes estimados", valor: inteiroBR(p.participantes_estimados) })
        if (totalOrc > 0) cartoes.push({ rotulo: "Orçamento total", valor: reais(totalOrc) })
        if (duracao) cartoes.push({ rotulo: "Duração", valor: truncar(duracao, 40) })
        else if (periodo) cartoes.push({ rotulo: "Período", valor: periodo })
        if (metas.length > 0) cartoes.push({ rotulo: metas.length === 1 ? "Meta" : "Metas", valor: String(metas.length) })
        if (cartoes.length >= 2) saida.push({ tipo: "numeros", cartoes })
    }

    // 3. Por que este projeto (com a situação preenchida)
    if (situacao) {
        const s = novo()
        const campos = camposDaSituacao(situacao)
        const brutos: Bloco[] = []
        const mudancas = limpo(p.mudancas_2026)
        const justificativa = limpo(p.justificativa_2026)
        if (campos.mudancas && mudancas) brutos.push({ rotulo: "O que muda", texto: mudancas })
        if (campos.justificativa && justificativa) brutos.push({ rotulo: campos.rotuloJustificativa.replace(" (justificativa)", ""), texto: justificativa })
        const limite = brutos.length > 1 ? LIMITES.porqueDuplo : LIMITES.porqueUnico
        const blocos = brutos.map(b => ({ rotulo: b.rotulo, texto: s.texto(b.rotulo, b.texto, limite) }))
        adicionar({ tipo: "porque", situacao, selo: rotuloSituacao(situacao).toUpperCase(), blocos }, s)
    }

    if (!encerrado) {
        // 4. Objetivos e público
        const objetivoGeral = limpo(p.objetivo_geral)
        const especificos = [...dados.filhas.objetivos].sort((a, b) => a.ordem - b.ordem).map(o => limpo(o.texto)).filter((t): t is string => !!t)
        if (objetivoGeral || especificos.length > 0) {
            const s = novo()
            const lista = s.lista("Objetivos específicos", especificos, LIMITES.especificosPorSlide, LIMITES.especifico)
            const publico = limpo(p.publico_alvo)
            adicionar({
                tipo: "objetivos",
                objetivoGeral: objetivoGeral ? s.texto("Objetivo geral", objetivoGeral, LIMITES.objetivoGeral) : null,
                especificos: lista.visiveis,
                maisEspecificos: lista.mais,
                publico: publico ? s.texto("Público-alvo", publico, LIMITES.publico) : null,
                faixa: faixaEtaria(p.faixa_etaria_min, p.faixa_etaria_max),
            }, s)
        }

        // 5. Como vai acontecer
        const onde = mesesDoPeriodo(p)
        const como = limpo(p.como_sera_realizado)
        if (onde.tipo !== "sem_periodo" || como) {
            const s = novo()
            const itens: Bloco[] = []
            const frequencia = p.frequencia === "outra" ? (limpo(p.frequencia_outra) ?? "Outra") : (rotuloFrequencia(p.frequencia) || null)
            const nomesUnidades = (p.locais_unidades ?? []).map(id => dados.unidades.find(u => u.id === id)?.nome).filter((n): n is string => !!n)
            const local = [...nomesUnidades, ...(p.local_outro && limpo(p.local_outro_texto) ? [limpo(p.local_outro_texto) as string] : [])].join(", ")
            const dias = limpo(p.dias_horarios)
            if (frequencia) itens.push({ rotulo: "Frequência", texto: frequencia })
            if (dias) itens.push({ rotulo: "Dias e horários", texto: dias })
            if (local) itens.push({ rotulo: "Local", texto: local })
            adicionar({
                tipo: "execucao",
                linhaDoTempo: onde.tipo === "ano_todo" ? { anoTodo: true, meses: [] } : onde.tipo === "meses" ? { anoTodo: false, meses: onde.meses } : null,
                periodo: onde.tipo === "sem_periodo" ? null : [periodo, duracao && duracao !== periodo ? duracao : null].filter(Boolean).join(" · "),
                itens: itens.map(i => ({ rotulo: i.rotulo, texto: s.texto(i.rotulo, i.texto, LIMITES.itemExecucao) })),
                como: como ? s.texto("Como será realizado", como, LIMITES.como) : null,
            }, s)
        }

        // 6. Orçamento (com pelo menos 1 item de valor)
        if (totalOrc > 0) {
            const maiores = itensOrc.filter(i => i.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, MAIORES_ITENS)
                .map(i => ({ rotulo: truncar(i.nome, 60), valor: reais(i.valor) }))
            saida.push({ tipo: "orcamento", total: reais(totalOrc), fatias: agruparPorCategoria(itensOrc, cor), maiores })
        }

        // 7. Metas: 4 por slide (grade 2 × 2); com alguma meta longa, 2 por slide (largura toda)
        const longas = metas.some(m => [m.meta, m.indicador, m.esperado].some(t => (t?.length ?? 0) > META_CURTA))
        const layout: "grade" | "lista" = longas ? "lista" : "grade"
        const porSlide = longas ? METAS_POR_SLIDE_LISTA : METAS_POR_SLIDE
        const partes = Math.ceil(metas.length / porSlide)
        for (let i = 0; i < partes; i++) {
            const s = novo()
            const doSlide = metas.slice(i * porSlide, (i + 1) * porSlide).map((m, j) => {
                const n = i * porSlide + j + 1
                const corta = (rotulo: string, v: string | null) => (v ? s.texto(`Meta ${n} — ${rotulo}`, v, LIMITES.meta) : null)
                return { meta: corta("meta", m.meta), indicador: corta("como será medido", m.indicador), esperado: corta("esperado", m.esperado) }
            })
            adicionar({ tipo: "metas", metas: doSlide, parte: i + 1, partes, inicio: i * porSlide + 1, layout }, s)
        }
    }

    // 8. O que aprendemos em 2026 (situação diferente de Novo e algum dado de 2026)
    if (situacao !== "novo") {
        const atendidos = p.resultados_2026_participantes
        const brutos: Bloco[] = [
            { rotulo: "Principais resultados", texto: limpo(p.resultados_2026_principais) ?? "" },
            { rotulo: "O que funcionou", texto: limpo(p.resultados_2026_funcionou) ?? "" },
            { rotulo: "O que melhorar", texto: limpo(p.resultados_2026_melhorar) ?? "" },
        ].filter(b => b.texto !== "")
        if (atendidos !== null || brutos.length > 0) {
            const s = novo()
            const barras: Barra[] = []
            if (atendidos !== null) {
                const valores = [{ rotulo: "2026 atendidos", valor: atendidos }]
                if (!encerrado && p.participantes_estimados !== null) valores.push({ rotulo: "2027 estimados", valor: p.participantes_estimados })
                const maior = Math.max(...valores.map(v => v.valor), 1)
                for (const v of valores) barras.push({ ...v, valorTexto: inteiroBR(v.valor), proporcao: v.valor / maior })
            }
            adicionar({
                tipo: "aprendizados",
                barras,
                blocos: brutos.map(b => ({ rotulo: b.rotulo, texto: s.texto(b.rotulo, b.texto, LIMITES.aprendizado) })),
            }, s)
        }
    }

    // 9. Riscos e observações
    const observacoes = limpo(p.observacoes)
    if (!encerrado && observacoes) {
        const s = novo()
        adicionar({ tipo: "observacoes", texto: s.texto("Observações", observacoes, LIMITES.observacoes) }, s)
    }

    // 10. Encerramento
    saida.push({ tipo: "encerramento", responsavel: limpo(p.responsavel_nome), contato: limpo(p.responsavel_contato) })

    const slides: Slide[] = saida.map((c, i) => ({
        ...c,
        id: `${c.tipo}-${i}`,
        titulo: c.tipo === "continuacao"
            ? `${TITULOS[c.de]} … continuação`
            : c.tipo === "metas" && c.partes > 1 ? `${TITULOS.metas} (${c.parte}/${c.partes})` : TITULOS[c.tipo],
    }))

    return {
        tipo: "ok",
        cor,
        corTexto: corTextoSobre(cor),
        setor: setorNome,
        rodape: setorNome ? `Planejamento ${ANO_PLANEJAMENTO} · ${setorNome}` : `Planejamento ${ANO_PLANEJAMENTO}`,
        slides,
    }
}

export const MENSAGEM_FICHA_PARCIAL = "Este projeto está salvo parcialmente. Os slides só são gerados depois do Salvar projeto"
export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"] as const

// ── Modo apresentar (AC6) ────────────────────────────────────────────────────────────────────

export type AcaoTecla = "proximo" | "anterior" | "inicio" | "fim" | "sair"

// Setas → e ←, espaço, PageDown/PageUp, Home/End e Esc.
export function acaoDaTecla(tecla: string): AcaoTecla | null {
    switch (tecla) {
        case "ArrowRight": case "ArrowDown": case " ": case "Spacebar": case "PageDown": return "proximo"
        case "ArrowLeft": case "ArrowUp": case "PageUp": return "anterior"
        case "Home": return "inicio"
        case "End": return "fim"
        case "Escape": case "Esc": return "sair"
        default: return null
    }
}

// Novo índice depois da ação, sem sair dos limites (no último slide, "próximo" fica onde está).
export function navegar(atual: number, total: number, acao: Exclude<AcaoTecla, "sair">): number {
    if (total <= 0) return 0
    const alvo = acao === "proximo" ? atual + 1 : acao === "anterior" ? atual - 1 : acao === "inicio" ? 0 : total - 1
    return Math.min(Math.max(alvo, 0), total - 1)
}

// "?apresentar=1" abre direto no modo apresentar (só com a permissão e com a ficha final).
export const PARAMETRO_APRESENTAR = "apresentar"
