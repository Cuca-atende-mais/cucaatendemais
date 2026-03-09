import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data, error } = await supabase.from('instancias_uazapi').select('unidade_cuca, telefone, canal_tipo, ativa').eq('canal_tipo', 'Institucional')
  console.dir(data, { depth: null })
}
run()
