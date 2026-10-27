// Reproduz `sys_permissions.module LIKE recurso || '%'` do has_permission: no LIKE, `_` casa qualquer
// caractere e `%` qualquer sequência. Por isso `startsWith` não basta para testar colisão de ids.
export function casaPorLike(modulo: string, recurso: string): boolean {
    const padrao = recurso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, ".").replace(/%/g, ".*")
    return new RegExp(`^${padrao}`, "s").test(modulo)
}
