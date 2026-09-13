/**
 * S-PROG-13: o que cada perfil pode fazer em cada categoria da programação mensal. Funções puras,
 * usadas pelas telas (com `useUser().hasPermission`) e pelas rotas (com as permissões já lidas).
 * Mesma regra das funções `pgm_slug_categoria`/`pgm_pode_categoria` do banco.
 */
import { CATEGORIAS_PROGRAMACAO, PGM_GERAL, pgmCategoria, type SlugCategoria } from "@/lib/rbac/catalogo-programacao-mensal"
import type { Categoria } from "./tipos"

/** Checagem exata de permissão: (módulo, "read" | "create" | "update" | "delete") → liberado. */
export type ChecarPermissao = (modulo: string, acao: string) => boolean

export type PermissoesCategoria = { ver: boolean; criar: boolean; editar: boolean; excluir: boolean }

export const NOMES_CATEGORIAS: Categoria[] = CATEGORIAS_PROGRAMACAO.map(c => c.nome)

/** Nome gravado na linha → slug dos módulos. `ESPORTE` (grafia antiga) conta como ESPORTES. */
export function slugDaCategoria(nome: string | null | undefined): SlugCategoria | null {
    const valor = (nome ?? "").trim().toUpperCase()
    if (valor === "ESPORTE") return "esportes"
    return CATEGORIAS_PROGRAMACAO.find(c => c.nome === valor)?.slug ?? null
}

export function permissoesDaCategoria(checar: ChecarPermissao, nome: string | null | undefined): PermissoesCategoria {
    const slug = slugDaCategoria(nome)
    if (!slug) return { ver: false, criar: false, editar: false, excluir: false }
    const modulo = pgmCategoria(slug).atividades
    return {
        ver: checar(modulo, "read"),
        criar: checar(modulo, "create"),
        editar: checar(modulo, "update"),
        excluir: checar(modulo, "delete"),
    }
}

export function mapaPermissoesCategorias(checar: ChecarPermissao): Record<Categoria, PermissoesCategoria> {
    return Object.fromEntries(NOMES_CATEGORIAS.map(nome => [nome, permissoesDaCategoria(checar, nome)])) as Record<Categoria, PermissoesCategoria>
}

/** Opções de ação única (lista, duplicar, exportar...) ficam gravadas em `can_read`. */
export function opcaoLiberada(checar: ChecarPermissao, modulo: string): boolean {
    return checar(modulo, "read")
}

/** Categorias que a tela manda para salvar: as que a pessoa enxerga e pode alterar de algum jeito. */
export function categoriasEditaveis(mapa: Record<Categoria, PermissoesCategoria>): Categoria[] {
    return NOMES_CATEGORIAS.filter(nome => {
        const p = mapa[nome]
        return p.ver && (p.criar || p.editar || p.excluir)
    })
}

/** Separa as linhas de origem da duplicação: copia só as categorias em que a pessoa pode criar. */
export function separarLinhasParaDuplicar<T extends { categoria: string | null }>(
    linhas: T[], checar: ChecarPermissao,
): { copiadas: T[]; foraDoPerfil: number } {
    const copiadas = linhas.filter(l => permissoesDaCategoria(checar, l.categoria).criar)
    return { copiadas, foraDoPerfil: linhas.length - copiadas.length }
}

export type StatusCategoria = "rascunho" | "aguardando_autorizacao" | "autorizada"
export type AcaoFluxo = "enviar" | "autorizar" | "devolver" | "reabrir"

export const ROTULO_STATUS_CATEGORIA: Record<StatusCategoria, string> = {
    rascunho: "Rascunho",
    aguardando_autorizacao: "Aguardando autorização",
    autorizada: "Autorizada",
}

/** S-PROG-14: transições de uma categoria e a ação do fluxo que cada uma exige. */
export function acaoDaTransicaoCategoria(de: string, para: string): AcaoFluxo | null {
    if (de === "rascunho" && para === "aguardando_autorizacao") return "enviar"
    if (de === "aguardando_autorizacao" && para === "autorizada") return "autorizar"
    if (de === "aguardando_autorizacao" && para === "rascunho") return "devolver"
    if (de === "autorizada" && para === "rascunho") return "reabrir"
    return null
}

export function transicaoExigeMotivo(de: string, para: string): boolean {
    const acao = acaoDaTransicaoCategoria(de, para)
    return acao === "devolver" || acao === "reabrir"
}

/** A pessoa pode fazer a transição nesta categoria? (opção de ação única da S-PROG-12) */
export function podeTransicionarCategoria(checar: ChecarPermissao, categoria: string | null | undefined, de: string, para: string): boolean {
    const acao = acaoDaTransicaoCategoria(de, para)
    const slug = slugDaCategoria(categoria)
    if (!acao || !slug) return false
    return opcaoLiberada(checar, pgmCategoria(slug)[acao])
}

/** Transições oferecidas a partir do status atual. */
export function transicoesPossiveis(de: string): { para: StatusCategoria; acao: AcaoFluxo }[] {
    const destinos: StatusCategoria[] = ["rascunho", "aguardando_autorizacao", "autorizada"]
    return destinos
        .map(para => ({ para, acao: acaoDaTransicaoCategoria(de, para) }))
        .filter((t): t is { para: StatusCategoria; acao: AcaoFluxo } => t.acao !== null)
}

/** Permissões da categoria considerando o status: fora de rascunho, só leitura. */
export function permissoesComStatus(p: PermissoesCategoria, status: string | null | undefined): PermissoesCategoria {
    if (!status || status === "rascunho") return p
    return { ver: p.ver, criar: false, editar: false, excluir: false }
}

export type OrigemCriacao = "zero" | "duplicar" | "planilha"

const MODULO_DA_ORIGEM: Record<OrigemCriacao, string> = {
    zero: PGM_GERAL.criarZero,
    duplicar: PGM_GERAL.duplicar,
    planilha: PGM_GERAL.importarPlanilha,
}

export function origemValida(valor: unknown): valor is OrigemCriacao {
    return typeof valor === "string" && valor in MODULO_DA_ORIGEM
}

/**
 * Criar campanha nova (`/api/programacao/importar`): exige a opção da origem (do zero, duplicar ou
 * planilha) e "criar" em cada categoria enviada. Se já existe
 * campanha no mês, substituir exige "excluir programação inteira" e "excluir" em todas as categorias
 * que ela tem. Devolve o motivo da recusa, ou null.
 */
export function motivoRecusaCriacao(
    checar: ChecarPermissao,
    origem: OrigemCriacao,
    categoriasDoArquivo: (string | null)[],
    categoriasDaExistente: (string | null)[] | null,
): string | null {
    if (!opcaoLiberada(checar, MODULO_DA_ORIGEM[origem])) {
        return "Sem permissão para criar programação por este caminho"
    }
    for (const nome of new Set(categoriasDoArquivo)) {
        if (!permissoesDaCategoria(checar, nome).criar) return `Sem permissão para criar atividades de ${nome ?? "(sem categoria)"}`
    }
    if (categoriasDaExistente) {
        if (!opcaoLiberada(checar, PGM_GERAL.excluirProgramacao)) {
            return "Sem permissão para substituir a programação existente deste mês"
        }
        for (const nome of new Set(categoriasDaExistente)) {
            if (!permissoesDaCategoria(checar, nome).excluir) {
                return `Sem permissão para substituir: a programação existente tem atividades de ${nome ?? "(sem categoria)"}`
            }
        }
    }
    return null
}

export type LinhaPermissaoPgm = {
    module: string
    can_read: boolean | null
    can_create: boolean | null
    can_update: boolean | null
    can_delete: boolean | null
}

/**
 * Checagem exata a partir das linhas de `sys_permissions` do perfil, igual a `has_permission_exata`
 * no banco: Developer passa em tudo; sem nome de perfil com passe livre (o "Super Admin Cuca" do
 * `useUser().hasPermission` não vale aqui, porque o banco não aceita).
 */
export function checadorDePermissoes(linhas: LinhaPermissaoPgm[] | null | undefined, developer: boolean): ChecarPermissao {
    if (developer) return () => true
    const porModulo = new Map((linhas ?? []).map(l => [l.module, l]))
    return (modulo, acao) => {
        if (modulo.startsWith("developer")) return false
        const linha = porModulo.get(modulo)
        if (!linha) return false
        switch (acao) {
            case "read": return linha.can_read === true
            case "create": return linha.can_create === true
            case "update": return linha.can_update === true
            case "delete": return linha.can_delete === true
            default: return false
        }
    }
}

/**
 * Unidade: mesma regra de `get_my_unit()` no banco. Colaborador sem unidade ou com "Geral" acessa
 * todas; campanha sem unidade é acessível a todos; Developer passa sempre.
 */
export function podeAcessarUnidade(
    unidadeDoColaborador: string | null | undefined,
    unidadeAlvo: string | null | undefined,
    developer: boolean,
): boolean {
    if (developer) return true
    const minha = (unidadeDoColaborador ?? "").trim()
    if (minha === "" || minha === "Geral") return true
    if (!unidadeAlvo) return true
    return minha === unidadeAlvo
}
