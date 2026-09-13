import { describe, expect, it } from "vitest"
import { PGM_GERAL, pgmCategoria } from "@/lib/rbac/catalogo-programacao-mensal"
import {
    acaoDaTransicaoCategoria, categoriasEditaveis, checadorDePermissoes, mapaPermissoesCategorias, motivoRecusaCriacao,
    origemValida, permissoesDaCategoria, podeAcessarUnidade, podeTransicionarCategoria, permissoesComStatus, separarLinhasParaDuplicar, slugDaCategoria, transicaoExigeMotivo, transicoesPossiveis,
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

describe("transições por categoria (S-PROG-14)", () => {
    it("mapeia cada transição para a ação do fluxo", () => {
        expect(acaoDaTransicaoCategoria("rascunho", "aguardando_autorizacao")).toBe("enviar")
        expect(acaoDaTransicaoCategoria("aguardando_autorizacao", "autorizada")).toBe("autorizar")
        expect(acaoDaTransicaoCategoria("aguardando_autorizacao", "rascunho")).toBe("devolver")
        expect(acaoDaTransicaoCategoria("autorizada", "rascunho")).toBe("reabrir")
        expect(acaoDaTransicaoCategoria("rascunho", "autorizada")).toBeNull()
        expect(acaoDaTransicaoCategoria("autorizada", "aguardando_autorizacao")).toBeNull()
    })

    it("devolver e reabrir exigem motivo", () => {
        expect(transicaoExigeMotivo("aguardando_autorizacao", "rascunho")).toBe(true)
        expect(transicaoExigeMotivo("autorizada", "rascunho")).toBe(true)
        expect(transicaoExigeMotivo("rascunho", "aguardando_autorizacao")).toBe(false)
    })

    it("coordenador esportivo autoriza ESPORTES e não CURSOS", () => {
        expect(podeTransicionarCategoria(coordenadorEsportivo, "ESPORTES", "aguardando_autorizacao", "autorizada")).toBe(true)
        expect(podeTransicionarCategoria(coordenadorEsportivo, "CURSOS", "aguardando_autorizacao", "autorizada")).toBe(false)
        expect(podeTransicionarCategoria(coordenadorEsportivo, "ESPORTES", "rascunho", "aguardando_autorizacao")).toBe(false)
        expect(podeTransicionarCategoria(checadorDePermissoes(null, true), "OUTRA", "aguardando_autorizacao", "autorizada")).toBe(false)
    })

    it("oferece as transições válidas a partir de cada status", () => {
        expect(transicoesPossiveis("rascunho").map(t => t.acao)).toEqual(["enviar"])
        expect(transicoesPossiveis("aguardando_autorizacao").map(t => t.acao).sort()).toEqual(["autorizar", "devolver"])
        expect(transicoesPossiveis("autorizada").map(t => t.acao)).toEqual(["reabrir"])
    })

    it("categoria fora de rascunho fica só leitura", () => {
        const tudo = { ver: true, criar: true, editar: true, excluir: true }
        expect(permissoesComStatus(tudo, "rascunho")).toEqual(tudo)
        expect(permissoesComStatus(tudo, undefined)).toEqual(tudo)
        expect(permissoesComStatus(tudo, "autorizada")).toEqual({ ver: true, criar: false, editar: false, excluir: false })
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
