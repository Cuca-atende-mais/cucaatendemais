import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { data, error } = await supabase.from('instancias_uazapi').update({ telefone: '123' }).eq('id', 'nonexistent')
  
  const { data: policies, error: polErr } = await supabase.rpc('get_policies_for_table', { table_name: 'instancias_uazapi' })
  console.dir(policies, {depth: null})

  // let's just query the pg_policies directly
  const { data: pg_pol, error: pg_err } = await supabase.from('pg_policies').select('*').eq('tablename', 'instancias_uazapi')
  console.dir(pg_pol, {depth: null})
  console.log(pg_err)
}
run()
