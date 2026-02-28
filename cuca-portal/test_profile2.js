import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
    const userId = "ecc1cd12-6722-4d1b-b354-8c209d003656"
    
    // 1st query
    const { data: d1, error: e1 } = await supabase
        .from("colaboradores")
        .select(`id`)
        .eq("user_id", userId)
        
    console.log("Q1:", d1, e1)
    
    // 2nd query
    const { data: d2, error: e2 } = await supabase
        .from("colaboradores")
        .select(`id, funcoes (nome)`)
        .eq("user_id", userId)
        
    console.log("Q2:", d2, e2)
    
    // 3rd query
    const { data: d3, error: e3 } = await supabase
        .from("colaboradores")
        .select(`
            id,
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
        
    console.log("Q3:", JSON.stringify(d3, null, 2), e3)
}
test()
