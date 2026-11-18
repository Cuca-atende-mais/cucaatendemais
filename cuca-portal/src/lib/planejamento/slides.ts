// S-PLA-05 / S-PLA-09: regras puras dos slides do projeto (sem React, sem Supabase). Uma fonte de
// verdade: este módulo decide QUAIS slides existem e O QUE cada um mostra; a tela (componentes) e o PDF
// (react-pdf) só desenham. Assim os dois nunca divergem.
//
// - Só há slides com a ficha final (D7). Ficha parcial → nenhum slide.
// - Slide sem dado não aparece; nunca há "não informado" nem "R$ 0,00" solto (S-PLA-05, AC4).
// - S-PLA-09: tudo o que foi digitado aparece, como foi digitado. Nada é cortado com reticências: o
//   que não cabe num slide continua no seguinte ("… continuação"), na tela e no PDF, com os mesmos
//   slides nos dois. O que cabe é medido pela ALTURA que o texto ocupa (`medida.ts`), não pelo número
//   de caracteres. A única mudança no texto é de espaço em branco, para a diagramação.
// - O texto daqui não usa símbolos que a fonte padrão do PDF não desenha (setas, "✔", emojis): o
//   desenho cuida disso com formas.

import { mesesDoPeriodo } from "./lista"
import { alturaTexto, cortarPorAltura, larguraTexto, type Fonte } from "./medida"
import {
    ANO_PLANEJAMENTO, camposDaSituacao, rotuloCategoria, rotuloFrequencia, rotuloSituacao, rotuloTipo,
    type FilhasProjeto, type LinhaProjeto, type Situacao2026,
} from "./projeto"

// ── Grade de desenho ─────────────────────────────────────────────────────────────────────────

// Todo slide é desenhado numa grade de 960 × 540 (16:9). No PDF, 1 unidade = 1 ponto. Na tela, a
// grade escala com a largura do slide (miniaturas incluídas).
export const LARGURA_SLIDE = 960
export const ALTURA_SLIDE = 540

// Área do conteúdo dos slides com título (entre o título e o rodapé). Os desenhos usam as mesmas medidas.
export const CORPO = { esquerda: 56, topo: 108, largura: 848, altura: 368 } as const

// Medidas compartilhadas com os desenhos (tela e PDF). Mudar aqui muda nos dois.
export const LAYOUT = {
    alturaLinha: 1.45, // texto corrido
    rotulo: { tamanho: 10, espaco: 6 }, // rótulo em maiúsculas acima de cada bloco
    margemBloco: 16,
    continuacao: 13.5,
    porque: { colunaSelo: 280, vao: 40, topo: 10, tamanhos: [17, 15, 13] },
    objetivos: { geral: 17, alturaGeral: 1.35, borda: 20, margemGeral: 18, vao: 30, caixa: 250, caixaPadding: 16, item: 12.5, check: 24, margemItem: 7 },
    execucao: { colunaItens: 300, vao: 30, item: 12.5, caixaPadding: 16 },
    orcamento: { colunaResumo: 260, vao: 28, rosca: 130, fonte: 10.5, alturaFonte: 1.3, paddingLinha: 5, cabecalho: 22, colunas: { qtd: 56, unitario: 96, total: 96, categoria: 92 }, vaoColuna: 8 },
    metas: { grade: 416, lista: 848, alturaGrade: 176, vao: 16, padding: 14, numero: 26, vaoNumero: 12, rotulo: 8.5, texto: 11.5, alturaTexto: 1.3, seta: 13 },
    aprendizados: { colunaBarras: 300, vao: 34, texto: 12 },
    observacoes: { recuo: 22, tamanhos: [17, 15, 13] },
} as const

// ── Entrada ──────────────────────────────────────────────────────────────────────────────────

export type SetorSlides = { id: string; nome: string; cor: string }
export type DadosSlides = {
    projeto: LinhaProjeto
    filhas: FilhasProjeto
    setor: SetorSlides | null
    unidades: { id: string; nome: string }[]
}
// Desde a S-PLA-09 os dois modos geram exatamente os mesmos slides. O parâmetro continua para não
// mudar quem chama (página dos slides e exportação do PDF).
export type ModoSlides = "tela" | "pdf"

// ── Saída ────────────────────────────────────────────────────────────────────────────────────

export type Bloco = { rotulo: string; texto: string }
export type Cartao = { rotulo: string; valor: string }
export type MetaSlide = { meta: string | null; indicador: string | null; esperado: string | null }
export type Fatia = { chave: string; rotulo: string; valor: number; valorTexto: string; percentual: number; cor: string }
export type Barra = { rotulo: string; valor: number; valorTexto: string; proporcao: number }
export type LinhaOrcamento = { item: string; categoria: string; quantidade: string; unitario: string; total: string }
export type ResumoOrcamento = { total: string; fatias: Fatia[] }
export type LayoutCapa = { tamanho: number; topo: number; respiro: number }

export type ConteudoSlide =
    | { tipo: "capa"; nome: string; tipoProjeto: string; responsavel: string | null; layout: LayoutCapa }
    | { tipo: "numeros"; cartoes: Cartao[] }
    | { tipo: "porque"; situacao: Situacao2026; selo: string; blocos: Bloco[]; tamanho: number }
    | { tipo: "objetivos"; objetivoGeral: string | null; especificos: string[]; publico: string | null; faixa: string | null }
    | { tipo: "execucao"; linhaDoTempo: { anoTodo: boolean; meses: number[] } | null; periodo: string | null; itens: Bloco[]; como: string | null }
    | { tipo: "orcamento"; resumo: ResumoOrcamento | null; itens: LinhaOrcamento[]; parte: number }
    | { tipo: "metas"; metas: MetaSlide[]; parte: number; partes: number; inicio: number; layout: "grade" | "lista" }
    | { tipo: "aprendizados"; barras: Barra[]; blocos: Bloco[] }
    | { tipo: "observacoes"; texto: string; tamanho: number }
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

export const METAS_POR_SLIDE = 4

// ── Texto ────────────────────────────────────────────────────────────────────────────────────

// Só espaço em branco muda (AC6c): tabulação vira espaço, espaços seguidos viram um, espaço no início
// e no fim de cada linha sai e mais de uma linha em branco seguida vira uma. Nenhuma letra muda.
export function limparEspacos(v: string | null | undefined): string | null {
    const t = (v ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\t ]/g, " ")
        .replace(/ {2,}/g, " ")
        .split("\n").map(l => l.trim()).join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    return t === "" ? null : t
}
const limpo = limparEspacos

const corrido = (tamanho: number): Fonte => ({ tamanho, altura: LAYOUT.alturaLinha })
const ALTURA_ROTULO = LAYOUT.rotulo.tamanho * 1.25 + LAYOUT.rotulo.espaco

// Altura de um bloco "RÓTULO + texto" com a margem de baixo.
export function alturaBloco(texto: string, largura: number, tamanho: number): number {
    return ALTURA_ROTULO + alturaTexto(texto, largura, corrido(tamanho)) + LAYOUT.margemBloco
}

// Encaixa blocos, em ordem, numa altura. O primeiro que não cabe inteiro é cortado (o resto e todos
// os seguintes vão para `sobra`), para a leitura seguir na ordem.
export function encaixarBlocos(blocos: Bloco[], largura: number, tamanho: number, altura: number): { cabem: Bloco[]; sobra: Bloco[] } {
    const cabem: Bloco[] = []
    const sobra: Bloco[] = []
    let livre = altura
    const linha = tamanho * LAYOUT.alturaLinha
    for (const b of blocos) {
        if (sobra.length) { sobra.push(b); continue }
        const disponivel = livre - ALTURA_ROTULO - LAYOUT.margemBloco
        if (disponivel < linha) { sobra.push(b); continue }
        const [parte, resto] = cortarPorAltura(b.texto, largura, corrido(tamanho), disponivel)
        if (parte) {
            cabem.push({ rotulo: b.rotulo, texto: parte })
            livre -= alturaBloco(parte, largura, tamanho)
        }
        if (resto) sobra.push({ rotulo: b.rotulo, texto: resto })
    }
    return { cabem, sobra }
}

// Maior tamanho de letra (da lista) em que todos os blocos cabem; senão, o menor.
function escolherTamanho(blocos: Bloco[], largura: number, altura: number, tamanhos: readonly number[]): number {
    for (const t of tamanhos) if (blocos.reduce((s, b) => s + alturaBloco(b.texto, largura, t), 0) <= altura) return t
    return tamanhos[tamanhos.length - 1]
}

// Reparte os blocos que sobraram em slides de continuação, pela altura.
export function paginarContinuacao(blocos: Bloco[]): Bloco[][] {
    const paginas: Bloco[][] = []
    let fila = blocos.filter(b => b.texto)
    while (fila.length) {
        let { cabem, sobra } = encaixarBlocos(fila, CORPO.largura, LAYOUT.continuacao, CORPO.altura)
        if (!cabem.length) {
            // Página vazia e nada coube (texto sem quebra possível): força o corte por linha.
            const b = fila[0]
            const fonte = corrido(LAYOUT.continuacao)
            const linhas = Math.max(1, Math.floor((CORPO.altura - ALTURA_ROTULO - LAYOUT.margemBloco) / (fonte.tamanho * fonte.altura)))
            const tamanho = Math.max(1, Math.floor(b.texto.length * linhas / Math.max(1, alturaTexto(b.texto, CORPO.largura, fonte) / (fonte.tamanho * fonte.altura))))
            cabem = [{ rotulo: b.rotulo, texto: b.texto.slice(0, tamanho) }]
            sobra = [{ rotulo: b.rotulo, texto: b.texto.slice(tamanho) }, ...fila.slice(1)].filter(x => x.texto)
        }
        paginas.push(cabem)
        fila = sobra
    }
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
const quantidadeBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })

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

// ── Capa ─────────────────────────────────────────────────────────────────────────────────────

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

export const CAPA = { largura: 470, rodape: 52, alturaTitulo: 1.1 } as const

// Altura do bloco de texto da capa (rótulo, nome, barrinha, selos e responsável).
function alturaCapa(nome: string, responsavel: string | null, tamanho: number, respiro: number): number {
    const titulo = alturaTexto(nome, CAPA.largura, { tamanho, altura: CAPA.alturaTitulo, negrito: true })
    const resp = responsavel ? respiro + 4 + ALTURA_ROTULO + alturaTexto(responsavel, CAPA.largura, { tamanho: 16, altura: 1.25, negrito: true }) : 0
    return 12 * 1.25 + LAYOUT.rotulo.espaco + 6 + titulo + 2 * respiro + 5 + 30 + resp
}

// Tamanho do nome, topo do bloco e respiro: começa pelo tamanho pelo comprimento e diminui até o
// bloco inteiro caber acima do rodapé (nome e responsável inteiros, sem corte).
export function layoutCapa(nome: string, responsavel: string | null): LayoutCapa {
    const tamanhos = [54, 44, 36, 30, 24, 20, 18, 16, 14, 12, 11, 10]
    const inicial = tamanhoTituloCapa(nome)
    let ultimo: LayoutCapa = { tamanho: inicial, topo: 116, respiro: 14 }
    for (const tamanho of tamanhos.filter(t => t <= inicial)) {
        const respiro = tamanho <= 24 ? 14 : 22
        // Nunca acima de 116: o logo da capa ocupa até 104.
        for (const topo of tamanho <= 30 ? [116] : [140, 116]) {
            ultimo = { tamanho, topo, respiro }
            if (topo + alturaCapa(nome, responsavel, tamanho, respiro) <= ALTURA_SLIDE - CAPA.rodape) return ultimo
        }
    }
    return ultimo
}

// ── Cartões de números ───────────────────────────────────────────────────────────────────────

// Valor dos cartões: o maior tamanho em que o valor cabe numa linha, conforme a quantidade de cartões.
export function tamanhoValorCartao(valor: string, quantidade: number): number {
    const largura = (CORPO.largura - 20 * (quantidade - 1)) / Math.max(1, quantidade) - 36 - 4
    for (const t of [34, 30, 26, 22, 18, 16, 14, 12]) if (larguraTexto(valor, t, true) <= largura) return t
    return 12
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

// ── Datas ────────────────────────────────────────────────────────────────────────────────────

function dataBR(v: string | null | undefined): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "")
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

// Datas como foram digitadas (AC4): "10/04/2027", "06/08/2027 a 03/09/2027", "Ano todo". Só uma
// data → ela sozinha. Final antes da inicial → as duas, na ordem digitada.
export function periodoExato(p: Pick<LinhaProjeto, "periodo_ano_todo" | "data_inicio" | "data_fim">): string | null {
    if (p.periodo_ano_todo) return "Ano todo"
    const ini = dataBR(p.data_inicio)
    const fim = dataBR(p.data_fim)
    if (ini && fim) return ini === fim ? ini : `${ini} a ${fim}`
    return ini ?? fim
}

// ── Orçamento ────────────────────────────────────────────────────────────────────────────────

type ItemOrcamento = { nome: string; categoria: string; valor: number }

// Itens com valor (quantidade × valor unitário), para o total e a rosca.
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

const VAZIO = "—"

// Todas as linhas do orçamento, como foram digitadas (AC3). Campo vazio = "—"; linha toda vazia sai.
export function linhasDoOrcamento(filhas: FilhasProjeto): LinhaOrcamento[] {
    return [...filhas.orcamento].sort((a, b) => a.ordem - b.ordem).flatMap(o => {
        const item = limpo(o.item)
        const q = numero(o.quantidade)
        const v = numero(o.valor_unitario)
        if (!item && !o.categoria && q === null && v === null) return []
        return [{
            item: item ?? VAZIO,
            categoria: o.categoria ? (rotuloCategoria(o.categoria) || o.categoria) : VAZIO,
            quantidade: q === null ? VAZIO : quantidadeBR(q),
            unitario: v === null ? VAZIO : reais(v),
            total: q === null || v === null ? VAZIO : reais(Math.round(q * v * 100) / 100),
        }]
    })
}

const O = LAYOUT.orcamento
const fonteTabela: Fonte = { tamanho: O.fonte, altura: O.alturaFonte }
// Largura da coluna do item numa tabela de largura `largura`.
export function larguraColunaItem(largura: number): number {
    const c = O.colunas
    return largura - c.qtd - c.unitario - c.total - c.categoria - 4 * O.vaoColuna
}
// Altura de uma linha da tabela: a célula mais alta manda.
export function alturaLinhaOrcamento(l: LinhaOrcamento, largura: number): number {
    const c = O.colunas
    const linhas = Math.max(
        alturaTexto(l.item, larguraColunaItem(largura), fonteTabela),
        alturaTexto(l.categoria, c.categoria, fonteTabela),
        alturaTexto(l.quantidade, c.qtd, fonteTabela),
        alturaTexto(l.unitario, c.unitario, fonteTabela),
        alturaTexto(l.total, c.total, fonteTabela),
    )
    return linhas + 2 * O.paddingLinha + 1
}
export const larguraTabelaComResumo = CORPO.largura - O.colunaResumo - O.vao

// ── Metas ────────────────────────────────────────────────────────────────────────────────────

const M = LAYOUT.metas
type ParteMeta = "meta" | "indicador" | "esperado"
const PARTES_META: { chave: ParteMeta; rotulo: string; negrito: boolean }[] = [
    { chave: "meta", rotulo: "meta", negrito: true },
    { chave: "indicador", rotulo: "como será medido", negrito: false },
    { chave: "esperado", rotulo: "esperado", negrito: true },
]
const larguraTextoMeta = (largura: number) => largura - 2 * M.padding - 2 - M.numero - M.vaoNumero
const fonteMeta = (negrito: boolean): Fonte => ({ tamanho: M.texto, altura: M.alturaTexto, negrito })

export function alturaMeta(m: MetaSlide, largura: number): number {
    const presentes = PARTES_META.filter(p => m[p.chave])
    const conteudo = presentes.reduce((s, p) => s + M.rotulo * 1.25 + alturaTexto(m[p.chave] as string, larguraTextoMeta(largura), fonteMeta(p.negrito)), 0)
        + Math.max(0, presentes.length - 1) * M.seta
    return Math.max(M.numero, conteudo) + 2 * M.padding + 2
}

export function metasValidas(filhas: FilhasProjeto): MetaSlide[] {
    return [...filhas.metas].sort((a, b) => a.ordem - b.ordem)
        .map(m => ({ meta: limpo(m.meta), indicador: limpo(m.indicador), esperado: limpo(m.resultado_esperado) }))
        .filter(m => m.meta || m.indicador || m.esperado)
}

// Meta grande demais para um slide inteiro: o que cabe fica no cartão, o resto vai para a continuação.
function cortarMeta(m: MetaSlide, n: number, altura: number): { meta: MetaSlide; sobra: Bloco[] } {
    const largura = larguraTextoMeta(M.lista)
    let livre = altura - 2 * M.padding - 2
    const saida: MetaSlide = { meta: null, indicador: null, esperado: null }
    const sobra: Bloco[] = []
    for (const p of PARTES_META) {
        const texto = m[p.chave]
        if (!texto) continue
        if (sobra.length) { sobra.push({ rotulo: `Meta ${n} — ${p.rotulo}`, texto }); continue }
        const disponivel = livre - M.rotulo * 1.25 - M.seta
        const [parte, resto] = disponivel > 0 ? cortarPorAltura(texto, largura, fonteMeta(p.negrito), disponivel) : ["", texto]
        if (parte) {
            saida[p.chave] = parte
            livre -= M.rotulo * 1.25 + M.seta + alturaTexto(parte, largura, fonteMeta(p.negrito))
        }
        if (resto) sobra.push({ rotulo: `Meta ${n} — ${p.rotulo}`, texto: resto })
    }
    return { meta: saida, sobra }
}

function faixaEtaria(min: number | null, max: number | null): string | null {
    if (min === null && max === null) return null
    if (min !== null && max !== null) return `${min} a ${max} anos`
    return min !== null ? `A partir de ${min} anos` : `Até ${max} anos`
}

// ── Montagem ─────────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o modo é aceito por compatibilidade; os dois são iguais (S-PLA-09)
export function montarSlides(dados: DadosSlides, _modo: ModoSlides = "tela"): ResultadoSlides {
    const p = dados.projeto
    if (p.ficha !== "final") return { tipo: "ficha_parcial" }

    const cor = dados.setor && rgb(dados.setor.cor) ? dados.setor.cor : COR_PADRAO
    const setorNome = dados.setor?.nome ?? ""
    const situacao = p.situacao_2026
    const encerrado = situacao === "encerrado"
    const saida: ConteudoSlide[] = []

    // Adiciona o slide e, logo depois, as continuações do que não coube nele.
    const adicionar = (conteudo: ConteudoSlide, sobra: Bloco[]) => {
        saida.push(conteudo)
        for (const blocos of paginarContinuacao(sobra)) saida.push({ tipo: "continuacao", de: conteudo.tipo, blocos })
    }

    const itensOrc = itensDoOrcamento(dados.filhas)
    const totalOrc = Math.round(itensOrc.reduce((s, i) => s + i.valor, 0) * 100) / 100
    const metas = metasValidas(dados.filhas)
    const periodo = periodoExato(p)
    const duracao = limpo(p.duracao)
    const responsavel = limpo(p.responsavel_nome)
    const nome = limpo(p.nome) ?? p.nome

    // 1. Capa (nome e responsável inteiros; o tamanho do nome se ajusta para caber)
    saida.push({ tipo: "capa", nome, tipoProjeto: rotuloTipo(p.tipo), responsavel, layout: layoutCapa(nome, responsavel) })

    // 2. Números (com pelo menos 2 preenchidos)
    if (!encerrado) {
        const cartoes: Cartao[] = []
        if (p.participantes_estimados !== null) cartoes.push({ rotulo: "Participantes estimados", valor: inteiroBR(p.participantes_estimados) })
        if (totalOrc > 0) cartoes.push({ rotulo: "Orçamento total", valor: reais(totalOrc) })
        if (duracao) cartoes.push({ rotulo: "Duração", valor: duracao })
        else if (periodo) cartoes.push({ rotulo: "Período", valor: periodo })
        if (metas.length > 0) cartoes.push({ rotulo: metas.length === 1 ? "Meta" : "Metas", valor: String(metas.length) })
        if (cartoes.length >= 2) saida.push({ tipo: "numeros", cartoes })
    }

    // 3. Por que este projeto (com a situação preenchida)
    if (situacao) {
        const P = LAYOUT.porque
        const campos = camposDaSituacao(situacao)
        const brutos: Bloco[] = []
        const mudancas = limpo(p.mudancas_2026)
        const justificativa = limpo(p.justificativa_2026)
        if (campos.mudancas && mudancas) brutos.push({ rotulo: "O que muda", texto: mudancas })
        if (campos.justificativa && justificativa) brutos.push({ rotulo: campos.rotuloJustificativa.replace(" (justificativa)", ""), texto: justificativa })
        const largura = CORPO.largura - P.colunaSelo - P.vao
        const altura = CORPO.altura - P.topo
        const tamanho = escolherTamanho(brutos, largura, altura, P.tamanhos)
        const { cabem, sobra } = encaixarBlocos(brutos, largura, tamanho, altura)
        adicionar({ tipo: "porque", situacao, selo: rotuloSituacao(situacao).toUpperCase(), blocos: cabem, tamanho }, sobra)
    }

    if (!encerrado) {
        // 4. Objetivos e público
        const objetivoGeral = limpo(p.objetivo_geral)
        const especificos = [...dados.filhas.objetivos].sort((a, b) => a.ordem - b.ordem).map(o => limpo(o.texto)).filter((t): t is string => !!t)
        if (objetivoGeral || especificos.length > 0) adicionar(...slideObjetivos(objetivoGeral, especificos, limpo(p.publico_alvo), faixaEtaria(p.faixa_etaria_min, p.faixa_etaria_max)))

        // 5. Como vai acontecer
        const onde = mesesDoPeriodo(p)
        const como = limpo(p.como_sera_realizado)
        if (onde.tipo !== "sem_periodo" || como) {
            const itens: Bloco[] = []
            const frequencia = p.frequencia === "outra" ? (limpo(p.frequencia_outra) ?? "Outra") : (rotuloFrequencia(p.frequencia) || null)
            const nomesUnidades = (p.locais_unidades ?? []).map(id => dados.unidades.find(u => u.id === id)?.nome).filter((n): n is string => !!n)
            const local = [...nomesUnidades, ...(p.local_outro && limpo(p.local_outro_texto) ? [limpo(p.local_outro_texto) as string] : [])].join(", ")
            const dias = limpo(p.dias_horarios)
            if (frequencia) itens.push({ rotulo: "Frequência", texto: frequencia })
            if (dias) itens.push({ rotulo: "Dias e horários", texto: dias })
            if (local) itens.push({ rotulo: "Local", texto: local })
            const linhaDoTempo = onde.tipo === "ano_todo" ? { anoTodo: true, meses: [] } : onde.tipo === "meses" ? { anoTodo: false, meses: onde.meses } : null
            const textoPeriodo = onde.tipo === "sem_periodo" ? null : [periodo, duracao && duracao !== periodo ? duracao : null].filter(Boolean).join(" · ") || null
            adicionar(...slideExecucao(linhaDoTempo, textoPeriodo, itens, como))
        }

        // 6. Orçamento (com pelo menos 1 linha com algum dado), todas as linhas
        const linhas = linhasDoOrcamento(dados.filhas)
        if (linhas.length > 0) {
            const resumo = totalOrc > 0 ? { total: reais(totalOrc), fatias: agruparPorCategoria(itensOrc, cor) } : null
            for (const s of slidesOrcamento(resumo, linhas)) saida.push(s)
        }

        // 7. Metas: grade 2 × 2 quando todas cabem no cartão pequeno; senão, cartões da largura toda,
        //    quantos couberem por slide.
        if (metas.length > 0) for (const s of slidesMetas(metas)) adicionar(s.slide, s.sobra)
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
            const barras: Barra[] = []
            if (atendidos !== null) {
                const valores = [{ rotulo: "2026 atendidos", valor: atendidos }]
                if (!encerrado && p.participantes_estimados !== null) valores.push({ rotulo: "2027 estimados", valor: p.participantes_estimados })
                const maior = Math.max(...valores.map(v => v.valor), 1)
                for (const v of valores) barras.push({ ...v, valorTexto: inteiroBR(v.valor), proporcao: v.valor / maior })
            }
            const A = LAYOUT.aprendizados
            const largura = barras.length ? CORPO.largura - A.colunaBarras - A.vao : CORPO.largura
            const { cabem, sobra } = encaixarBlocos(brutos, largura, A.texto, CORPO.altura)
            adicionar({ tipo: "aprendizados", barras, blocos: cabem }, sobra)
        }
    }

    // 9. Riscos e observações
    const observacoes = limpo(p.observacoes)
    if (!encerrado && observacoes) {
        const Ob = LAYOUT.observacoes
        const largura = CORPO.largura - Ob.recuo
        let tamanho: number = Ob.tamanhos[Ob.tamanhos.length - 1]
        for (const t of Ob.tamanhos) if (alturaTexto(observacoes, largura, corrido(t)) <= CORPO.altura) { tamanho = t; break }
        const [parte, resto] = cortarPorAltura(observacoes, largura, corrido(tamanho), CORPO.altura)
        adicionar({ tipo: "observacoes", texto: parte || observacoes, tamanho }, parte && resto ? [{ rotulo: "Observações", texto: resto }] : [])
    }

    // 10. Encerramento
    saida.push({ tipo: "encerramento", responsavel, contato: limpo(p.responsavel_contato) })

    const slides: Slide[] = saida.map((c, i) => ({
        ...c,
        id: `${c.tipo}-${i}`,
        titulo: c.tipo === "continuacao"
            ? `${TITULOS[c.de]} … continuação`
            : c.tipo === "orcamento" && c.parte > 1 ? `${TITULOS.orcamento} … continuação`
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

// Objetivos e público: objetivo geral em cima; embaixo, os específicos e a caixa de público. O que
// não cabe continua no slide seguinte, na ordem: objetivo geral, específicos, público.
function slideObjetivos(geral: string | null, especificos: string[], publico: string | null, faixa: string | null): [ConteudoSlide, Bloco[]] {
    const L = LAYOUT.objetivos
    const temCaixa = !!(publico || faixa)
    const temLinha = especificos.length > 0 || temCaixa
    const sobra: Bloco[] = []
    const fonteGeral: Fonte = { tamanho: L.geral, altura: L.alturaGeral }
    const larguraGeral = CORPO.largura - L.borda
    const larguraItem = (temCaixa ? CORPO.largura - L.vao - L.caixa : CORPO.largura) - L.check
    const larguraCaixa = L.caixa - 2 * L.caixaPadding
    const alturaFaixa = faixa ? ALTURA_ROTULO + 20 * 1.25 : 0
    const alturaItem = (t: string) => alturaTexto(t, larguraItem, corrido(L.item)) + L.margemItem

    // Altura que a linha de baixo precisaria, para reservar espaço para ela (até 40% do slide).
    const precisaLinha = Math.max(
        especificos.length ? ALTURA_ROTULO + especificos.reduce((s, t) => s + alturaItem(t), 0) : 0,
        temCaixa ? 2 * L.caixaPadding + (publico ? alturaBloco(publico, larguraCaixa, L.item) : 0) + alturaFaixa : 0,
    )
    const reserva = temLinha ? Math.min(precisaLinha, CORPO.altura * 0.4) : 0

    let objetivoGeral: string | null = null
    let usado = 0
    if (geral) {
        const extra = ALTURA_ROTULO + L.margemGeral
        let [parte, resto] = cortarPorAltura(geral, larguraGeral, fonteGeral, CORPO.altura - reserva - extra)
        // Não coube nem com a reserva: o geral ocupa o slide todo e a linha de baixo vai para a continuação.
        if (resto && reserva > 0) [parte, resto] = cortarPorAltura(geral, larguraGeral, fonteGeral, CORPO.altura - extra)
        if (parte) { objetivoGeral = parte; usado = extra + alturaTexto(parte, larguraGeral, fonteGeral) }
        if (resto) sobra.push({ rotulo: "Objetivo geral", texto: resto })
    }
    const livre = CORPO.altura - usado
    const linhaCheia = sobra.length > 0

    // Específicos, um a um, enquanto couberem (com o geral cortado, todos vão para a continuação).
    const visiveis: string[] = []
    const restantes: string[] = []
    let livreItens = livre - ALTURA_ROTULO
    for (const t of especificos) {
        if (linhaCheia || restantes.length) { restantes.push(t); continue }
        const h = alturaItem(t)
        if (h <= livreItens) { visiveis.push(t); livreItens -= h; continue }
        const [parte, resto] = cortarPorAltura(t, larguraItem, corrido(L.item), livreItens - L.margemItem)
        if (parte) { visiveis.push(parte); restantes.push(resto) } else restantes.push(t)
    }
    if (restantes.length) sobra.push({ rotulo: "Objetivos específicos", texto: restantes.map(t => `• ${t}`).join("\n") })

    // Público-alvo e faixa etária na caixa.
    let publicoVisivel: string | null = null
    if (publico) {
        const disponivel = livre - 2 * L.caixaPadding - alturaFaixa - ALTURA_ROTULO - LAYOUT.margemBloco
        const [parte, resto] = linhaCheia || disponivel <= 0 ? ["", publico] : cortarPorAltura(publico, larguraCaixa, corrido(L.item), disponivel)
        publicoVisivel = parte || null
        if (resto) sobra.push({ rotulo: "Público-alvo", texto: resto })
    }
    const faixaVisivel = linhaCheia || livre < 2 * L.caixaPadding + alturaFaixa ? null : faixa
    if (faixa && !faixaVisivel) sobra.push({ rotulo: "Faixa etária", texto: faixa })

    return [{ tipo: "objetivos", objetivoGeral, especificos: visiveis, publico: publicoVisivel, faixa: faixaVisivel }, sobra]
}

// Altura do topo do "Como vai acontecer" (linha do tempo e período).
export function alturaLinhaDoTempo(periodo: string | null): number {
    return 14 + 5 + 9.5 * 1.25 + (periodo ? 10 + alturaTexto(periodo, CORPO.largura, { tamanho: 15, altura: 1.25, negrito: true }) : 0) + 20
}

function slideExecucao(linhaDoTempo: { anoTodo: boolean; meses: number[] } | null, periodo: string | null, itens: Bloco[], como: string | null): [ConteudoSlide, Bloco[]] {
    const E = LAYOUT.execucao
    const altura = CORPO.altura - (linhaDoTempo ? alturaLinhaDoTempo(periodo) : 0)
    const larguraComo = (itens.length ? CORPO.largura - E.colunaItens - E.vao : CORPO.largura) - 2 * E.caixaPadding
    const coluna = encaixarBlocos(itens, E.colunaItens, E.item, altura)
    const sobra = [...coluna.sobra]
    let comoVisivel: string | null = null
    if (como) {
        const caixa = encaixarBlocos([{ rotulo: "Como será realizado", texto: como }], larguraComo, E.item, altura - 2 * E.caixaPadding)
        comoVisivel = caixa.cabem[0]?.texto ?? null
        sobra.push(...caixa.sobra)
    }
    return [{ tipo: "execucao", linhaDoTempo, periodo, itens: coluna.cabem, como: comoVisivel }, sobra]
}

// Orçamento: no primeiro slide, o resumo (total e rosca) ao lado da tabela; os itens que não cabem
// seguem em tabelas da largura toda.
function slidesOrcamento(resumo: ResumoOrcamento | null, linhas: LinhaOrcamento[]): ConteudoSlide[] {
    const slides: ConteudoSlide[] = []
    let fila = linhas
    let parte = 1
    while (fila.length) {
        const comResumo = parte === 1 && resumo !== null
        const largura = comResumo ? larguraTabelaComResumo : CORPO.largura
        let livre = CORPO.altura - O.cabecalho
        const desta: LinhaOrcamento[] = []
        for (const l of fila) {
            const h = alturaLinhaOrcamento(l, largura)
            if (desta.length && h > livre) break
            desta.push(l)
            livre -= h
        }
        slides.push({ tipo: "orcamento", resumo: comResumo ? resumo : null, itens: desta, parte })
        fila = fila.slice(desta.length)
        parte++
    }
    return slides
}

function slidesMetas(metas: MetaSlide[]): { slide: ConteudoSlide; sobra: Bloco[] }[] {
    const grade = metas.every(m => alturaMeta(m, M.grade) <= M.alturaGrade)
    const grupos: { metas: MetaSlide[]; inicio: number; sobra: Bloco[] }[] = []
    if (grade) {
        for (let i = 0; i < metas.length; i += METAS_POR_SLIDE) grupos.push({ metas: metas.slice(i, i + METAS_POR_SLIDE), inicio: i + 1, sobra: [] })
    } else {
        const disponivel = CORPO.altura + 6 // os cartões sobem 6 (como na grade)
        let atual: { metas: MetaSlide[]; inicio: number; sobra: Bloco[] } = { metas: [], inicio: 1, sobra: [] }
        let livre = disponivel
        metas.forEach((m, i) => {
            const h = alturaMeta(m, M.lista)
            if (atual.metas.length && h + M.vao > livre) {
                grupos.push(atual)
                atual = { metas: [], inicio: i + 1, sobra: [] }
                livre = disponivel
            }
            if (!atual.metas.length && h > disponivel) {
                const c = cortarMeta(m, i + 1, disponivel)
                atual.metas.push(c.meta)
                atual.sobra.push(...c.sobra)
                livre = 0
            } else {
                atual.metas.push(m)
                livre -= h + M.vao
            }
        })
        if (atual.metas.length) grupos.push(atual)
    }
    return grupos.map((g, i) => ({
        slide: { tipo: "metas", metas: g.metas, parte: i + 1, partes: grupos.length, inicio: g.inicio, layout: grade ? "grade" : "lista" },
        sobra: g.sobra,
    }))
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
