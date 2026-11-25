/**
 * S-EMP-GES-13 (AC5b, AC15, AC16): nome de quem liberou cada vaga/seleção (rascunho → aberta).
 *
 * O nome não fica na tabela `vagas` (que visitantes sem login leem nas vagas abertas): vem da função
 * `emp_vagas_liberado_por`, que só responde a quem pode ver vagas ou seleções. Nome do cadastro do
 * colaborador do login; se estiver vazio, o e-mail do login.
 */

import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

type ClienteRpc = {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

type LinhaVaga = { id: string; liberada_por?: string | null; liberada_por_usuario?: string | null }

/** Uma chamada só para as vagas da tela. Vaga sem autor registrado nem entra na consulta. */
export async function buscarLiberadoPor(cliente: ClienteRpc, vagas: LinhaVaga[]): Promise<Map<string, string>> {
    const ids = vagas.filter(v => v.liberada_por || v.liberada_por_usuario).map(v => v.id)
    if (ids.length === 0) return new Map()
    const { data, error } = await cliente.rpc("emp_vagas_liberado_por", { p_vaga_ids: ids })
    if (error) {
        // A coluna mostra "—"; a listagem não deixa de abrir por causa disso.
        console.error("[liberado-por] Erro ao buscar quem liberou:", error)
        return new Map()
    }
    const mapa = new Map<string, string>()
    for (const linha of (data ?? []) as { vaga_id: string; nome: string | null }[]) {
        if (linha?.vaga_id && linha.nome) mapa.set(linha.vaga_id, linha.nome)
    }
    return mapa
}

/** "Liberada em 24/11/2026 às 14:32" (texto do tooltip da coluna "Liberado por"). */
export function textoLiberadaEm(liberadaEm: string | null | undefined): string | undefined {
    if (!liberadaEm) return undefined
    const d = new Date(liberadaEm)
    if (Number.isNaN(d.getTime())) return undefined
    return `Liberada em ${format(d, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`
}
