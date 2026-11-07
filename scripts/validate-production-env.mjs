import nextEnv from '@next/env'
import { validateProductionEnvironment } from '../src/lib/server-env.mjs'

const { loadEnvConfig } = nextEnv
process.env.NODE_ENV = 'production'
loadEnvConfig(process.cwd())
validateProductionEnvironment({ ...process.env, NODE_ENV: 'production' })
