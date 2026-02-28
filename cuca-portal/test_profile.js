import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
    const userId = "ecc1cd12-6722-4d1b-b354-8c209d003656"
    
    console.log("User ID:", userId);
    
    const { data, error } = await supabase
        .from("colaboradores")
        .select(`
            id,
            nome_completo,
            email,
            unidade_cuca,
            funcoes (
                nome,
                nivel_acesso,
                funcoes_permissoes (
                    permissoes (
                        recurso,
                        acao
                    )
                )
            )
        `)
        .eq("user_id", userId)
        .single()
        
    console.log("Data:", JSON.stringify(data, null, 2))
    console.log("Error:", error)
}
test()
