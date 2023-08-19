import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { glob } from 'glob'
import lodash from 'lodash'
import pluralize from 'pluralize'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

const __dirname = path.dirname(fileURLToPath(import.meta.url)) // hack to get __dirname in ESm

const { kebabCase, startCase, sortBy, uniqBy, escapeRegExp } = lodash

function main(argv: Record<string, any>) {
  argv.v && console.log('argv', argv)

  const targetSingular = argv.s ?? argv.singular ?? '' // required without --plural (fooBar)
  if (typeof targetSingular !== 'string') throw new Error('fail')

  const targetPlural = argv.p ?? argv.plural ?? '' // required without --singular (fooBars)
  if (typeof targetPlural !== 'string') throw new Error('fail')

  const inputs = {
    targetSingular: targetSingular || pluralize(targetPlural, 1),
    targetPlural: targetPlural || pluralize(targetSingular, 10),

    // other stuff you can override
    sourceDir: path.resolve(__dirname, argv.sourceDir || '../src'),
    sourceSingular: String(argv.sourceSingular || 'boilerExample'),
    sourcePlural: String(argv.sourcePlural || 'boilerExamples'),

    filterRx: makeFilter(argv),

    force: argv.force === true, // true to overwrite existing files
    verbose: (argv.v ?? argv.verbose) === true, // true to log everything
    dryRun: (argv.d ?? argv.dry ?? argv.dryRun) === true, // dont write anything

    hardMaxFiles: Number(argv.hardMaxFiles || 0) || 30, // safety measure. Abort if more than N source files are found
    minNameLength: Number(argv.minNameLength || 0) || 4, // safety measure. Override if you really want a shorter name
    maxNameLength: Number(argv.maxNameLength || 0) || 32, // safety measure. Override if you want a longer name
    maxNameDiff: Number(argv.maxNameDiff || 0) || 6, // safety measure. Override if you want a weird name
    maxScanDepth: Number(argv.maxScanDepth || 0) || 15, // safety measure. Override if you like deeply nested
  }

  const cfg = {
    ...inputs,
    singularNames: makeNamesMap(inputs.sourceSingular, inputs.targetSingular),
    pluralNames: makeNamesMap(inputs.sourcePlural, inputs.targetPlural),
    srcSingularNames: makeNames(inputs.sourceSingular),
    srcPluralNames: makeNames(inputs.sourcePlural),
    dstSingularNames: makeNames(inputs.targetSingular),
    dstPluralNames: makeNames(inputs.targetPlural),
  }

  cfg.verbose && console.log('main() inputs', { ...cfg, singularNames: '**', pluralNames: '**' })

  if (!cfg.targetSingular || !cfg.targetPlural) {
    console.error('Usage: pnpm make --singular=fooBar --plural=fooBars')
    console.error('Example:\n\n  pnpm i && pnpm make -s fooBar -p fooBars\n\n')
    return 1
  }

  validName(cfg.sourceSingular, cfg.sourcePlural, cfg.targetPlural, cfg.targetSingular)

  if (cfg.targetSingular === cfg.targetPlural || cfg.sourcePlural === cfg.targetPlural) {
    console.error('plural and singular cannot be the same')
    return 1
  }

  if (new Set([cfg.targetPlural, cfg.targetSingular, cfg.sourcePlural, cfg.sourceSingular]).size !== 4) {
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

  const allNames = sortBy(
    Object.values(cfg.pluralNames.paired).concat(Object.values(cfg.singularNames.paired)),
    v => v.srcName.length,
  ).reverse() // we want the longest name first when we start replacing

  // find all files in source dir
  const allPaths = glob.sync([
    '!**/node_modules',
    '!**/.git',
    path.relative(__dirname, cfg.sourceDir) + '/**/*',
  ], {
    maxDepth: cfg.maxScanDepth,
    cwd: __dirname,
    nodir: true,
  })

  // filter out interesting source paths
  const wantedPaths = allPaths.sort().map(srcPath => {
    // transform source path into target path using multiple string-replace
    const dstPath = allNames.reduce((newPath, name) => {
      return newPath.replaceAll(name.srcName, name.dstName)
    }, srcPath)

    if (dstPath !== srcPath) {
      // we have a match
      return {
        srcPath,
        dstPath,
      }
    }
    return undefined
  }).filter(name => {
    if (name && cfg.filterRx) {
      return cfg.filterRx.test(name.dstPath)
    }
    return !!name
  }).map(x => x!)

  cfg.verbose && console.log('wantedPaths', JSON.stringify(wantedPaths, null, 4))

  // verify hard limit to avoid mistakes
  if (wantedPaths.length > cfg.hardMaxFiles) {
    console.error(`found '${wantedPaths.length}' which is more than the maximum '${cfg.hardMaxFiles}'. Override using --hard-max-files`)
    return 1
  }

  const wantedTargetFiles = [] as {
    path: string;
    data: string;
  }[]

  // iterate each source file and string replace it's content to prepare it for target write
  wantedPaths.forEach(wp => {
    const srcStat = fs.statSync(wp.srcPath)

    // files we need to create
    if (srcStat.isFile()) {
      const srcData = fs.readFileSync(wp.srcPath, 'utf-8')

      // This is where the magic happends.. I hope you didn't expecting much :-)
      const dstData = allNames.reduce((value, name) => {
        return value.replaceAll(name.srcName, name.dstName)
      }, srcData)

      // place prepared target file in queue
      wantedTargetFiles.push({
        path: wp.dstPath,
        data: dstData,
      })
      return
    }

    console.warn('ignored path!', wp)
  })

  // require unique target paths
  if (wantedPaths.length !== uniqBy(wantedPaths, p => p.dstPath).length) {
    console.log('something is unsupported about your name pair, or bug in code..')
    process.exit(1)
  }

  // scan for existing files
  const existingFiles = wantedTargetFiles.filter(file => {
    const stat = fs.statSync(path.resolve(__dirname, file.path), { throwIfNoEntry: false })

    if (stat?.isDirectory()) {
      console.error('Target file is an existing directory..', file.path)
      process.exit(1)
    }

    if (stat && !stat.isFile()) {
      console.error(`file not file: ${file.path}`)
      process.exit(1)
    }

    return !!stat
  })

  // require the --force flag to overwrite files
  if (existingFiles.length) {
    (cfg.verbose || cfg.dryRun) && console.warn(`WARN! Will overwrite ${existingFiles.length} files`, existingFiles.map(x => x.path))

    if (!cfg.force) {
      console.error('\n\nExisting files detected. You must run with the --force flag for this to happend\n\n')
      process.exit(1)
    }
  }

  // create target files
  cfg.verbose && console.log('writing files...', JSON.stringify(wantedTargetFiles.map(x => x.path).sort(), null, 4))
  wantedTargetFiles.forEach(file => {
    if (!cfg.dryRun) {
      // write file to disk
      console.log(`Writing ${file.data.length} characters to ${file.path}`)
      fs.mkdirSync(path.dirname(path.resolve(__dirname, file.path)), { recursive: true })
      fs.writeFileSync(path.resolve(__dirname, file.path), file.data, 'utf-8')
    } else {
      console.log('DryRun skipped write', file.data.length, file.path)
    }
  })

  if (cfg.dryRun) {
    console.log('Dry run successful. Now remove the --dry-run flag')
  } else {
    console.log(`SUCCESS! ${cfg.targetPlural}\n`)
  }

  return 0
}

function validName(...names: string[]): true | never {
  names.forEach(name => {
    if (!/^[a-z][a-zA-Z]+[a-z]$/.test(name)) {
      console.error(`name '${name}' is not a valid entity name`)
      process.exit(1)
    }
  })
  return true
}

// returns all variants of the names we are about to string replace
function makeNames(src: string) {
  const first = {
    camelCase: src,
    kebabCase: kebabCase(src),
    spaceCase: startCase(src),
    titleCase: startCase(src).replace(/\s/g, ''),
  } as const
  return {
    ...first,
    camelCaseLower: first.camelCase.toLocaleLowerCase(),
    camelCaseUpper: first.camelCase.toLocaleUpperCase(),
    kebabCaseLower: first.kebabCase.toLocaleLowerCase(),
    kebabCaseUpper: first.kebabCase.toLocaleUpperCase(),
    spaceCaseLower: first.spaceCase.toLocaleLowerCase(),
    spaceCaseUpper: first.spaceCase.toLocaleUpperCase(),
    titleCaseLower: first.titleCase.toLocaleLowerCase(),
    titleCaseUpper: first.titleCase.toLocaleUpperCase(),

  }
}

function makeNamesMap(srcName: string, dstName: string) {
  const src = makeNames(srcName)
  const dst = makeNames(dstName)

  const paired = Object.fromEntries(Object.entries(src).map(([key, value]) => {
    return [key, {
      key,
      srcName: value,
      dstName: (dst as any)[key],
    }]
  }))

  return {
    src,
    dst,
    paired,
  } as const
}

function makeFilter(argv:any) {
  let rx

  // string filter
  if ('f' in argv || 'filter' in argv) {
    const str = argv.f ?? argv.filter

    if (!str || typeof str !== 'string') {
      console.error('the -f and --filter operator requires a non-empty string value', { str, argv })
      process.exit(1)
    }

    rx = new RegExp(escapeRegExp(str))
  }

  // regex filter
  if ('x' in argv || 'regex' in argv || 'regexp' in argv) {
    const str = argv.x ?? argv.regex ?? argv.regexp
    if (!str || typeof str !== 'string') {
      console.error('the -x and --regex operator requires a non-empty string value', { str, argv })
      process.exit(1)
    }

    if (rx) {
      console.error('both --filter and --regex cannot be used at the same time', { argv })
      process.exit(1)
    }

    rx = new RegExp(str)
  }

  return rx || /./
}

const argv = yargs(hideBin(process.argv)).argv as Record<string, any>

// make -p (without -s) can be used multiple times to do a batch job.
// example: make -p fooBars -p fooBarItems
if (Array.isArray(argv.p)) {
  console.log('processing multiple plural names..', argv.p.sort())

  if (argv.s || argv.singular) {
    throw new Error('fail')
  }

  argv.p.forEach(plural => {
    const result = main({
      ...argv,
      p: plural,
      plural,
    })

    if (result !== 0) {
      console.error(`\n\n  failed at '${plural} (${result})'\n\n`)
      process.exit(1)
    }
  })
} else {
  process.exit(main(argv) || 0)
}
