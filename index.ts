import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { glob } from 'glob'
import lodash from 'lodash'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

const __dirname = path.dirname(fileURLToPath(import.meta.url)) // hack to get __dirname in ESm

const { kebabCase, startCase, sortBy, uniqBy } = lodash

console.log('argv')
function main(argv: Record<string, any>) {
  const inputs = {
    targetSingular: String(argv.s || argv.singular), // required (fooBar)
    targetPlural: String(argv.p || argv.plural), // required (fooBars)

    // other stuff you can override
    sourceDir: path.resolve(__dirname, argv.sourceDir || '../src'),
    sourceSingular: String(argv.sourceSingular || 'boilerExample'),
    sourcePlural: String(argv.sourcePlural || 'boilerExamples'),

    force: !!(argv.force), // true to overwrite existing files
    dryRun: !!(argv.dry || argv.dryRun), // dont write anything

    hardMaxFiles: Number(argv.hardMaxFiles || 0) || 30, // safety measure. Abort if more than N source files are found
    minNameLength: Number(argv.minNameLength || 0) || 5, // safety measure. Override if you really want a shorter name
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

  console.log('main() inputs', { ...cfg, singularNames: '**', pluralNames: '**' })

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
  }).filter(x => x).map(x => x!)

  console.log('wantedPaths', JSON.stringify(wantedPaths, null, 4))

  // verify hard limit to avoid mistakes
  if (wantedPaths.length > cfg.hardMaxFiles) {
    console.error(`found '${wantedPaths.length}' which is more than the maximum '${cfg.hardMaxFiles}'. Override using --hard-max-files`)
    return 1
  }

  const wantedTargetDirs = [] as string[]

  const wantedTargetFiles = [] as {
    path: string;
    data: string;
  }[]

  // iterate each source file and directory, and string replace it's content to prepare it for target write
  wantedPaths.forEach(wp => {
    const srcStat = fs.statSync(wp.srcPath)

    // folders we need to create
    if (srcStat.isDirectory()) {
      wantedTargetDirs.push(wp.dstPath)
      return
    }

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
    console.warn(`WARN! Will overwrite ${existingFiles.length} files`, existingFiles.map(x => x.path))

    if (!cfg.force) {
      console.error('\n\nExisting files detected. You must run with the --force flag for this to happend\n\n')
      process.exit(1)
    }
  }

  // create target directories
  if (wantedTargetDirs.length) {
    console.log('creating directories..', JSON.stringify(wantedTargetDirs.sort(), null, 4))

    if (!cfg.dryRun) {
      // create all wanted directories
      wantedTargetDirs.sort().reverse().forEach(dir => {
        fs.mkdirSync(dir, { recursive: true })
      })
    }
  }

  // create target files
  console.log('writing files...', JSON.stringify(wantedTargetFiles.map(x => x.path).sort(), null, 4))
  wantedTargetFiles.forEach(file => {
    if (!cfg.dryRun) {
      // write file to disk
      console.log(`Writing ${file.data.length} characters to ${file.path}`)
      fs.writeFileSync(path.resolve(__dirname, file.path), file.data, 'utf-8')
    } else {
      console.log('DryRun skipped write', file.data.length, file.path)
    }
  })

  if (cfg.dryRun) {
    console.log('Dry run successful. Now remove the --dry-run flag')
  } else {
    console.log('\n\nSUCCESS!\n\n')
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

const argv = yargs(hideBin(process.argv)).argv as Record<string, any>

process.exit(main(argv) || 1)
