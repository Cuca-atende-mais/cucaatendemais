import { describe, expect, it } from "vitest"
import { PGM_GERAL, pgmCategoria } from "@/lib/rbac/catalogo-programacao-mensal"
import {
    categoriasEditaveis, checadorDePermissoes, mapaPermissoesCategorias, motivoRecusaCriacao, moduloDaTransicao,
    origemValida, permissoesDaCategoria, podeAcessarUnidade, podeTransicionar, separarLinhasParaDuplicar, slugDaCategoria,
    type LinhaPermissaoPgm,
} from "./permissoes-categoria"

const crud = (module: string, flags: Partial<LinhaPermissaoPgm> = {}): LinhaPermissaoPgm =>
    ({ module, can_read: true, can_create: true, can_update: true, can_delete: true, ...flags })
const unica = (module: string): LinhaPermissaoPgm =>
    ({ module, can_read: true, can_create: false, can_update: false, can_delete: false })

// Perfil do exemplo do Junior: coordenador esportivo, só ESPORTES.
const coordenadorEsportivo = checadorDePermissoes([
    unica(PGM_GERAL.lista),
    unica(PGM_GERAL.duplicar),
    crud(pgmCategoria("esportes").atividades),
    unica(pgmCategoria("esportes").autorizar),
], false)

describe("slugDaCategoria", () => {
    it("reconhece as 4 categorias e trata ESPORTE como ESPORTES", () => {
        expect(slugDaCategoria("ESPORTES")).toBe("esportes")
        expect(slugDaCategoria("ESPORTE")).toBe("esportes")
        expect(slugDaCategoria("DIA A DIA")).toBe("dia_a_dia")
        expect(slugDaCategoria(" especiais ")).toBe("especiais")
        expect(slugDaCategoria("OUTRA")).toBeNull()
        expect(slugDaCategoria(null)).toBeNull()
    })
})

describe("checadorDePermissoes", () => {
    it("Developer passa em tudo", () => {
        const dev = checadorDePermissoes(null, true)
        expect(dev("pgm_qualquer", "delete")).toBe(true)
    })

    it("módulo exato: sem prefixo e sem nome de perfil com passe livre", () => {
        const checar = checadorDePermissoes([crud("programacao_mensal")], false)
        expect(checar("programacao", "read")).toBe(false)
        expect(checar(pgmCategoria("cursos").atividades, "read")).toBe(false)
    })

    it("módulo developer nunca é liberado para quem não é Developer", () => {
        const checar = checadorDePermissoes([crud("developer")], false)
        expect(checar("developer", "read")).toBe(false)
    })
})

describe("permissões por categoria", () => {
    it("coordenador esportivo vê e mexe só em ESPORTES", () => {
        expect(permissoesDaCategoria(coordenadorEsportivo, "ESPORTES")).toEqual({ ver: true, criar: true, editar: true, excluir: true })
        expect(permissoesDaCategoria(coordenadorEsportivo, "CURSOS")).toEqual({ ver: false, criar: false, editar: false, excluir: false })
        expect(categoriasEditaveis(mapaPermissoesCategorias(coordenadorEsportivo))).toEqual(["ESPORTES"])
    })

    it("categoria só com ver não é enviada para salvar", () => {
        const checar = checadorDePermissoes([crud(pgmCategoria("cursos").atividades, { can_create: false, can_update: false, can_delete: false })], false)
        expect(categoriasEditaveis(mapaPermissoesCategorias(checar))).toEqual([])
    })

    it("duplicar copia só categorias em que pode criar e conta o que ficou de fora", () => {
        const linhas = [{ categoria: "ESPORTES" }, { categoria: "CURSOS" }, { categoria: "CURSOS" }, { categoria: "DIA A DIA" }]
        const { copiadas, foraDoPerfil } = separarLinhasParaDuplicar(linhas, coordenadorEsportivo)
        expect(copiadas).toEqual([{ categoria: "ESPORTES" }])
        expect(foraDoPerfil).toBe(3)
    })
})

describe("transições de status", () => {
    it("mapeia cada transição para a ação do fluxo", () => {
        expect(moduloDaTransicao("rascunho", "pendente")).toBe("enviar")
        expect(moduloDaTransicao("pendente", "aprovado")).toBe("autorizar")
        expect(moduloDaTransicao("pendente", "rascunho")).toBe("devolver")
        expect(moduloDaTransicao("aprovado", "rascunho")).toBe("reabrir")
        expect(moduloDaTransicao("rascunho", "aprovado")).toBeNull()
    })

    it("coordenador esportivo autoriza campanha só de ESPORTES, não uma que também tem CURSOS", () => {
        expect(podeTransicionar(coordenadorEsportivo, "pendente", "aprovado", ["ESPORTES", "ESPORTES"])).toBe(true)
        expect(podeTransicionar(coordenadorEsportivo, "pendente", "aprovado", ["ESPORTES", "CURSOS"])).toBe(false)
        expect(podeTransicionar(coordenadorEsportivo, "rascunho", "pendente", ["ESPORTES"])).toBe(false)
    })

    it("categoria desconhecida só passa para Developer", () => {
        expect(podeTransicionar(coordenadorEsportivo, "pendente", "aprovado", ["OUTRA"])).toBe(false)
        expect(podeTransicionar(checadorDePermissoes(null, true), "pendente", "aprovado", ["OUTRA"])).toBe(true)
    })

    it("campanha sem linhas exige a ação em pelo menos uma categoria", () => {
        expect(podeTransicionar(coordenadorEsportivo, "pendente", "aprovado", [])).toBe(true)
        expect(podeTransicionar(checadorDePermissoes([], false), "pendente", "aprovado", [])).toBe(false)
    })
})

describe("criar campanha nova (importar / grade)", () => {
    it("valida a origem", () => {
        expect(origemValida("planilha")).toBe(true)
        expect(origemValida("qualquer")).toBe(false)
        expect(origemValida(undefined)).toBe(false)
    })

    it("exige a opção da origem", () => {
        expect(motivoRecusaCriacao(coordenadorEsportivo, "duplicar", ["ESPORTES"], null)).toBeNull()
        expect(motivoRecusaCriacao(coordenadorEsportivo, "planilha", ["ESPORTES"], null)).toMatch(/Sem permissão/)
    })

    it("exige criar em cada categoria enviada", () => {
        expect(motivoRecusaCriacao(coordenadorEsportivo, "duplicar", ["ESPORTES", "CURSOS"], null)).toMatch(/CURSOS/)
    })

    it("substituir exige excluir programação inteira e excluir em todas as categorias existentes", () => {
        const comExcluir = checadorDePermissoes([
            unica(PGM_GERAL.importarPlanilha), unica(PGM_GERAL.excluirProgramacao),
            crud(pgmCategoria("esportes").atividades),
        ], false)
        expect(motivoRecusaCriacao(coordenadorEsportivo, "duplicar", ["ESPORTES"], ["ESPORTES"])).toMatch(/substituir/)
        expect(motivoRecusaCriacao(comExcluir, "planilha", ["ESPORTES"], ["ESPORTES", "CURSOS"])).toMatch(/CURSOS/)
        expect(motivoRecusaCriacao(comExcluir, "planilha", ["ESPORTES"], ["ESPORTES"])).toBeNull()
        expect(motivoRecusaCriacao(comExcluir, "planilha", ["ESPORTES"], [])).toBeNull()
    })
})

describe("podeAcessarUnidade (regra de get_my_unit)", () => {
    it("colaborador de unidade só alcança a própria", () => {
        expect(podeAcessarUnidade("Cuca Pici", "Cuca Pici", false)).toBe(true)
        expect(podeAcessarUnidade("Cuca Pici", "Cuca Barra", false)).toBe(false)
    })

    it("Geral ou sem unidade alcança todas", () => {
        expect(podeAcessarUnidade("Geral", "Cuca Barra", false)).toBe(true)
        expect(podeAcessarUnidade(null, "Cuca Barra", false)).toBe(true)
        expect(podeAcessarUnidade("  ", "Cuca Barra", false)).toBe(true)
    })

    it("campanha sem unidade é alcançável; Developer passa sempre", () => {
        expect(podeAcessarUnidade("Cuca Pici", null, false)).toBe(true)
        expect(podeAcessarUnidade("Cuca Pici", "Cuca Barra", true)).toBe(true)
    })
})
