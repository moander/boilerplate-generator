# boilerplate-generator

## Usage

```sh
# usage: pn make -s fooBar -p fooBars
pn i && pn make --singular=fooBar --plural=fooBars
```

## Maintain boilerplate

The idea is that you run `pn make` again, and then you go through
the git diff to revert whatever custom stuff you want to preserve.

## How it works

It will scan `../src` for folder and files containing `boiler-example` and all it's different casings.

Then it makes a copy of each file using the plural and singular names you have the generator.

Remember to go through the git diff after overwriting the boiler.

This will overwrite all your custom changes, and using git diff to solve this is by design.

## Include it in a project

```sh
git clone https://github.com/moander/boilerplate-generator
```

Then remove `.git` to make it part if your repo.

```sh
rm -rf ./boilerplate-generator/.git

git add ./boilerplate-generator
```
