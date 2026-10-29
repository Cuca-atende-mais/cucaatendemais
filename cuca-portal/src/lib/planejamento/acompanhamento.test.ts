import { describe, expect, it } from "vitest"
import {
    SECOES_CORRECAO, abertas, correcoesNoFormulario, descreverEvento, fichaAlteradaAposValidacao, montarLinhaDoTempo,
    rotuloSecaoCorrecao, textoFaixaCorrecoes, textoSeloCorrecoes, type Correcao, type EventoProjeto,
} from "./acompanhamento"
import { SECOES, secoesVisiveis } from "./projeto"

function correcao(p: Partial<Correcao> & { id: string }): Correcao {
    return {
        secao: null, texto: `pedido ${p.id}`, pedido_por_nome: "Secretário", created_at: "2026-10-29T10:00:00Z",
        resolvida_em: null, resolvida_por_nome: null, resolucao_obs: null, ...p,
    }
}

function evento(p: Partial<EventoProjeto> & { id: string; tipo: string; created_at: string }): EventoProjeto {
    return { detalhe: {}, autor_nome: "Fulano", ...p }
}

describe("ficha alterada após a validação", () => {
    it("ficha salva depois da validação mostra o aviso", () => {
        expect(fichaAlteradaAposValidacao("2026-10-29T15:00:01Z", "2026-10-29T15:00:00Z")).toBe(true)
    })
    it("ficha salva antes (ou no mesmo instante) não mostra", () => {
        expect(fichaAlteradaAposValidacao("2026-10-28T15:22:58.476623+00:00", "2026-10-29T12:00:00Z")).toBe(false)
        expect(fichaAlteradaAposValidacao("2026-10-29T12:00:00Z", "2026-10-29T12:00:00Z")).toBe(false)
    })
    it("compara instantes, não texto (fusos diferentes)", () => {
        expect(fichaAlteradaAposValidacao("2026-10-29T10:00:00-03:00", "2026-10-29T12:30:00Z")).toBe(true)
        expect(fichaAlteradaAposValidacao("2026-10-29T09:00:00-03:00", "2026-10-29T12:30:00Z")).toBe(false)
    })
    it("data inválida não acusa alteração", () => {
        expect(fichaAlteradaAposValidacao("", "2026-10-29T12:00:00Z")).toBe(false)
    })
})

describe("textos com singular e plural", () => {
    it("faixa do topo", () => {
        expect(textoFaixaCorrecoes(0)).toBeNull()
        expect(textoFaixaCorrecoes(1)).toBe("1 correção pedida em aberto")
        expect(textoFaixaCorrecoes(2)).toBe("2 correções pedidas em aberto")
    })
    it("selo da lista", () => {
        expect(textoSeloCorrecoes(0)).toBeNull()
        expect(textoSeloCorrecoes(1)).toBe("1 correção")
        expect(textoSeloCorrecoes(3)).toBe("3 correções")
    })
})

describe("seções de correção", () => {
    it("são as 7 seções da ficha, com os mesmos ids", () => {
        expect(SECOES_CORRECAO.map(s => s.id)).toEqual(SECOES.map(s => s.id))
        expect(rotuloSecaoCorrecao(5)).toBe("Orçamento")
        expect(rotuloSecaoCorrecao(null)).toBeNull()
        expect(rotuloSecaoCorrecao(9)).toBeNull()
    })
})

describe("destaques no formulário", () => {
    const lista = [
        correcao({ id: "a", secao: 5 }),
        correcao({ id: "b", secao: 5 }),
        correcao({ id: "c", secao: 1 }),
        correcao({ id: "d", secao: null }),
        correcao({ id: "e", secao: 4, resolvida_em: "2026-10-29T11:00:00Z" }),
    ]
    it("só as abertas; cada uma na sua seção, as sem seção no aviso geral", () => {
        const r = correcoesNoFormulario(lista, secoesVisiveis(""))
        expect(r.porSecao[5]?.map(c => c.id)).toEqual(["a", "b"])
        expect(r.porSecao[1]?.map(c => c.id)).toEqual(["c"])
        expect(r.porSecao[4]).toBeUndefined()
        expect(r.gerais.map(c => c.id)).toEqual(["d"])
    })
    it("seção escondida pela ficha (Encerrado) vai para o aviso geral, não some", () => {
        const r = correcoesNoFormulario(lista, secoesVisiveis("encerrado"))
        expect(r.porSecao[5]).toBeUndefined()
        expect(r.gerais.map(c => c.id)).toEqual(["a", "b", "d"])
    })
    it("abertas() tira as resolvidas", () => {
        expect(abertas(lista).map(c => c.id)).toEqual(["a", "b", "c", "d"])
    })
})

describe("linha do tempo", () => {
    const fmt = (iso: string) => `F(${iso})`
    it("do mais recente para o mais antigo; empate desempata pelo id, sempre igual", () => {
        const eventos = [
            evento({ id: "a1", tipo: "criacao", created_at: "2026-10-28T10:00:00Z" }),
            evento({ id: "b2", tipo: "validado", created_at: "2026-10-29T10:00:00Z" }),
            evento({ id: "c3", tipo: "pendencia_criada", created_at: "2026-10-29T10:00:00Z" }),
            evento({ id: "d4", tipo: "salvar_projeto", created_at: "2026-10-28T12:00:00Z" }),
        ]
        const itens = montarLinhaDoTempo(eventos, fmt)
        expect(itens.map(i => i.id)).toEqual(["c3", "b2", "d4", "a1"])
        expect(montarLinhaDoTempo([...eventos].reverse(), fmt).map(i => i.id)).toEqual(["c3", "b2", "d4", "a1"])
        expect(itens[3]).toMatchObject({ titulo: "Projeto criado", autor: "Fulano", quando: "F(2026-10-28T10:00:00Z)" })
    })
    it("\"Projeto criado\" fica sempre como o mais antigo quando divide o horário (criado direto com Salvar projeto)", () => {
        const mesmo = "2026-10-28T15:22:58.476623+00:00"
        for (const [idCriacao, idSalvar] of [["ffff", "0000"], ["0000", "ffff"]]) {
            const itens = montarLinhaDoTempo([
                evento({ id: idCriacao, tipo: "criacao", created_at: mesmo }),
                evento({ id: idSalvar, tipo: "salvar_projeto", created_at: mesmo }),
            ], fmt)
            expect(itens.map(i => i.tipo)).toEqual(["salvar_projeto", "criacao"])
        }
    })
    it("descreve cada tipo de evento do AC6", () => {
        const d = (tipo: string, detalhe: Record<string, unknown> = {}) => descreverEvento({ tipo, detalhe })
        expect(d("criacao", { duplicado_de_nome: "Sarau" }).titulo).toBe("Projeto criado como cópia de \"Sarau\"")
        expect(d("salvar_projeto").titulo).toBe("Ficha salva como final (Salvar projeto)")
        expect(d("ficha_voltou_parcial").titulo).toBe("Ficha voltou para parcial")
        expect(d("status_alterado", { status_anterior: "projeto_salvo", status: "aprovado", observacao: "na reunião" }))
            .toEqual({ titulo: "Status alterado: Projeto salvo → Aprovado", descricao: "na reunião" })
        expect(d("correcao_pedida", { secao: 5, texto: "Rever valores" })).toEqual({ titulo: "Correção pedida (Orçamento)", descricao: "Rever valores" })
        expect(d("correcao_pedida", { secao: null, texto: "Geral" })).toEqual({ titulo: "Correção pedida", descricao: "Geral" })
        expect(d("correcao_resolvida", { texto: "Rever valores", observacao: "feito" }).descricao).toBe("Rever valores\nObservação: feito")
        expect(d("correcao_resolvida", { texto: "Rever valores", observacao: null }).descricao).toBe("Rever valores")
        expect(d("validado").titulo).toBe("Projeto validado")
        expect(d("validacao_retirada").titulo).toBe("Validação retirada")
        expect(d("pendencia_criada", { texto: "Contratar som", responsavel: "Cultura" }).descricao).toBe("Contratar som (responsável: Cultura)")
        expect(d("pendencia_criada", { texto: "Contratar som", responsavel: null }).descricao).toBe("Contratar som")
        expect(d("pendencia_concluida", { texto: "Contratar som" })).toEqual({ titulo: "Pendência concluída", descricao: "Contratar som" })
    })
    it("tipo desconhecido e detalhe vazio não quebram", () => {
        expect(descreverEvento({ tipo: "novo_tipo", detalhe: null })).toEqual({ titulo: "novo_tipo", descricao: null })
        expect(descreverEvento({ tipo: "status_alterado", detalhe: null }).titulo).toBe("Status alterado: — → —")
    })
})
