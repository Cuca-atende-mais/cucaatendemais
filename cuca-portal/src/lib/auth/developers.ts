// Única fonte das contas Developer do portal (decisão do Junior, 2026-09-12): só estas duas contas
// têm passe livre e só elas concedem permissão. O banco repete a lista em `public.is_developer()`.
export const DEVELOPER_EMAILS: string[] = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
]

export function isDeveloperEmail(email: string | null | undefined): boolean {
    if (!email) return false
    return DEVELOPER_EMAILS.includes(email.trim().toLowerCase())
}
