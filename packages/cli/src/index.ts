#!/usr/bin/env node

import { program } from 'commander'
import { intro, outro, text, select, isCancel, cancel, spinner } from '@clack/prompts'
import figlet from 'figlet'
import gradient from 'gradient-string'
import degit from 'degit'
import path from 'node:path'

const lapisGradient = gradient(['#1a4a7a', '#26619c', '#5b9bd5'])

const ENGINE = [
  { value: 'cascaide',      label: 'Standard', hint: 'Full durable graph executor' },
  { value: 'cascaide-lite', label: 'Lite',     hint: 'Lightweight non durable graph executor' },
]

const TEMPLATES = [
  { value: 'nextjs',           label: 'Next.js'         },
  { value: 'react-express',    label: 'React + Express' },
  { value: 'react-hono',       label: 'React + Hono'    },
  { value: 'react-fastify',    label: 'React + Fastify' },
]

const REPO_REGISTRY: Record<string, Record<string, string>> = {
  'cascaide': {
    'nextjs':        'https://github.com/Airavat-Research/cascaide-nextjs-starter.git',
    'react-express': 'https://github.com/Airavat-Research/cascaide-express-starter.git',
    'react-hono':    'https://github.com/Airavat-Research/cascaide-hono-starter.git',
    'react-fastify': 'https://github.com/Airavat-Research/cascaide-fastify-starter.git',
  },
  'cascaide-lite': {
    'nextjs':        'https://github.com/Airavat-Research/cascaide-lite-nextjs-starter.git',
    'react-express': 'https://github.com/Airavat-Research/cascaide-lite-express-starter.git',
    'react-hono':    'https://github.com/Airavat-Research/cascaide-lite-hono-starter.git',
    'react-fastify': 'https://github.com/Airavat-Research/cascaide-lite-fastify-starter.git',
  }
}

program
  .name('create-cascaide-app')
  .version('0.5.0')
  .description('Initialize a new Cascaide project')
  .argument('[project-directory]', 'Directory to create the project in')
  .action(async (projectDir) => {

    console.log() 
    console.log()
    console.log(lapisGradient.multiline(figlet.textSync('CASCAIDE', { font: 'ANSI Shadow' })))
    console.log()
    intro(lapisGradient('Initializing Full Stack Agentic App...'))

    let projectName = projectDir
    if (!projectName) {
      const input = await text({
        message: 'Project name:',
        placeholder: 'my-cascaide-app',
        validate: (v) => {
          if (!v) return 'Required'
          if (/[^a-z0-9-_]/i.test(v)) return 'Use only alphanumeric, dashes, or underscores'
        },
      })
      if (isCancel(input)) handleCancel()
      projectName = input as string
    }

    const engine = await select({ message: 'Select Cascaide Engine:', options: ENGINE })
    if (isCancel(engine)) handleCancel()

    const template = await select({ message: 'Select a template:', options: TEMPLATES })
    if (isCancel(template)) handleCancel()

    const repoPath = REPO_REGISTRY[engine as string]?.[template as string]

    if (!repoPath) {
      cancel('Invalid engine or template selection lookup.')
      process.exit(1)
    }

    const s = spinner()
    s.start(`Scaffolding from ${repoPath}...`)

    try {
      const emitter = degit(repoPath, { cache: false, force: true })
      await emitter.clone(path.resolve(process.cwd(), projectName))
      s.stop('Setup complete.')
      
      outro(lapisGradient(`Project ${projectName} is ready!`))
      
      console.log(`\nNext steps:\n  cd ${projectName}\n  npm install\n  npm run dev`)
      
      process.exit(0)
    } catch (err: any) {
      s.stop('Cloning failed.')
      console.error(`\n❌ ${err.message}`)
      process.exit(1)
    }
  })

function handleCancel() {
  cancel('Operation cancelled.')
  process.exit(0)
}

program.parse()