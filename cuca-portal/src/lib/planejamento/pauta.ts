// S-PLA-06: regras puras da pauta de apresentações (sem React, sem Supabase). A ordem efetiva é a
// mesma das funções do banco (`pla_pauta_ordenar_*`, migration 20261029150000):
//   - setores: com posição salva, pela posição; depois os outros, pela ordem de exibição do setor;
//   - projetos de um setor: com posição salva NESTE setor, pela posição; depois os outros (projeto
//     novo ou que mudou de setor), pela data de criação. Assim projeto novo entra no fim.

import type { EstadoFicha, Situacao2026, StatusProjeto, TipoProjeto } from "./projeto"

export type SetorPauta = { id: string; nome: string; cor: string; ordem: number }
export type ProjetoPauta = {
    id: string
    nome: string
    setor_id: string
    responsavel_nome: string | null
    tipo: TipoProjeto
    status: StatusProjeto
    ficha: EstadoFicha
    situacao_2026: Situacao2026 | null
    created_at: string
}
export type PosicaoSetor = { setor_id: string; posicao: number }
export type PosicaoProjeto = { projeto_id: string; setor_id: string; posicao: number }

export type ItemPauta = { projeto: ProjetoPauta; posicao: number; semSlides: boolean; encerrado: boolean }
export type BlocoPauta = { setor: SetorPauta; itens: ItemPauta[] }

const comparaTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function ordenarSetores(setores: SetorPauta[], posicoes: PosicaoSetor[]): SetorPauta[] {
    const pos = new Map(posicoes.map(p => [p.setor_id, p.posicao]))
    return [...setores].sort((a, b) => {
        const pa = pos.get(a.id)
        const pb = pos.get(b.id)
        if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb
        if (pa !== undefined && pb === undefined) return -1
        if (pa === undefined && pb !== undefined) return 1
        return a.ordem - b.ordem || comparaTexto(a.id, b.id)
    })
}

// Projetos de UM setor, na ordem efetiva. Posição salva para outro setor (o projeto mudou) é ignorada.
export function ordenarProjetosDoSetor(projetos: ProjetoPauta[], posicoes: PosicaoProjeto[]): ProjetoPauta[] {
    const pos = new Map(posicoes.map(p => [p.projeto_id, p]))
    const posicaoDe = (p: ProjetoPauta) => {
        const x = pos.get(p.id)
        return x && x.setor_id === p.setor_id ? x.posicao : undefined
    }
    return [...projetos].sort((a, b) => {
        const pa = posicaoDe(a)
        const pb = posicaoDe(b)
        if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb
        if (pa !== undefined && pb === undefined) return -1
        if (pa === undefined && pb !== undefined) return 1
        return Date.parse(a.created_at) - Date.parse(b.created_at) || comparaTexto(a.id, b.id)
    })
}

// Pauta: setores na ordem, cada um com os seus projetos na ordem. Encerrados só com o interruptor.
// Setor sem nenhum projeto na pauta não aparece.
export function montarPauta(p: {
    setores: SetorPauta[]
    projetos: ProjetoPauta[]
    posicoesSetores: PosicaoSetor[]
    posicoesProjetos: PosicaoProjeto[]
    mostrarEncerrados: boolean
}): BlocoPauta[] {
    const blocos: BlocoPauta[] = []
    for (const setor of ordenarSetores(p.setores, p.posicoesSetores)) {
        const doSetor = ordenarProjetosDoSetor(p.projetos.filter(x => x.setor_id === setor.id), p.posicoesProjetos)
            .filter(x => p.mostrarEncerrados || x.situacao_2026 !== "encerrado")
        if (doSetor.length === 0) continue
        blocos.push({
            setor,
            itens: doSetor.map((projeto, i) => ({
                projeto,
                posicao: i + 1,
                semSlides: projeto.ficha !== "final",
                encerrado: projeto.situacao_2026 === "encerrado",
            })),
        })
    }
    return blocos
}

export function sequenciaDaPauta(blocos: BlocoPauta[]): ItemPauta[] {
    return blocos.flatMap(b => b.itens)
}

// Próximo projeto da pauta depois do atual (AC4). Se o próximo não tem slides (ficha parcial),
// `comSlides` é o primeiro depois dele que tem. Projeto fora da pauta: sem próximo.
export function proximoNaPauta(blocos: BlocoPauta[], atualId: string): { proximo: ItemPauta | null; comSlides: ItemPauta | null } {
    const seq = sequenciaDaPauta(blocos)
    const i = seq.findIndex(x => x.projeto.id === atualId)
    if (i < 0 || i === seq.length - 1) return { proximo: null, comSlides: null }
    const proximo = seq[i + 1]
    const comSlides = seq.slice(i + 1).find(x => !x.semSlides) ?? null
    return { proximo, comSlides }
}

// ── Reordenar ────────────────────────────────────────────────────────────────────────────────

// Setas ↑ ↓: troca com o vizinho. Na ponta, não muda nada.
export function mover(ids: string[], id: string, delta: -1 | 1): string[] {
    const i = ids.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return ids
    const novo = [...ids]
    ;[novo[i], novo[j]] = [novo[j], novo[i]]
    return novo
}

// Arrastar e soltar: o item vai para o lugar do alvo (antes dele se veio de baixo, depois se veio de cima).
export function moverPara(ids: string[], id: string, alvoId: string): string[] {
    const de = ids.indexOf(id)
    const para = ids.indexOf(alvoId)
    if (de < 0 || para < 0 || de === para) return ids
    const novo = [...ids]
    novo.splice(de, 1)
    novo.splice(para, 0, id)
    return novo
}

// Espelho do banco: os itens enviados (os que a pessoa vê) ocupam, na nova ordem, as posições que já
// eram deles; os que ela não vê ficam onde estão.
export function mesclarOrdem(atualCompleto: string[], novaVisivel: string[]): string[] {
    const enviados = new Set(novaVisivel)
    let proximo = 0
    return atualCompleto.map(id => (enviados.has(id) ? novaVisivel[proximo++] : id))
}

// ── Endereços ────────────────────────────────────────────────────────────────────────────────

export const URL_PAUTA = "/planejamento/apresentacoes"
export const PARAMETRO_PAUTA = "pauta"
export const PARAMETRO_ENCERRADOS = "encerrados"

export function urlPauta(mostrarEncerrados: boolean): string {
    return mostrarEncerrados ? `${URL_PAUTA}?${PARAMETRO_ENCERRADOS}=1` : URL_PAUTA
}

// Modo apresentar aberto a partir da pauta: leva junto o interruptor de encerrados, para o
// "próximo projeto" seguir a mesma pauta que estava na tela.
export function urlApresentarDaPauta(projetoId: string, mostrarEncerrados: boolean): string {
    const q = new URLSearchParams({ apresentar: "1", [PARAMETRO_PAUTA]: "1" })
    if (mostrarEncerrados) q.set(PARAMETRO_ENCERRADOS, "1")
    return `/planejamento/projeto/${projetoId}/apresentacao?${q.toString()}`
}

export const mensagemProximoSemSlides = (nome: string) => `${nome} está salvo parcialmente e não tem slides`
