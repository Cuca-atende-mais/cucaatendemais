import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
    try {
        // Verifica autenticação
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

        const admin = createAdminClient()

        // Busca todos os registros
        const { data: registros, error } = await admin
            .from('ouvidoria_registros')
            .select('tipo, unidade_cuca, texto_manifestacao, sentimento, temas_identificados, resumo_ia, created_at')
            .order('created_at', { ascending: false })
            .limit(100)

        if (error) throw new Error(error.message)
        if (!registros || registros.length === 0) {
            return NextResponse.json({ error: 'Sem registros para analisar' }, { status: 400 })
        }

        const analisados = registros.filter(r => r.resumo_ia)
        if (analisados.length === 0) {
            return NextResponse.json({ error: 'Nenhum registro analisado ainda. Clique em "Analisar todas" primeiro.' }, { status: 400 })
        }

        // Prepara o contexto para a IA
        const resumo = analisados.map(r =>
            `[${r.tipo.toUpperCase()}][${r.unidade_cuca || 'Geral'}][${r.sentimento || 'sem sentimento'}] ${r.resumo_ia} | Temas: ${(r.temas_identificados || []).join(', ')}`
        ).join('\n')

        const textosOriginais = registros.slice(0, 30).map(r =>
            `[${r.tipo}][${r.unidade_cuca || 'Geral'}] "${r.texto_manifestacao}"`
        ).join('\n')

        const prompt = `Você é um analista de ouvidoria da Rede CUCA, uma rede de centros urbanos de cultura, arte, esporte e formação de Fortaleza-CE voltada principalmente para jovens.

Abaixo estão as manifestações recebidas (críticas e sugestões) com análise de sentimento:

RESUMOS ANALISADOS:
${resumo}

TEXTOS ORIGINAIS (para identificar melhores ideias e alertas):
${textosOriginais}

Com base nesses dados, gere um JSON estritamente no formato abaixo (sem markdown, sem explicações, apenas o JSON):

{
  "temperatura": {
    "score": <número de 0 a 100 onde 0=crise total, 50=neutro, 100=excelente>,
    "nivel": "<critico|alerta|moderado|bom|excelente>",
    "frase": "<frase curta e direta descrevendo o momento atual em 1 linha>"
  },
  "resumo_executivo": "<parágrafo de 3-4 linhas em português claro para gestores, descrevendo o panorama atual, padrões observados e recomendação principal>",
  "mais_reclamado": [
    { "tema": "<tema>", "frequencia": <número>, "trecho": "<trecho real de uma manifestação>", "unidades": ["<unidade1>"] },
    { "tema": "<tema>", "frequencia": <número>, "trecho": "<trecho real>", "unidades": ["<unidade1>"] },
    { "tema": "<tema>", "frequencia": <número>, "trecho": "<trecho real>", "unidades": ["<unidade1>"] }
  ],
  "mais_elogiado": [
    { "tema": "<tema>", "frequencia": <número>, "trecho": "<trecho real de uma manifestação positiva>" },
    { "tema": "<tema>", "frequencia": <número>, "trecho": "<trecho real>" }
  ],
  "melhores_ideias": [
    { "ideia": "<resumo da ideia>", "impacto": "<alto|medio|baixo>", "trecho": "<trecho original>", "unidade": "<unidade>" },
    { "ideia": "<resumo>", "impacto": "<alto|medio|baixo>", "trecho": "<trecho>", "unidade": "<unidade>" },
    { "ideia": "<resumo>", "impacto": "<alto|medio|baixo>", "trecho": "<trecho>", "unidade": "<unidade>" }
  ],
  "alertas": [
    { "tipo": "<infraestrutura|atendimento|segurança|urgente|outro>", "descricao": "<descrição clara do alerta>", "unidade": "<unidade afetada>" }
  ]
}`

        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1500,
                temperature: 0.3,
            }),
        })

        if (!openaiRes.ok) {
            const err = await openaiRes.text()
            throw new Error(`OpenAI erro: ${err}`)
        }

        const openaiData = await openaiRes.json()
        const rawText = openaiData.choices?.[0]?.message?.content || ''

        const insights = JSON.parse(rawText)

        return NextResponse.json({
            insights,
            meta: {
                total: registros.length,
                analisados: analisados.length,
                gerado_em: new Date().toISOString(),
            }
        })
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Erro interno'
        console.error('[ouvidoria/insights]', msg)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
