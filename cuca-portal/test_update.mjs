import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data, error } = await supabase.from('instancias_uazapi')
    .update({ telefone: '558585860135', unidade_cuca: 'Cuca Barra' })
    .eq('nome', 'institucionalbarra')
    .select()
    
  console.dir({data, error}, { depth: null })
}
run()
