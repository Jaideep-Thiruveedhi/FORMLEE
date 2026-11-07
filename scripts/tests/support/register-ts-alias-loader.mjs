/**
 * Resolve the app's TypeScript path alias and extensionless imports in direct
 * Node tests. Next handles these at runtime in the application; Node's native
 * type stripping does not apply tsconfig paths or bundler resolution rules.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target

    if (specifier === '@/lib/prisma') {
      target = path.join(ROOT, 'scripts', 'tests', 'support', 'mock-prisma.mjs')
    } else if (specifier === '@prisma/client') {
      target = path.join(ROOT, 'scripts', 'tests', 'support', 'mock-prisma.mjs')
    } else if (specifier === '@/lib/agent/model' || specifier.endsWith('/src/lib/agent/model.ts')) {
      target = path.join(ROOT, 'scripts', 'tests', 'support', 'mock-agent-model.mjs')
    } else if (specifier.startsWith('@/')) {
      target = path.join(ROOT, 'src', specifier.slice(2))
    } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      target = fileURLToPath(new URL(specifier, context.parentURL))
    } else if (specifier.startsWith('next/')) {
      const nextModule = path.join(ROOT, 'node_modules', 'next', specifier.slice('next/'.length) + '.js')
      if (existsSync(nextModule)) return nextResolve(pathToFileURL(nextModule).href, context)
      return nextResolve(specifier, context)
    } else {
      return nextResolve(specifier, context)
    }

    if (path.extname(target)) {
      if (existsSync(target)) return nextResolve(pathToFileURL(target).href, context)
      return nextResolve(specifier, context)
    }

    for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.json']) {
      const candidate = target + extension
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context)
    }

    for (const extension of ['.ts', '.tsx', '.js', '.mjs']) {
      const candidate = path.join(target, 'index' + extension)
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context)
    }

    return nextResolve(specifier, context)
  },
})
