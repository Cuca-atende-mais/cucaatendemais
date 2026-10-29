import { describe, expect, it } from "vitest"
import {
    mesclarOrdem, montarPauta, mover, moverPara, ordenarProjetosDoSetor, ordenarSetores, proximoNaPauta, sequenciaDaPauta,
    urlApresentarDaPauta, urlPauta, type PosicaoProjeto, type ProjetoPauta, type SetorPauta,
} from "./pauta"

const SETORES: SetorPauta[] = [
    { id: "direitos_humanos", nome: "Direitos Humanos", cor: "#7c3aed", ordem: 1 },
    { id: "cultura", nome: "Cultura", cor: "#db2777", ordem: 3 },
    { id: "esportes", nome: "Esportes", cor: "#16a34a", ordem: 6 },
]

let n = 0
function projeto(p: Partial<ProjetoPauta> & { id: string }): ProjetoPauta {
    n += 1
    return {
        nome: p.id.toUpperCase(), setor_id: "esportes", responsavel_nome: null, tipo: "projeto", status: "projeto_salvo",
        ficha: "final", situacao_2026: "mantem", created_at: `2026-10-29T10:${String(n).padStart(2, "0")}:00Z`, ...p,
    }
}

describe("ordem dos setores", () => {
    it("sem posição salva: ordem de exibição dos setores", () => {
        expect(ordenarSetores(SETORES, []).map(s => s.id)).toEqual(["direitos_humanos", "cultura", "esportes"])
    })
    it("com posição salva: pela posição; sem posição vão para o fim, pela ordem de exibição", () => {
        expect(ordenarSetores(SETORES, [{ setor_id: "esportes", posicao: 1 }]).map(s => s.id)).toEqual(["esportes", "direitos_humanos", "cultura"])
    })
})

describe("ordem dos projetos de um setor", () => {
    const a = projeto({ id: "a" })
    const b = projeto({ id: "b" })
    const c = projeto({ id: "c" })
    it("sem posição: por data de criação", () => {
        expect(ordenarProjetosDoSetor([c, a, b], []).map(p => p.id)).toEqual(["a", "b", "c"])
    })
    it("projeto novo (sem posição) entra no fim", () => {
        const pos: PosicaoProjeto[] = [{ projeto_id: "c", setor_id: "esportes", posicao: 1 }, { projeto_id: "a", setor_id: "esportes", posicao: 2 }]
        const novo = projeto({ id: "novo" })
        expect(ordenarProjetosDoSetor([a, b, c, novo], pos).map(p => p.id)).toEqual(["c", "a", "b", "novo"])
    })
    it("posição salva para outro setor (o projeto mudou de setor) é ignorada: entra no fim", () => {
        const mudou = projeto({ id: "mudou", setor_id: "cultura", created_at: "2026-01-01T00:00:00Z" })
        const outro = projeto({ id: "outro", setor_id: "cultura" })
        const pos: PosicaoProjeto[] = [{ projeto_id: "mudou", setor_id: "esportes", posicao: 1 }, { projeto_id: "outro", setor_id: "cultura", posicao: 1 }]
        expect(ordenarProjetosDoSetor([mudou, outro], pos).map(p => p.id)).toEqual(["outro", "mudou"])
    })
})

describe("pauta", () => {
    const e1 = projeto({ id: "e1" })
    const e2 = projeto({ id: "e2", ficha: "parcial" })
    const e3 = projeto({ id: "e3", situacao_2026: "encerrado" })
    const e4 = projeto({ id: "e4" })
    const c1 = projeto({ id: "c1", setor_id: "cultura" })
    const base = { setores: SETORES, projetos: [e1, e2, e3, e4, c1], posicoesSetores: [], posicoesProjetos: [] }

    it("agrupa por setor na ordem; setor sem projeto não aparece; encerrados ficam de fora", () => {
        const pauta = montarPauta({ ...base, mostrarEncerrados: false })
        expect(pauta.map(b => [b.setor.id, b.itens.map(i => [i.projeto.id, i.posicao])])).toEqual([
            ["cultura", [["c1", 1]]],
            ["esportes", [["e1", 1], ["e2", 2], ["e4", 3]]],
        ])
    })
    it("\"Mostrar encerrados\" inclui os encerrados, marcados", () => {
        const pauta = montarPauta({ ...base, mostrarEncerrados: true })
        const e = pauta.find(b => b.setor.id === "esportes")!
        expect(e.itens.map(i => [i.projeto.id, i.encerrado])).toEqual([["e1", false], ["e2", false], ["e3", true], ["e4", false]])
    })
    it("ficha parcial continua na pauta, marcada sem slides", () => {
        const pauta = montarPauta({ ...base, mostrarEncerrados: false })
        expect(sequenciaDaPauta(pauta).filter(i => i.semSlides).map(i => i.projeto.id)).toEqual(["e2"])
    })
    it("próximo projeto atravessa setores; o de ficha parcial aponta o seguinte com slides", () => {
        const pauta = montarPauta({ ...base, mostrarEncerrados: false })
        expect(proximoNaPauta(pauta, "c1")).toMatchObject({ proximo: { projeto: { id: "e1" } }, comSlides: { projeto: { id: "e1" } } })
        expect(proximoNaPauta(pauta, "e1")).toMatchObject({ proximo: { projeto: { id: "e2" }, semSlides: true }, comSlides: { projeto: { id: "e4" } } })
        expect(proximoNaPauta(pauta, "e4")).toEqual({ proximo: null, comSlides: null })
        expect(proximoNaPauta(pauta, "fora-da-pauta")).toEqual({ proximo: null, comSlides: null })
    })
    it("próximo sem slides e nenhum depois com slides: comSlides vazio", () => {
        const pauta = montarPauta({ ...base, projetos: [e1, e2], mostrarEncerrados: false })
        expect(proximoNaPauta(pauta, "e1")).toMatchObject({ proximo: { projeto: { id: "e2" } }, comSlides: null })
    })
})

describe("reordenar", () => {
    it("setas trocam com o vizinho e não passam da ponta", () => {
        expect(mover(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"])
        expect(mover(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"])
        expect(mover(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"])
        expect(mover(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"])
    })
    it("arrastar leva o item para o lugar do alvo", () => {
        expect(moverPara(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"])
        expect(moverPara(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"])
        expect(moverPara(["a", "b"], "a", "a")).toEqual(["a", "b"])
    })
    it("mesclar: os visíveis ocupam as posições que já eram deles, os escondidos não se movem (igual ao banco)", () => {
        // Mesmo caso do teste no banco: [T3, T1] sobre Olimpíadas, T1, T2, T3.
        expect(mesclarOrdem(["olim", "t1", "t2", "t3"], ["t3", "t1"])).toEqual(["olim", "t3", "t2", "t1"])
        // Setores: [esportes, cultura] sobre a ordem de exibição.
        expect(mesclarOrdem(["dh", "emp", "cultura", "artes", "edu", "esportes"], ["esportes", "cultura"]))
            .toEqual(["dh", "emp", "esportes", "artes", "edu", "cultura"])
    })
})

describe("endereços", () => {
    it("pauta e modo apresentar levam o interruptor de encerrados", () => {
        expect(urlPauta(false)).toBe("/planejamento/apresentacoes")
        expect(urlPauta(true)).toBe("/planejamento/apresentacoes?encerrados=1")
        expect(urlApresentarDaPauta("p1", false)).toBe("/planejamento/projeto/p1/apresentacao?apresentar=1&pauta=1")
        expect(urlApresentarDaPauta("p1", true)).toBe("/planejamento/projeto/p1/apresentacao?apresentar=1&pauta=1&encerrados=1")
    })
})
