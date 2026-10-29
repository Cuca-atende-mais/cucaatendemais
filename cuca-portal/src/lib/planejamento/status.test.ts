import { describe, expect, it } from "vitest"
import { PLA_STATUS } from "@/lib/rbac/catalogo-planejamento"
import { statusAposGravacao } from "./projeto"
import {
    DESTINOS_STATUS, ESTADO_DA_COPIA, nomeDaCopia, opcoesDoSeletor, rotaDepoisDeDuplicar, rotuloDestino, statusDoDestino,
    temAlgumaPermissaoDeStatus, textoUltimaTroca,
} from "./status"

const todas = () => true
const nenhuma = () => false
const so = (...ids: string[]) => (p: string) => ids.includes(p)

describe("Voltar ao status da ficha", () => {
    it("ficha parcial volta para Em construção; ficha final volta para Projeto salvo", () => {
        expect(statusDoDestino("ficha", "parcial")).toBe("em_construcao")
        expect(statusDoDestino("ficha", "final")).toBe("projeto_salvo")
        expect(rotuloDestino("ficha", "final")).toBe("Voltar ao status da ficha (Projeto salvo)")
    })
    it("depois de voltar, o status acompanha os botões de novo", () => {
        const voltou = statusDoDestino("ficha", "parcial")
        expect(statusAposGravacao(voltou, "final")).toBe("projeto_salvo")
        // Status manual não acompanha os botões
        expect(statusAposGravacao("aprovado", "final")).toBe("aprovado")
    })
    it("os 4 status manuais vão para eles mesmos", () => {
        for (const d of ["aprovado", "em_execucao", "concluido", "reprovado"] as const) expect(statusDoDestino(d, "parcial")).toBe(d)
    })
})

describe("opções do seletor", () => {
    it("uma permissão por opção, na ordem do AC11", () => {
        expect(DESTINOS_STATUS.map(d => d.permissao)).toEqual([
            PLA_STATUS.aprovado, PLA_STATUS.execucao, PLA_STATUS.concluido, PLA_STATUS.reprovado, PLA_STATUS.ficha,
        ])
    })
    it("só oferece as permitidas", () => {
        expect(opcoesDoSeletor("projeto_salvo", "final", so(PLA_STATUS.aprovado, PLA_STATUS.reprovado))).toEqual(["aprovado", "reprovado"])
        expect(opcoesDoSeletor("projeto_salvo", "final", nenhuma)).toEqual([])
    })
    it("sem ordem obrigatória, mas não oferece o que não muda nada", () => {
        expect(opcoesDoSeletor("concluido", "parcial", todas)).toEqual(["aprovado", "em_execucao", "reprovado", "ficha"])
        // Já está no status da ficha: "Voltar" não aparece
        expect(opcoesDoSeletor("em_construcao", "parcial", todas)).toEqual(["aprovado", "em_execucao", "concluido", "reprovado"])
        expect(opcoesDoSeletor("em_construcao", "final", todas)).toContain("ficha")
    })
    it("seletor aparece com qualquer permissão de status", () => {
        expect(temAlgumaPermissaoDeStatus(so(PLA_STATUS.ficha))).toBe(true)
        expect(temAlgumaPermissaoDeStatus(so("pla_proj_editar"))).toBe(false)
    })
})

describe("duplicar", () => {
    it("cópia com o nome, Em construção e ficha parcial (espelho do banco)", () => {
        expect(nomeDaCopia("Olimpíadas")).toBe("Olimpíadas (cópia)")
        expect(ESTADO_DA_COPIA).toEqual({ status: "em_construcao", ficha: "parcial" })
    })
    it("abre a edição da cópia; sem permissão de editar, a página da cópia (D14)", () => {
        expect(rotaDepoisDeDuplicar("x1", true)).toBe("/planejamento/projeto/x1/editar")
        expect(rotaDepoisDeDuplicar("x1", false)).toBe("/planejamento/projeto/x1")
    })
})

describe("última troca de status", () => {
    it("monta o texto do AC13", () => {
        expect(textoUltimaTroca(null, d => d)).toBeNull()
        expect(textoUltimaTroca({ autor_nome: "Nayana", created_at: "28/10", detalhe: null }, d => d)).toBe("Status alterado por Nayana em 28/10")
        expect(textoUltimaTroca({ autor_nome: null, created_at: "28/10", detalhe: {} }, d => d)).toBe("Status alterado por — em 28/10")
    })
})
