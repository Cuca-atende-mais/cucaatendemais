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
        
    console.log(JSON.stringify(data, null, 2))
}
test()
