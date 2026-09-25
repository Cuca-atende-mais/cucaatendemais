import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import { slugDaCategoria } from "@/lib/programacao/permissoes-categoria"
import { resolverUnidade, type CampanhaDoMes } from "@/lib/programacao/exportacao-consolidada"
import { PGM_EXPORTACAO_CONSOLIDADA, CATEGORIAS_PROGRAMACAO } from "@/lib/rbac/catalogo-programacao-mensal"

// S-PROG-18: dados da tela "Exportar planilha". Decisão do Junior (2026-09-25): quem recebe a opção
// "Ver a tela de exportação consolidada" vê as 4 categorias da unidade, em qualquer status (rascunho,
// aguardando, autorizada) — a permissão por categoria da S-PROG-13 não se aplica aqui, quem libera é a
// Rede Cuca por esta opção. Por isso a leitura é com a chave de serviço, depois de conferir a opção
// exata e a unidade (`get_my_unit()`): colaborador com unidade fixa só alcança a dele. Só leitura.
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()
        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        // Checagem exata, igual a `has_permission_exata` no banco (Developer passa; "Super Admin Cuca" não).
        const acesso = await carregarAcessoPgm(user)
        if (!acesso.checar(PGM_EXPORTACAO_CONSOLIDADA.ver, "read")) {
            return NextResponse.json({ error: "Sem permissão para ver a exportação consolidada." }, { status: 403 })
        }

        const { searchParams } = new URL(req.url)
        const mes = Number(searchParams.get("mes"))
        const ano = Number(searchParams.get("ano"))
        const unidadePedida = searchParams.get("unidade")
        if (!Number.isInteger(mes) || mes < 1 || mes > 12 || !Number.isInteger(ano) || ano < 2020 || ano > 2100) {
            return NextResponse.json({ error: "Mês e ano inválidos" }, { status: 400 })
        }

        const admin = createAdminClient()
        const { data: campanhas, error: campErr } = await admin
            .from("campanhas_mensais")
            .select("id, unidade_cuca")
            .eq("mes", mes)
            .eq("ano", ano)
        if (campErr) throw new Error(campErr.message)

        const { unidades, unidade, campanhaIds: ids } = resolverUnidade(
            (campanhas ?? []) as CampanhaDoMes[],
            u => acesso.alcancaUnidade(u),
            unidadePedida,
        )
        const podeExportar = acesso.checar(PGM_EXPORTACAO_CONSOLIDADA.exportar, "read")
        const statusVazio = Object.fromEntries(CATEGORIAS_PROGRAMACAO.map(c => [c.nome, null])) as Record<string, string | null>

        if (!unidade) {
            return NextResponse.json({ unidades, unidade: null, status: statusVazio, atividades: [], podeExportar })
        }

        // Normalmente 1 campanha por unidade/mês (conferido em produção em 2026-09-25); se houver mais, junta.
        const [{ data: atividades, error: atvErr }, { data: statusCats, error: stErr }] = await Promise.all([
            admin
                .from("atividades_mensais")
                .select("titulo, categoria, local, data_atividade, hora_inicio, hora_fim, metadata")
                .in("campanha_id", ids)
                .range(0, 4999),
            admin
                .from("campanha_categoria_status")
                .select("categoria, status")
                .in("campanha_id", ids),
        ])
        if (atvErr) throw new Error(atvErr.message)
        if (stErr) throw new Error(stErr.message)

        const status = { ...statusVazio }
        for (const s of statusCats ?? []) {
            const nome = CATEGORIAS_PROGRAMACAO.find(c => c.slug === slugDaCategoria(s.categoria as string))?.nome
            if (nome) status[nome] = s.status as string
        }

        return NextResponse.json({ unidades, unidade, status, atividades: atividades ?? [], podeExportar })
    } catch (error) {
        console.error("Error in exportacao-consolidada:", error)
        const mensagem = error instanceof Error ? error.message : String(error)
        return NextResponse.json({ error: `Falha ao carregar a exportação consolidada: ${mensagem}` }, { status: 500 })
    }
}
