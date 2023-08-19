import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { glob } from 'glob'
import lodash from 'lodash'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

const __dirname = path.dirname(fileURLToPath(import.meta.url)) // hack to get __dirname in ESm

const { kebabCase, startCase } = lodash

function main(argv: Record<string, any>) {
  const inputs = {
    targetSingular: String(argv.s || argv.singular), // required (fooBar)
    targetPlural: String(argv.p || argv.plural), // required (fooBars)

    // other stuff you can override
    sourceDir: path.resolve(__dirname, argv.sourceDir || '../src'),
    sourceSingular: String(argv.sourceSingular || 'boilerExample'),
    sourcePlural: String(argv.sourcePlural || 'boilerExamples'),

    hardMaxFiles: Number(argv.hardMaxFiles || 0) || 30, // safety measure. Abort if more than N source files are found
    minNameLength: Number(argv.minNameLength || 0) || 5, // safety measure. Override if you really want a shorter name
    maxNameLength: Number(argv.maxNameLength || 0) || 32, // safety measure. Override if you want a longer name
    maxNameDiff: Number(argv.maxNameLength || 0) || 6, // safety measure. Override if you want a weird name
  }

  const cfg = {
    ...inputs,
    targetDir: path.resolve(__dirname, argv.targetDir || '../src'),
    srcSingularNames: makeNames(inputs.sourceSingular),
    srcPluralNames: makeNames(inputs.sourcePlural),
    dstSingularNames: makeNames(inputs.targetSingular),
    dstPluralNames: makeNames(inputs.targetPlural),
  }

  console.log('main() inputs', cfg)

  validName(cfg.sourceSingular, cfg.sourcePlural, cfg.targetPlural, cfg.targetSingular)

  if (!cfg.targetSingular || !cfg.targetPlural) {
    console.error('Usage: pn make --singular=fooBar --plural=fooBars')
    console.error('Example:\n\n  pn i && pn make -s fooBar -p fooBars\n\n')
    return 1
  }

  if (cfg.targetSingular === cfg.targetPlural || cfg.sourcePlural === cfg.targetPlural) {
    console.error('plural and singular cannot be the same')
    return 1
  }

  if (cfg.targetSingular.includes(cfg.sourceSingular) || cfg.targetPlural.includes(cfg.sourcePlural)) {
    console.error('wtf')
    return 1
  } else if (Math.abs(cfg.targetPlural.length - cfg.targetSingular.length) > cfg.maxNameDiff) {
    console.error('to big difference on singular and plural. Override using --max-name-diff if you want a weird name')
    return 1
  }

  if (cfg.targetSingular.length < cfg.minNameLength || cfg.targetSingular.length > cfg.maxNameLength) {
    console.error(`name '${cfg.targetSingular}' to short (or long). override using --min-name-length or --max-name-length`)
    return 1
  } else if (cfg.targetPlural.length < cfg.minNameLength || cfg.targetPlural.length > cfg.maxNameLength) {
    console.error(`name '${cfg.targetPlural}' to short (or long). override using --min-name-length or --max-name-length`)
    return 1
  }

  if (!fs.existsSync(cfg.sourceDir)) {
    console.error(`source dir not found: ${cfg.sourceDir}`)
    console.error('You can override the source dir using --source ../foo/bar')
    return 1
  }

  const allSourceNames = Object.values(cfg.srcPluralNames).concat(Object.values(cfg.srcSingularNames))

  const wantedPaths = glob.sync([
    '!**/node_modules',
    '!**/.git',
    path.resolve(__dirname, cfg.sourceDir) + '/**/*',
  ]).filter(p => {
    return allSourceNames.some(want => {
      return p.includes(want)
    })
  }).sort()

  if (wantedPaths.length > cfg.hardMaxFiles) {
    console.error(`found '${wantedPaths.length}' which is more than the maximum '${cfg.hardMaxFiles}'. Override using --hard-max-files`)
    return 1
  }

  console.log('wantedPaths', JSON.stringify(wantedPaths, null, 4))

  console.log('\n\ngenerator begin\n\n')

  return 0
}

function validName(...names:string[]): true | never {
  names.forEach(name => {
    if (!/^[a-z][a-zA-Z]+[a-z]$/.test(name)) {
      console.error(`name '${name}' is not a valid entity name`)
      process.exit(1)
    }
  })
  return true
}

function makeNames(src: string) {
  return {
    camelCase: src,
    kebabCase: kebabCase(src),
    spaceCase: startCase(src),
    titleCase: startCase(src).replace(/\s/g, ''),
  }
}

const argv = yargs(hideBin(process.argv)).argv as Record<string, any>

process.exit(main(argv) || 1)
