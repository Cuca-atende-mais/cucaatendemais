// S-RESP-03 (AC3) — Leads abaixo de 1024px viram cartões. Teste sem navegador (react-dom/server):
// o cartão mostra os mesmos dados da tabela, e o menu de ações é o mesmo componente da tabela.
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Lead } from "@/lib/types/database"
import { CartaoLead } from "./cartao-lead"
import { AcoesLead } from "./acoes-lead"

const leadBase: Lead = {
    id: "1",
    telefone: "5585999990000",
    nome: "Maria de Fátima Albuquerque",
    email: null,
    unidade_cuca: "Barra",
    origem: null,
    tags: null,
    opt_in: true,
    bloqueado: false,
    motivo_bloqueio: null,
    excluido: false,
    data_nascimento: null,
    equipamentos_principais: [],
    atividades_principais: [],
    created_at: "2026-11-01T12:00:00Z",
    updated_at: "2026-11-01T12:00:00Z",
}

const semAcao = vi.fn()

function cartao(lead: Partial<Lead> = {}, extra: Partial<React.ComponentProps<typeof CartaoLead>> = {}) {
    return renderToStaticMarkup(
        <CartaoLead
            lead={{ ...leadBase, ...lead }}
            selecionado={false}
            onAlternarSelecao={semAcao}
            dataCadastro="01/11/2026"
            perfil={null}
            acoes={<span data-testid="acoes">menu</span>}
            {...extra}
        />
    )
}

describe("CartaoLead — mesmos dados da tabela", () => {
    it("mostra nome, telefone, unidade, data de cadastro e status", () => {
        const html = cartao()
        expect(html).toContain("Maria de Fátima Albuquerque")
        expect(html).toContain("5585999990000")
        expect(html).toContain("Barra")
        expect(html).toContain("Cadastro: 01/11/2026")
        expect(html).toContain("Opt-in")
        expect(html).not.toContain("Bloqueado")
    })

    it("lead sem nome e sem unidade", () => {
        const html = cartao({ nome: null, unidade_cuca: null, opt_in: false, bloqueado: true })
        expect(html).toContain("Sem nome")
        expect(html).toContain("Sem unidade")
        expect(html).toContain("Bloqueado")
    })

    it("o nome quebra linha em vez de empurrar o menu para fora", () => {
        expect(cartao()).toMatch(/class="font-medium break-words"/)
    })

    it("tem caixa de seleção própria (seleção em massa funciona no celular)", () => {
        const html = cartao()
        expect(html).toContain('aria-label="Selecionar Maria de Fátima Albuquerque"')
        expect(html).toContain('role="checkbox"')
    })

    it("cartão selecionado fica destacado", () => {
        expect(cartao({}, { selecionado: true })).toMatch(/data-slot="cartao-lead" class="[^"]*bg-primary\/5/)
        expect(cartao()).not.toMatch(/data-slot="cartao-lead" class="[^"]*bg-primary\/5/)
    })

    it("mostra o perfil e as ações que a página entrega", () => {
        const html = cartao({}, { perfil: <span>Esporte</span> })
        expect(html).toContain("Esporte")
        expect(html).toContain('data-testid="acoes"')
    })
})

describe("AcoesLead — botão do menu", () => {
    const acoes = (classeBotao?: string) =>
        renderToStaticMarkup(
            <AcoesLead
                lead={leadBase}
                classeBotao={classeBotao}
                onVer={semAcao}
                onAlternarOptIn={semAcao}
                onDesbloquear={semAcao}
                onBloquear={semAcao}
                onLimparTags={semAcao}
                onExcluir={semAcao}
            />
        )

    it("na tabela, botão de 32px, com nome acessível", () => {
        const html = acoes()
        expect(html).toContain('aria-label="Ações do lead Maria de Fátima Albuquerque"')
        expect(html).toMatch(/class="[^"]*\bh-8 w-8\b/)
    })

    it("no cartão, o botão cresce para 44px (alvo de toque no celular)", () => {
        expect(acoes("h-11 w-11")).toMatch(/class="[^"]*\bh-11 w-11\b/)
        expect(acoes("h-11 w-11")).not.toMatch(/\bh-8\b/)
    })
})
