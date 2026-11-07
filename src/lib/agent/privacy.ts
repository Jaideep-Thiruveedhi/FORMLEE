import { loadWorkspaceVault } from '@/lib/apply-ai/server-data'

/** Values remain server-side and are used only to redact model-bound text. */
export async function collectWorkspaceSensitiveValues(workspaceId: string): Promise<string[]> {
  const vault = await loadWorkspaceVault(workspaceId)
  const values: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.trim().length >= 3) values.push(value.trim())
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item)
    }
  }
  visit(vault.profile)
  visit(vault.documents.map(({ originalName, displayLabel, certificate }) => ({ originalName, displayLabel, certificate })))
  return [...new Set(values)]
}
