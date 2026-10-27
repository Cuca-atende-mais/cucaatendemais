import type { GrupoPermissao } from "./catalogo-programacao-mensal"

// Épico PLA (Planejamento 2027): uma permissão por ação, todas nascendo desmarcadas (D14).
// Prefixo `pla_`. `has_permission` casa `sys_permissions.module LIKE recurso || '%'` e, no LIKE, o `_`
// vale por qualquer caractere: nenhum id pode casar com outro id nem com um recurso já checado
// (ver catalogo-planejamento.test.ts). As próximas stories acrescentam os seus grupos aqui.
// A S-PLA-01 não cria permissão: o escopo por setor vem do cadastro do colaborador (sem setor = todos)
// e o acesso ao módulo vem dos grupos das próximas stories.

export const GRUPOS_PLANEJAMENTO: GrupoPermissao[] = []

export const MODULOS_PLANEJAMENTO: string[] = GRUPOS_PLANEJAMENTO.flatMap(g => g.modules.map(m => m.id))
