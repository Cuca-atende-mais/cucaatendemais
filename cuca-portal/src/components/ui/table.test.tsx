// S-RESP-02 (AC3) — Tabela com cabeçalho fixo e primeira coluna fixa, por opção. Teste sem
// navegador (react-dom/server): confere as classes. Sem as opções, a tabela sai igual a antes.
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

function tabela(props: React.ComponentProps<typeof Table> = {}) {
    return renderToStaticMarkup(
        <Table {...props}>
            <TableHeader>
                <TableRow><TableHead>Nome</TableHead><TableHead>Unidade</TableHead></TableRow>
            </TableHeader>
            <TableBody>
                <TableRow><TableCell>Ana</TableCell><TableCell>Barra</TableCell></TableRow>
            </TableBody>
        </Table>
    )
}

/** Classes de todas as tags com o data-slot pedido, na ordem em que aparecem. */
function classesDosSlots(html: string, slot: string): string[][] {
    return [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`, "g"))].map(m =>
        (/class="([^"]*)"/.exec(m[0])?.[1] ?? "").replaceAll("&amp;", "&").replaceAll("&gt;", ">").split(" ")
    )
}

describe("Table sem opções — continua igual a antes", () => {
    it("caixa só com rolagem lateral, sem altura máxima", () => {
        expect(classesDosSlots(tabela(), "table-container")[0]).toEqual(["relative", "w-full", "overflow-x-auto"])
    })

    it("cabeçalho e células sem sticky", () => {
        const html = tabela()
        expect(html).not.toContain("sticky")
        expect(classesDosSlots(html, "table-head")[0]).toEqual(
            "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]".split(" ")
        )
    })
})

describe("Table com cabeçalhoFixo", () => {
    it("a caixa ganha altura máxima e rola por dentro (senão o sticky gruda na caixa e não fixa)", () => {
        const caixa = classesDosSlots(tabela({ cabecalhoFixo: true }), "table-container")[0]
        expect(caixa).toEqual(expect.arrayContaining(["overflow-auto", "max-h-[70svh]"]))
        expect(caixa).not.toContain("overflow-x-auto")
    })

    it("a altura da caixa pode ser trocada", () => {
        const caixa = classesDosSlots(tabela({ cabecalhoFixo: true, classeCaixa: "max-h-[50svh]" }), "table-container")[0]
        expect(caixa).toContain("max-h-[50svh]")
        expect(caixa).not.toContain("max-h-[70svh]")
    })

    it("todo cabeçalho fica sticky no topo, com fundo e linha de baixo", () => {
        for (const th of classesDosSlots(tabela({ cabecalhoFixo: true }), "table-head")) {
            expect(th).toEqual(expect.arrayContaining(["sticky", "top-0", "z-20", "bg-card", "shadow-[inset_0_-1px_0_var(--border)]"]))
        }
    })

    it("as células do corpo não ficam sticky", () => {
        for (const td of classesDosSlots(tabela({ cabecalhoFixo: true }), "table-cell")) {
            expect(td.join(" ")).not.toContain("sticky")
        }
    })
})

describe("Table com primeiraColunaFixa", () => {
    it("a primeira célula de cada linha fica parada à esquerda", () => {
        const html = tabela({ primeiraColunaFixa: true })
        for (const celula of [...classesDosSlots(html, "table-head"), ...classesDosSlots(html, "table-cell")]) {
            expect(celula).toEqual(expect.arrayContaining(["first:sticky", "first:left-0", "first:bg-card"]))
        }
    })

    it("com as duas opções, o canto fica por cima das duas faixas", () => {
        const th = classesDosSlots(tabela({ cabecalhoFixo: true, primeiraColunaFixa: true }), "table-head")[0]
        expect(th).toEqual(expect.arrayContaining(["first:z-30", "first:shadow-[inset_-1px_-1px_0_var(--border)]", "z-20", "top-0"]))
        expect(th).not.toContain("first:z-10")
    })
})
