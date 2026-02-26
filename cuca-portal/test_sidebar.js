import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
    const { data, error } = await supabase
        .from("colaboradores")
        .select(`
            id,
            nome_completo,
            email,
            unidade_cuca,
            funcoes (
                nome,
                funcoes_permissoes (
                    permissoes (
                        recurso,
                        acao
                    )
                )
            )
        `)
        .eq("email", "valmir@cucateste.com")
        .single()
        
    if (error) { console.error(error); return; }

    const profile = {
        id: data.id,
        nome_completo: data.nome_completo,
        email: data.email,
        unidade_cuca: data.unidade_cuca,
        funcao: {
            nome: data.funcoes?.nome || data.funcoes[0]?.nome,
            permissoes: [] // simulated
        }
    }
    
    console.log("Profile Funcao Nome:", profile.funcao.nome)
    
    const hasPermission = (recurso, acao) => {
        if (!profile) return false
        if (profile.funcao.nome === 'developer' || profile.funcao.nome === 'super_admin') return true
        return false
    }
    
    console.log("hasPermission('leads', 'read'):", hasPermission('leads', 'read'))
}
test()
