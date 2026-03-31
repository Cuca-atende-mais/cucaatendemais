import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
// @ts-ignore
import pdf from "pdf-parse/lib/pdf-parse.js";
import OpenAI from "openai";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { uploadToR2 } from "@/lib/r2";

const DEVELOPER_EMAILS = ["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"];

const CATEGORIES = [
  "Serviços Gerais (limpeza, portaria, zeladoria)",
  "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
  "Logística e Entregas (estoque, separação, entregador, motorista)",
  "Comércio e Vendas (vendedor, caixa, atendimento)",
  "Alimentação (cozinha, garçom, lanchonete)",
  "Tecnologia (suporte técnico, programação, dados)",
  "Criativo / Digital (design, vídeo, redes sociais)",
  "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
  "Cuidados Pessoais (babá, cuidador de idosos)",
  "Administrativo / Escritório (recepção, auxiliar administrativo)",
];

export async function POST(req: NextRequest) {
  try {
    // 1. Autenticação do Desenvolvedor
    const supabaseServer = createServerClient();
    const { data: { user }, error: authError } = await (await supabaseServer)
      .auth
      .getUser();

    if (authError || !user || !user.email || !DEVELOPER_EMAILS.includes(user.email)) {
      return NextResponse.json({ error: "Acesso negado. Apenas desenvolvedores podem usar esta API." }, { status: 403 });
    }

    // 2. Extração dos Formulários
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const model = (formData.get("model") as string) || "gpt-4o-mini";
    const temperature = parseFloat((formData.get("temperature") as string) || "0.1");
    // Opcional override prompt
    const promptOverride = formData.get("prompt");

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    }

    // 3. Extrair texto do PDF
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    let text = "";
    if (file.type === "application/pdf") {
      try {
        const data = await pdf(buffer);
        text = data.text;
      } catch (pdfErr: any) {
        return NextResponse.json(
          { error: `PDF inválido ou corrompido: ${pdfErr.message}` },
          { status: 400 }
        );
      }
    } else {
      // Futuro suporte docx/txt, mas por enquanto assumimos texto extraído ou rejeita
      return NextResponse.json({ error: "Apenas PDFs suportados nesta versão inicial." }, { status: 400 });
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "Não foi possível extrair texto legível do currículo." }, { status: 400 });
    }

    // Limita tamanho do texto para não estourar tokens absurdos
    text = text.substring(0, 15000);

    // 4. OpenAI - Prompt Engenharia de RH
    const sysPrompt = promptOverride ? String(promptOverride) : `
Você é um Analista de RH Sênior analisando um currículo para cadastro no Banco de Talentos.
Sua tarefa é extrair os dados do candidato, classificá-lo em áreas de interesse e extrair informações profissionais estruturadas.

ÁREAS DE INTERESSE (use APENAS os valores EXATOS desta lista):
${CATEGORIES.map(c => `- ${c}`).join('\n')}

Regras rigorosas:
1. NUNCA invente categorias. Use APENAS os valores EXATOS da lista acima (incluindo os parênteses e descrições).
2. A grande maioria dos candidatos NÃO descreve um "Objetivo" claro, ou colocam algo genérico ("quero contribuir para a empresa", "primeiro emprego"). Se o objetivo for genérico, IGNORE-O!
3. Foque EXCLUSIVAMENTE nas EXPERIÊNCIAS PROFISSIONAIS passadas e nos CURSOS REALIZADOS para inferir a(s) melhor(es) área(s) de interesse.
   Exemplos com valores EXATOS a retornar:
   - Foi servente/pedreiro -> "Construção Civil (pedreiro, ajudante, eletricista, encanador)"
   - Foi caixa/atendimento/frentista -> "Comércio e Vendas (vendedor, caixa, atendimento)"
   - Tem curso de RH/Assistente Administrativo -> "Administrativo / Escritório (recepção, auxiliar administrativo)"
   - Foi Jovem Aprendiz Administrativo -> "Administrativo / Escritório (recepção, auxiliar administrativo)"
   - Tem curso de barbeiro/manicure -> "Beleza e Estética (barbeiro, manicure, cabeleireiro)"
   - Trabalhou em lanchonete/garçom/cozinheiro -> "Alimentação (cozinha, garçom, lanchonete)"
   - Cuidador de idosos/babá/enfermagem -> "Cuidados Pessoais (babá, cuidador de idosos)"
   - Motorista/entregador/estoque -> "Logística e Entregas (estoque, separação, entregador, motorista)"
   - TI/programação/suporte -> "Tecnologia (suporte técnico, programação, dados)"
   - Design/redes sociais/vídeo -> "Criativo / Digital (design, vídeo, redes sociais)"
   - Porteiro/limpeza/zeladoria/serviços gerais -> "Serviços Gerais (limpeza, portaria, zeladoria)"
4. Para experiencia_meses: some todos os períodos de emprego encontrados no currículo e retorne o total estimado em meses. Se não houver experiência, retorne 0.
5. Para habilidades: liste competências técnicas e ferramentas mencionadas (ex: "Excel", "Atendimento ao cliente", "Operador de caixa"). Máximo 10 itens.
6. Para resumo_experiencias: liste cada cargo/empresa em frases curtas (ex: "Jovem Aprendiz na Empresa X — 2022/2023"). Máximo 5 itens.
7. Retorne APENAS um objeto JSON com a seguinte estrutura estrita.
`;

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.chat.completions.create({
      model: model,
      temperature: temperature,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: `Analise o seguinte currículo:\n\n${text}` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "curriculum_analysis",
          schema: {
            type: "object",
            properties: {
              nome: { type: "string", description: "O nome completo do candidato" },
              telefone: { type: "string", description: "O telefone ou celular (apenas números ou formatado)" },
              data_nascimento: { type: "string", description: "Data de nascimento no formato YYYY-MM-DD se encontrada no currículo, senão string vazia" },
              areas_interesse: {
                type: "array",
                items: { type: "string", enum: CATEGORIES },
                description: "Array de 1 a 3 valores EXATOS da lista de categorias permitidas. Use APENAS os valores do enum — nunca invente variações."
              },
              escolaridade: { type: "string", description: "Nível de escolaridade mais alto concluído (ex: Ensino Médio Completo, Superior Incompleto, Técnico em Administração)" },
              experiencia_meses: { type: "number", description: "Total estimado de meses de experiência profissional somando todos os empregos. 0 se sem experiência." },
              habilidades: {
                type: "array",
                items: { type: "string" },
                description: "Lista de habilidades técnicas e competências encontradas no currículo. Máximo 10 itens."
              },
              resumo_experiencias: {
                type: "array",
                items: { type: "string" },
                description: "Lista de experiências anteriores em frases curtas (cargo + empresa + período). Máximo 5 itens."
              },
              resumo_skills: { type: "string", description: "Breve resumo com o perfil profissional do candidato (max 150 palavras)." },
              justificativa_ia: { type: "string", description: "Justificativa de porque foram escolhidas essas áreas de interesse baseado no currículo." }
            },
            required: ["nome", "telefone", "data_nascimento", "areas_interesse", "escolaridade", "experiencia_meses", "habilidades", "resumo_experiencias", "resumo_skills", "justificativa_ia"],
            additionalProperties: false
          },
          strict: true
        }
      }
    });

    const parsedJson = response.choices[0].message.content;
    if (!parsedJson) {
      throw new Error("Resposta vazia da OpenAI.");
    }

    const aiResult = JSON.parse(parsedJson);

    // Validação estrita contra a lista de categorias pra não sujar o banco
    const filteredAreas = aiResult.areas_interesse.filter((a: string) => CATEGORIES.includes(a));
    if (filteredAreas.length === 0) {
      filteredAreas.push("Serviços Gerais (limpeza, portaria, zeladoria)"); // fallback
    }

    // 5. Upload do PDF original para Cloudflare R2
    const r2Key = `batch/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    let arquivoCvUrl: string | null = null;
    try {
      arquivoCvUrl = await uploadToR2(r2Key, buffer, "application/pdf");
    } catch (r2Err) {
      console.warn("[batch-triage] Upload R2 falhou, continuando sem arquivo:", r2Err);
    }

    // 6. Salvar automaticamente no Supabase
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const dataNascimento = aiResult.data_nascimento && aiResult.data_nascimento.match(/^\d{4}-\d{2}-\d{2}$/)
      ? aiResult.data_nascimento
      : null

    const talentPayload = {
      nome: aiResult.nome || "Não encontrado",
      telefone: aiResult.telefone || null,
      data_nascimento: dataNascimento,
      status: "disponivel",
      area_interesse: filteredAreas,
      arquivo_cv_url: arquivoCvUrl,
      skills_jsonb: {
        escolaridade: aiResult.escolaridade || "",
        experiencia_meses: aiResult.experiencia_meses || 0,
        habilidades: aiResult.habilidades || [],
        resumo_experiencias: aiResult.resumo_experiencias || [],
        resumo: aiResult.resumo_skills,
        justificativa_ia: aiResult.justificativa_ia,
        origem: "batch_developer_triage",
        nome_arquivo: file.name
      },
      updated_at: new Date().toISOString()
    };

    const { data: inserted, error: dbError } = await supabaseAdmin
      .from("talent_bank")
      .insert(talentPayload)
      .select("id")
      .single();

    if (dbError) {
      throw new Error(`Erro ao salvar no banco de dados: ${dbError.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        talent_id: inserted.id,
        nome: talentPayload.nome,
        areas: talentPayload.area_interesse,
        justificativa: aiResult.justificativa_ia
      }
    });

  } catch (error: any) {
    console.error("[batch-triage] Erro:", error);
    return NextResponse.json(
      { error: error.message || "Falha interna no processamento do lote." },
      { status: 500 }
    );
  }
}
